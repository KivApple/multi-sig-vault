import { encodeFunctionData, getAddress, parseUnits, type Address, type Hex } from "viem";
import { getChain, type ChainConfig } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { isDecimal, parseAddress, sameAddress } from "@/lib/format";
import { getPublicClient } from "@/lib/rpc";
import { ERC20_ABI } from "@/lib/safe/abis";
import type { MetaTx } from "@/lib/safe/tx";
import type { Operation } from "@/types/domain";
import { findToken } from "@/lib/tokens";
import {
	bpsFee,
	CCTP_BURN_LIMIT,
	encodeBurn,
	fetchCctpFees,
	FINALITY_FAST,
	FINALITY_STANDARD,
	tokenMessengerOf,
	type Finality,
	type ForwardLevel,
} from "./cctp";
import { dexWeth, encodePath, quoteMany, ROUTER02_ABI } from "./dex";

/** Marker of the chain's native coin in `tokenIn` / `tokenOut`. */
export const NATIVE = "native";
export const USDC_DECIMALS = 6;
/** Signatures may take hours to collect – the swap stays valid this long after preparation. */
export const SWAP_DEADLINE_SECONDS = 48 * 3600;
export const SLIPPAGE_CHOICES = ["0.5", "1", "3", "5", "10"];
export const MAX_SLIPPAGE_PERCENT = 50;

export interface SwapLeg {
	/** Token addresses along the route (wrapped native for the native coin). */
	tokens: Address[];
	/** Pool fee per hop, hundredths of a bip. */
	fees: number[];
	/** Quoted output at preparation time, raw units. */
	quoteOut: string;
	/** Guaranteed minimum output (quote minus slippage), raw units. */
	minOut: string;
	/** Unix seconds. */
	deadline: number;
	/** Token needs its allowance zeroed first (USDT-style approve). */
	resetAllowance: boolean;
	/** Price impact of the trade size, basis points (when it could be estimated). */
	impactBps?: number;
}

export interface BridgeLeg {
	/** USDC burned on the source chain, raw units. */
	amount: string;
	/** Exact `maxFee` of the burn: forwarding fee + percentage fee. */
	maxFee: string;
	forwardFee: string;
	percentFee: string;
	finality: Finality;
	forward: boolean;
	/** USDC the recipient gets on the destination chain (amount − maxFee). */
	receive: string;
}

export interface SwapResolved {
	amountIn: string;
	swap?: SwapLeg;
	bridge?: BridgeLeg;
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
	/** Same-chain swaps only; cross-chain output is USDC of the destination chain. */
	tokenOut: string;
	tokenOutSymbol: string;
	tokenOutDecimals: number;
	/** Empty – this Safe's own address. */
	recipient: string;
	/** Percent, e.g. "1". */
	slippage: string;
	/** Pinned pool fee tier of the first hop; 0 – best route. */
	feeTier: number;
	speed: "standard" | "fast";
	/** Circle submits the mint on the destination chain and deducts its cost from the transfer. */
	forward: boolean;
	forwardLevel: ForwardLevel;
	/** Filled right before the first signature; everything the signed transaction depends on. */
	resolved?: SwapResolved;
}

export interface SwapShape {
	chain: ChainConfig;
	cross: boolean;
	needSwap: boolean;
	nativeIn: boolean;
	nativeOut: boolean;
	/** Route endpoints (wrapped native for the native coin). */
	inAddress: Address;
	outAddress: Address;
}

/** What kind of operation the parameters describe. Throws `AppError` when it cannot be done. */
export const swapShape = (p: SwapParams, chainId: number): SwapShape => {
	const chain = getChain(chainId);
	const cross = p.destChainId !== chainId;
	const nativeIn = p.tokenIn === NATIVE;
	const inAddress = nativeIn ? dexWeth(chain) : parseAddress(p.tokenIn);
	if (!inAddress) throw new AppError("swap.error.tokenIn");
	if (cross) {
		const dest = getChain(p.destChainId);
		if (dest.env !== chain.env || !chain.cctp || !dest.cctp || !chain.usdc || !dest.usdc) {
			throw new AppError("swap.error.noBridge");
		}
		const needSwap = nativeIn || !sameAddress(inAddress, chain.usdc);
		if (needSwap && !chain.dex) throw new AppError("swap.error.noDex");
		return { chain, cross, needSwap, nativeIn, nativeOut: false, inAddress, outAddress: chain.usdc };
	}
	if (!chain.dex) throw new AppError("swap.error.noDex");
	const nativeOut = p.tokenOut === NATIVE;
	const outAddress = nativeOut ? dexWeth(chain) : parseAddress(p.tokenOut);
	if (!outAddress) throw new AppError("swap.error.tokenOut");
	if (sameAddress(inAddress, outAddress)) throw new AppError("swap.error.sameToken");
	return { chain, cross, needSwap: true, nativeIn, nativeOut, inAddress, outAddress };
};

/** Percent string → basis points; `undefined` when out of range. */
export const slippageBps = (percent: string): number | undefined => {
	if (!isDecimal(percent, 2)) return undefined;
	const bps = Math.round(Number(percent) * 100);
	return bps >= 1 && bps <= MAX_SLIPPAGE_PERCENT * 100 ? bps : undefined;
};

export const applySlippage = (amountOut: bigint, bps: number): bigint => (amountOut * BigInt(10_000 - bps)) / 10_000n;

export const parseAmountIn = (p: SwapParams): bigint | undefined => {
	if (!isDecimal(p.amount, p.tokenInDecimals)) return undefined;
	const raw = parseUnits(p.amount, p.tokenInDecimals);
	return raw > 0n ? raw : undefined;
};

export const finalityOf = (p: SwapParams): Finality => (p.speed === "fast" ? FINALITY_FAST : FINALITY_STANDARD);

/** Fast transfers are not offered when burning on HyperEVM. */
export const fastAvailable = (chainId: number): boolean => getChain(chainId).key !== "hyperevm";

/**
 * Network part of the operation: fresh quote, minimum output, allowance state and bridge fees.
 * The result is stored in `params.resolved` and is the only input of `buildSwapCalls` besides
 * the visible parameters.
 */
export const resolveSwap = async (p: SwapParams, chainId: number, safe: Address): Promise<SwapResolved> => {
	const shape = swapShape(p, chainId);
	const amountIn = parseAmountIn(p);
	if (!amountIn) throw new AppError("swap.error.amount");
	const resolved: SwapResolved = { amountIn: amountIn.toString(), preparedAt: Date.now() };
	let bridgeAmount = amountIn;

	if (shape.needSwap) {
		const bps = slippageBps(p.slippage);
		if (!bps) throw new AppError("swap.error.slippage");
		const probe = amountIn / 1000n;
		const request = { tokenIn: shape.inAddress, tokenOut: shape.outAddress, fee: p.feeTier || undefined };
		const [quote, small] = await quoteMany(chainId, [
			{ ...request, amountIn },
			{ ...request, amountIn: probe },
		]);
		if (!quote) throw new AppError("swap.error.noRoute");
		const minOut = applySlippage(quote.amountOut, bps);
		if (minOut <= 0n) throw new AppError("swap.error.noRoute");
		let impactBps: number | undefined;
		if (small && small.amountOut > 0n && probe > 0n) {
			// Output per unit at a 1000× smaller size approximates the pool price.
			const ideal = small.amountOut * 1000n;
			impactBps = Math.max(0, Number(((ideal - quote.amountOut) * 10_000n) / ideal));
		}
		let resetAllowance = false;
		if (!shape.nativeIn) {
			const allowance = await getPublicClient(chainId).readContract({
				address: shape.inAddress,
				abi: ERC20_ABI,
				functionName: "allowance",
				args: [safe, (shape.chain.dex as NonNullable<ChainConfig["dex"]>).router],
			});
			resetAllowance = allowance > 0n;
		}
		resolved.swap = {
			tokens: quote.tokens.map((t) => getAddress(t)),
			fees: quote.fees,
			quoteOut: quote.amountOut.toString(),
			minOut: minOut.toString(),
			deadline: Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS,
			resetAllowance,
			impactBps,
		};
		bridgeAmount = minOut;
	}

	if (shape.cross) {
		const finality = fastAvailable(chainId) ? finalityOf(p) : FINALITY_STANDARD;
		const fees = await fetchCctpFees(chainId, p.destChainId, finality, p.forward);
		const percentFee = bpsFee(bridgeAmount, fees.minimumFeeBps);
		const forwardFee = p.forward && fees.forwardFee ? fees.forwardFee[p.forwardLevel] : 0n;
		// Exactly what the API quotes: with forwarding the whole maxFee is consumed, so no buffer.
		const maxFee = percentFee + forwardFee;
		if (bridgeAmount > CCTP_BURN_LIMIT) throw new AppError("swap.error.burnLimit");
		if (bridgeAmount <= maxFee) throw new AppError("swap.error.belowFee");
		resolved.bridge = {
			amount: bridgeAmount.toString(),
			maxFee: maxFee.toString(),
			forwardFee: forwardFee.toString(),
			percentFee: percentFee.toString(),
			finality,
			forward: p.forward,
			receive: (bridgeAmount - maxFee).toString(),
		};
	}
	return resolved;
};

const mismatch = (): never => {
	throw new AppError("ops.error.mismatch");
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
	const shape = swapShape(p, chainId);
	const amountIn = parseAmountIn(p);
	if (!amountIn || amountIn.toString() !== r.amountIn) return mismatch();
	checkDecimals(chainId, p.tokenIn, p.tokenInDecimals);
	const recipient = p.recipient ? parseAddress(p.recipient) : getAddress(safe);
	if (!recipient) throw new AppError("swap.error.recipient");
	if (!!r.swap !== shape.needSwap || !!r.bridge !== shape.cross) return mismatch();

	const calls: MetaTx[] = [];
	let bridgeAmount = amountIn;

	if (r.swap) {
		const leg = r.swap;
		const dex = shape.chain.dex as NonNullable<ChainConfig["dex"]>;
		if (!shape.cross) checkDecimals(chainId, p.tokenOut, p.tokenOutDecimals);
		if (
			leg.tokens.length < 2 ||
			leg.fees.length !== leg.tokens.length - 1 ||
			!sameAddress(leg.tokens[0], shape.inAddress) ||
			!sameAddress(leg.tokens[leg.tokens.length - 1], shape.outAddress) ||
			leg.fees.some((f) => !dex.feeTiers.includes(f))
		) {
			return mismatch();
		}
		const minOut = BigInt(leg.minOut);
		if (minOut <= 0n) return mismatch();
		// Cross-chain: USDC lands in the Safe and is burned right after, in the same transaction.
		const swapRecipient = shape.cross ? getAddress(safe) : recipient;
		if (!shape.nativeIn) {
			const approve = (amount: bigint): MetaTx => ({
				to: shape.inAddress,
				value: 0n,
				data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [dex.router, amount] }),
			});
			if (leg.resetAllowance) calls.push(approve(0n));
			calls.push(approve(amountIn));
		}
		const inner: Hex[] = [
			encodeFunctionData({
				abi: ROUTER02_ABI,
				functionName: "exactInput",
				args: [
					{
						path: encodePath({ tokens: leg.tokens, fees: leg.fees }),
						// Native out: the router keeps the wrapped coin and unwraps it to the recipient.
						recipient: shape.nativeOut ? dex.router : swapRecipient,
						amountIn,
						amountOutMinimum: minOut,
					},
				],
			}),
		];
		if (shape.nativeOut) {
			inner.push(encodeFunctionData({ abi: ROUTER02_ABI, functionName: "unwrapWETH9", args: [minOut, swapRecipient] }));
		}
		calls.push({
			to: dex.router,
			value: shape.nativeIn ? amountIn : 0n,
			data: encodeFunctionData({ abi: ROUTER02_ABI, functionName: "multicall", args: [BigInt(leg.deadline), inner] }),
		});
		bridgeAmount = minOut;
	}

	if (r.bridge) {
		const leg = r.bridge;
		const usdc = shape.chain.usdc as Address;
		const amount = BigInt(leg.amount);
		const maxFee = BigInt(leg.maxFee);
		if (amount !== bridgeAmount || maxFee >= amount || maxFee < 0n) return mismatch();
		if (maxFee !== BigInt(leg.forwardFee) + BigInt(leg.percentFee)) return mismatch();
		if ((amount - maxFee).toString() !== leg.receive || leg.forward !== p.forward) return mismatch();
		if (leg.finality !== FINALITY_FAST && leg.finality !== FINALITY_STANDARD) return mismatch();
		if (!leg.forward && BigInt(leg.forwardFee) !== 0n) return mismatch();
		const messenger = tokenMessengerOf(chainId);
		calls.push({
			to: usdc,
			value: 0n,
			data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [messenger, amount] }),
		});
		calls.push({
			to: messenger,
			value: 0n,
			data: encodeBurn({
				amount,
				dstChainId: p.destChainId,
				recipient,
				usdc,
				maxFee,
				finality: leg.finality,
				forward: leg.forward,
			}),
		});
	}
	return calls;
};

/** Progress of the cross-chain leg, kept in `op.result.extra.bridge`. */
export interface BridgeProgress {
	stage: "burned" | "attested" | "credited";
	nonce?: string;
	attestedAt?: number;
	mintTxHash?: string;
	claimTxHash?: string;
}

export const bridgeProgressOf = (op: Operation): BridgeProgress | undefined =>
	op.result?.extra?.bridge as BridgeProgress | undefined;
