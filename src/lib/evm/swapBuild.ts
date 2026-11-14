import { getAddress, parseUnits, type Address } from "viem";
import { getChain, type AcrossAsset, type BridgeKind, type ChainConfig } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { isDecimal, parseAddress, sameAddress } from "@/lib/format";
import { knownContracts, requireRecipient } from "@/lib/recipient";
import type { MetaTx } from "@/lib/safe/tx";
import { findToken } from "@/lib/tokens";
import type { Operation } from "@/types/domain";
import {
	bridgeOf,
	bridgeRoute,
	FALLBACK_RECEIVE,
	legOf,
	type BridgeProgress,
	type BridgeRoute,
	type LegCtx,
	type ReceiveAsset,
} from "./bridges";
import type { AcrossLeg } from "./bridges/across";
import type { BridgeLeg } from "./bridges/cctp";
import type { ForwardLevel } from "./cctp";
import { dexWeth } from "./dex";
import { mismatch } from "./mismatch";
import { swapProviderFor, type SwapCtx, type SwapLeg } from "./swaps";

/**
 * The "swap or bridge" operation: an optional exchange on the Safe's own network, then an optional
 * crossing to another one. This file only puts the two together – what to exchange into, which way to
 * cross, in what order the calls go. How an exchange or a crossing is quoted and built is the business
 * of its provider (`./swaps`, `./bridges`); nothing here knows one bridge from another.
 */

export type { BridgeProgress } from "./bridges";
export type { AcrossLeg } from "./bridges/across";
export { fastAvailable, USDC_DECIMALS } from "./bridges/cctp";
export type { BridgeLeg } from "./bridges/cctp";
export type { SwapLeg } from "./swaps";
export { applySlippage, SWAP_DEADLINE_SECONDS } from "./swaps/v3";

/** Marker of the chain's native coin in `tokenIn` / `tokenOut`. */
export const NATIVE = "native";
export const SLIPPAGE_CHOICES = ["0.5", "1", "3", "5", "10"];
export const MAX_SLIPPAGE_PERCENT = 50;

/**
 * Everything the signed transaction depends on that had to be asked of the network. A crossing is
 * kept under the key of its bridge (`BridgeProvider.legKey`), at most one of them.
 */
export interface SwapResolved {
	amountIn: string;
	swap?: SwapLeg;
	/** USDC through Circle's CCTP. */
	bridge?: BridgeLeg;
	/** A token through Across. */
	across?: AcrossLeg;
	/** The bridge asked for could not carry this amount, so the value goes as USDC through another. Shown as a warning. */
	fallback?: boolean;
	preparedAt: number;
}

export interface SwapParams {
	/** `native` or a token address. */
	tokenIn: string;
	tokenInSymbol: string;
	tokenInDecimals: number;
	/** Decimal string in token units. */
	amount: string;
	destChainId: number;
	/** Same-chain swaps only; what a transfer to another network delivers is `receive`. */
	tokenOut: string;
	tokenOutSymbol: string;
	tokenOutDecimals: number;
	/**
	 * Cross-chain: what should arrive on the other network, out of what the bridges carry there.
	 * Absent – the default: the token itself where a bridge carries it, else USDC (see `bridgeRoutes`).
	 */
	receive?: ReceiveAsset;
	/** Empty – this Safe's own address. */
	recipient: string;
	/** Percent, e.g. "1". */
	slippage: string;
	/** Pinned pool fee tier of the first hop; 0 – best route. */
	feeTier: number;
	/** Options of the CCTP bridge. */
	speed: "standard" | "fast";
	/** Circle submits the mint on the destination chain and deducts its cost from the transfer. */
	forward: boolean;
	forwardLevel: ForwardLevel;
	/** Option of the Across bridge: leave the relayer room for gas growing while signatures are collected. Absent – on. */
	acrossReserve?: boolean;
	/** Filled right before the first signature. */
	resolved?: SwapResolved;
}

export interface SwapShape {
	chain: ChainConfig;
	cross: boolean;
	/** How the cross-chain leg travels. */
	route?: BridgeRoute;
	/** The same, spelled out: the bridge, the asset when it is Across', and what arrives. */
	bridge?: BridgeKind;
	asset?: AcrossAsset;
	receive?: ReceiveAsset;
	needSwap: boolean;
	nativeIn: boolean;
	nativeOut: boolean;
	/** Route endpoints (wrapped native for the native coin). */
	inAddress: Address;
	outAddress: Address;
}

/**
 * What kind of operation the parameters describe. Throws `AppError` when it cannot be done.
 * `want` is what should arrive on the other network; without it, or when no bridge carries that there, the default.
 */
export const swapShape = (p: SwapParams, chainId: number, want: ReceiveAsset | undefined = p.receive): SwapShape => {
	const chain = getChain(chainId);
	const cross = p.destChainId !== chainId;
	const nativeIn = p.tokenIn === NATIVE;
	const inAddress = nativeIn ? dexWeth(chain) : parseAddress(p.tokenIn);
	if (!inAddress) throw new AppError("swap.error.tokenIn");
	const canSwap = !!swapProviderFor(chain);
	if (cross) {
		// The coin crosses as its wrapped token, where a bridge takes that one.
		const sent = nativeIn ? chain.wrappedNative : inAddress;
		const route = bridgeRoute(chain, getChain(p.destChainId), sent, want);
		if (!route) throw new AppError("swap.error.noBridge");
		// What crosses is the token of the route; anything else is swapped into it first.
		const needSwap = !sameAddress(sent, route.token);
		if (needSwap && !canSwap) throw new AppError("swap.error.noDex");
		return {
			chain,
			cross,
			route,
			bridge: route.kind,
			asset: route.kind === "across" ? (route.receive as AcrossAsset) : undefined,
			receive: route.receive,
			needSwap,
			nativeIn,
			nativeOut: false,
			inAddress,
			outAddress: route.token,
		};
	}
	if (!canSwap) throw new AppError("swap.error.noDex");
	const nativeOut = p.tokenOut === NATIVE;
	const outAddress = nativeOut ? dexWeth(chain) : parseAddress(p.tokenOut);
	if (!outAddress) throw new AppError("swap.error.tokenOut");
	if (sameAddress(inAddress, outAddress)) throw new AppError("swap.error.sameToken");
	return { chain, cross, needSwap: true, nativeIn, nativeOut, inAddress, outAddress };
};

/** What a transfer moves, as it is called and counted on each of the two networks. */
export interface BridgeAsset {
	kind: BridgeKind;
	receive: ReceiveAsset;
	/** What it is called where it leaves and where it arrives ("ETH" for the coin, "WETH" for its token). */
	symbol: string;
	destSymbol: string;
	/** It arrives as the destination's own coin – unless the recipient is a contract, which gets the wrapped token. */
	destNative: boolean;
	/** Decimals of the token on the source network, and of its counterpart on the destination. */
	decimals: number;
	destDecimals: number;
	address: Address;
	destAddress: Address;
}

/** What a transfer of `tokenIn` between two networks moves, arriving as `want` (or as the default). */
export const bridgeAssetOf = (
	chainId: number,
	destChainId: number,
	tokenIn: string,
	want?: ReceiveAsset,
): BridgeAsset | undefined => {
	const src = getChain(chainId);
	const dst = getChain(destChainId);
	const nativeIn = tokenIn === NATIVE;
	const route = bridgeRoute(src, dst, nativeIn ? src.wrappedNative : tokenIn, want);
	if (!route) return undefined;
	const destNative = sameAddress(route.destToken, dst.wrappedNative);
	// A token is called what its own network calls it: USDT is USDT0 on some, WETH is ETH on BNB Chain.
	const name = (chain: ChainConfig, address: Address): string => findToken(chain.id, address)?.symbol ?? route.receive;
	return {
		kind: route.kind,
		receive: route.receive,
		symbol: nativeIn && sameAddress(route.token, src.wrappedNative) ? src.nativeSymbol : name(src, route.token),
		destSymbol: destNative ? dst.nativeSymbol : name(dst, route.destToken),
		destNative,
		decimals: route.decimals,
		destDecimals: route.destDecimals,
		address: route.token,
		destAddress: route.destToken,
	};
};

/** How what arrives is called: the destination's coin reaches a contract as its wrapped token. */
export const receivedSymbol = (asset: BridgeAsset, wrapped: boolean | undefined): string =>
	asset.destNative && wrapped ? `W${asset.destSymbol}` : asset.destSymbol;

/**
 * What an operation makes arrive on the other network: what it was resolved to once it has been
 * (an operation that fell back to another bridge stays that), and what was asked for until then.
 */
export const viaOf = (p: SwapParams): ReceiveAsset | undefined => {
	const found = legOf(p.resolved);
	return found ? found.provider.receiveOf(found.leg) : p.receive;
};

/** Percent string → basis points; `undefined` when out of range. */
export const slippageBps = (percent: string): number | undefined => {
	if (!isDecimal(percent, 2)) return undefined;
	const bps = Math.round(Number(percent) * 100);
	return bps >= 1 && bps <= MAX_SLIPPAGE_PERCENT * 100 ? bps : undefined;
};

export const parseAmountIn = (p: SwapParams): bigint | undefined => {
	if (!isDecimal(p.amount, p.tokenInDecimals)) return undefined;
	const raw = parseUnits(p.amount, p.tokenInDecimals);
	return raw > 0n ? raw : undefined;
};

/**
 * Who gets the outcome of the operation. Left empty it is the Safe itself; an address typed in must be
 * able to receive – and is not one of the contracts the operation works with, on the network the funds
 * arrive on or on this one.
 */
export const swapRecipientRules = (p: SwapParams, chainId: number): { contracts: (string | undefined)[] } => ({
	contracts: [
		p.tokenIn === NATIVE ? undefined : p.tokenIn,
		p.tokenOut === NATIVE ? undefined : p.tokenOut,
		...knownContracts(chainId),
		...(p.destChainId === chainId ? [] : knownContracts(p.destChainId)),
	],
});

const recipientOf = (p: SwapParams, chainId: number, safe: Address): Address =>
	p.recipient ? requireRecipient(p.recipient, swapRecipientRules(p, chainId)) : getAddress(safe);

const swapCtx = (shape: SwapShape, amountIn: bigint, safe: Address, recipient: Address): SwapCtx => ({
	chain: shape.chain,
	tokenIn: shape.inAddress,
	tokenOut: shape.outAddress,
	nativeIn: shape.nativeIn,
	nativeOut: shape.nativeOut,
	amountIn,
	safe,
	// Cross-chain: what the exchange returns lands in the Safe and crosses right after, in the same transaction.
	recipient: shape.cross ? getAddress(safe) : recipient,
});

const legCtx = (
	shape: SwapShape,
	route: BridgeRoute,
	p: SwapParams,
	amount: bigint,
	safe: Address,
	recipient: Address,
): LegCtx => ({
	src: shape.chain,
	dst: getChain(p.destChainId),
	lane: route,
	amount,
	safe,
	recipient,
	coin: shape.nativeIn && !shape.needSwap,
});

/**
 * Network part of the operation: fresh quote, minimum output, allowance state and bridge fees.
 * The result is stored in `params.resolved` and is the only input of `buildSwapCalls` besides
 * the visible parameters.
 */
export const resolveSwap = async (p: SwapParams, chainId: number, safe: Address): Promise<SwapResolved> => {
	try {
		return await resolveVia(p, chainId, safe, p.receive);
	} catch (e) {
		// A bridge that cannot carry the amount right now says so with its own error. The value can
		// still cross as USDC where another bridge carries that – a different outcome for the
		// recipient, so it is flagged and shown.
		if (!(e instanceof AppError)) throw e;
		let asked: SwapShape;
		let other: SwapShape;
		try {
			asked = swapShape(p, chainId, p.receive);
			other = swapShape(p, chainId, FALLBACK_RECEIVE);
		} catch {
			throw e;
		}
		if (!asked.route || !other.route || other.route.kind === asked.route.kind) throw e;
		if (bridgeOf(asked.route.kind).limitError !== e.key) throw e;
		return { ...(await resolveVia(p, chainId, safe, FALLBACK_RECEIVE)), fallback: true };
	}
};

const resolveVia = async (
	p: SwapParams,
	chainId: number,
	safe: Address,
	want?: ReceiveAsset,
): Promise<SwapResolved> => {
	const shape = swapShape(p, chainId, want);
	const amountIn = parseAmountIn(p);
	if (!amountIn) throw new AppError("swap.error.amount");
	const recipient = recipientOf(p, chainId, safe);
	const resolved: SwapResolved = { amountIn: amountIn.toString(), preparedAt: Date.now() };
	let crossing = amountIn;

	if (shape.needSwap) {
		const bps = slippageBps(p.slippage);
		if (!bps) throw new AppError("swap.error.slippage");
		const swaps = swapProviderFor(shape.chain);
		if (!swaps) throw new AppError("swap.error.noDex");
		resolved.swap = await swaps.resolve(swapCtx(shape, amountIn, safe, recipient), {
			slippageBps: bps,
			feeTier: p.feeTier || undefined,
		});
		// Exactly the guaranteed minimum crosses; what the exchange returns above it stays in the Safe.
		crossing = BigInt(resolved.swap.minOut);
	}

	if (shape.route) {
		const bridge = bridgeOf(shape.route.kind);
		const leg = await bridge.resolve(legCtx(shape, shape.route, p, crossing, safe, recipient), p);
		(resolved as unknown as Record<string, unknown>)[bridge.legKey] = leg;
	}
	return resolved;
};

/** A token known to the app must be described with its real decimals – amounts are shown in them. */
const checkDecimals = (chainId: number, token: string, decimals: number): void => {
	if (token === NATIVE) {
		if (decimals !== 18) mismatch();
		return;
	}
	const known = findToken(chainId, token);
	if (known && known.decimals !== decimals) mismatch();
};

/**
 * Calls the Safe makes. Pure: depends only on the parameters and static chain configuration,
 * and refuses parameters whose resolved part contradicts the visible one.
 */
export const buildSwapCalls = (p: SwapParams, chainId: number, safe: Address): MetaTx[] => {
	const r = p.resolved;
	if (!r) throw new AppError("swap.error.notPrepared");
	const crossLeg = legOf(r);
	if (crossLeg && crossLeg.count > 1) return mismatch();
	// The leg an operation carries says how it crosses; it is then checked against that very route.
	const shape = swapShape(p, chainId, viaOf(p));
	if (shape.route?.kind !== crossLeg?.provider.id) return mismatch();
	if (shape.cross && (p.receive || r.fallback)) {
		const asked = swapShape(p, chainId, p.receive);
		if (r.fallback) {
			// A fallback is what it says only when the bridge asked for is one that can run out, and another carried it.
			if (!asked.route || asked.route.kind === shape.route?.kind || !bridgeOf(asked.route.kind).limitError) {
				return mismatch();
			}
		} else if (asked.receive !== shape.receive) {
			// What was explicitly asked for is what is delivered. (An operation made before there was
			// a choice asks for nothing.)
			return mismatch();
		}
	}
	const amountIn = parseAmountIn(p);
	if (!amountIn || amountIn.toString() !== r.amountIn) return mismatch();
	checkDecimals(chainId, p.tokenIn, p.tokenInDecimals);
	const recipient = recipientOf(p, chainId, safe);
	if (!!r.swap !== shape.needSwap) return mismatch();

	const calls: MetaTx[] = [];
	let crossing = amountIn;

	if (r.swap) {
		const swaps = swapProviderFor(shape.chain);
		if (!swaps) return mismatch();
		if (!shape.cross) checkDecimals(chainId, p.tokenOut, p.tokenOutDecimals);
		calls.push(...swaps.build(swapCtx(shape, amountIn, safe, recipient), r.swap));
		crossing = BigInt(r.swap.minOut);
	}

	if (crossLeg && shape.route) {
		const ctx = legCtx(shape, shape.route, p, crossing, safe, recipient);
		calls.push(...crossLeg.provider.build(ctx, crossLeg.leg, p));
	}
	return calls;
};

/** The bridge that carries the cross-chain leg of an operation, if it has one. */
export const crossLegOf = (p: SwapParams): BridgeKind | undefined => legOf(p.resolved)?.provider.id;

export const bridgeProgressOf = (op: Operation): BridgeProgress | undefined =>
	op.result?.extra?.bridge as BridgeProgress | undefined;
