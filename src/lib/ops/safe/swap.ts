import { ArrowLeftRight } from "lucide-react";
import { formatUnits, type Address } from "viem";
import { SwapForm } from "@/components/ops/safe/SwapForm";
import { SwapResult } from "@/components/ops/safe/SwapResult";
import { findChain, getChain } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { bridgeOf, bridgeRoute, legOf } from "@/lib/evm/bridges";
import {
	bridgeAssetOf,
	bridgeProgressOf,
	buildSwapCalls,
	MAX_SLIPPAGE_PERCENT,
	NATIVE,
	parseAmountIn,
	receivedSymbol,
	resolveSwap,
	slippageBps,
	swapShape,
	viaOf,
	type SwapParams,
} from "@/lib/evm/swapBuild";
import { formatAmount, formatDateTime, parseAddress, sameAddress } from "@/lib/format";
import { simulateSafeTx } from "@/lib/safe/simulate";
import { toSafeTx } from "@/lib/safe/tx";
import { findToken } from "@/lib/tokens";
import type { OpDefinition, OpEnv, OpErrors, SummaryRow } from "../types";

export type { BridgeProgress, SwapParams } from "@/lib/evm/swapBuild";

const holdingOf = (env: OpEnv, token: string) =>
	env.safe?.holdings.find((h) => (token === NATIVE ? !h.token : !!h.token && sameAddress(h.token.address, token)));

/** The token being sent, as the bridges see it: the wrapped token stands for the coin. */
const tokenOf = (p: SwapParams, chain: { wrappedNative: Address }): string =>
	p.tokenIn === NATIVE ? chain.wrappedNative : p.tokenIn;

const feeLabel = (fee: number): string => `${fee / 10_000}%`;

const symbolOf = (chainId: number, address: Address): string => {
	const chain = getChain(chainId);
	if (sameAddress(address, chain.dex?.weth ?? chain.wrappedNative)) return `W${chain.nativeSymbol}`;
	return findToken(chainId, address)?.symbol ?? `${address.slice(0, 6)}…`;
};

export const swapOp: OpDefinition<SwapParams> = {
	type: "safe.swap",
	kind: "safe",
	icon: ArrowLeftRight,
	available: (env) => {
		const chain = findChain(env.account.chainId);
		return !!chain && (!!chain.dex || !!chain.cctp || !!chain.across);
	},
	defaults: (env) => {
		const chain = getChain(env.account.chainId as number);
		const held = [...(env.safe?.holdings ?? [])].filter((h) => h.balance !== "0").sort((a, b) => b.usd - a.usd)[0];
		const tokenIn = held?.token ? held.token.address : NATIVE;
		const inIsUsdc = sameAddress(tokenIn, chain.usdc);
		const outToken = !inIsUsdc && chain.usdc ? findToken(chain.id, chain.usdc) : undefined;
		return {
			tokenIn,
			tokenInSymbol: held?.symbol ?? chain.nativeSymbol,
			tokenInDecimals: held?.decimals ?? 18,
			amount: "",
			destChainId: chain.id,
			tokenOut: outToken ? outToken.address : tokenIn === NATIVE ? "" : NATIVE,
			tokenOutSymbol: outToken ? outToken.symbol : tokenIn === NATIVE ? "" : chain.nativeSymbol,
			tokenOutDecimals: outToken ? outToken.decimals : 18,
			recipient: "",
			slippage: "1",
			feeTier: 0,
			speed: "standard",
			forward: true,
			forwardLevel: "med",
		};
	},
	Form: SwapForm,
	validate: (p, env, t) => {
		const errors: OpErrors = {};
		const chainId = env.account.chainId as number;
		const cross = p.destChainId !== chainId;
		const dest = findChain(p.destChainId);
		if (!dest || dest.env !== env.account.env || (cross && !bridgeRoute(getChain(chainId), dest))) {
			errors.destChainId = t("swap.error.noBridge");
		}
		const amountIn = parseAmountIn(p);
		if (!p.amount) errors.amount = t("error.required");
		else if (!amountIn) errors.amount = t("swap.error.amount");
		else {
			const holding = holdingOf(env, p.tokenIn);
			if (holding && amountIn > BigInt(holding.balance)) errors.amount = t("swap.error.balance");
		}
		if (!cross && !p.tokenOut) errors.tokenOut = t("error.required");
		if (p.recipient && !parseAddress(p.recipient)) errors.recipient = t("error.invalidAddress");
		if (!slippageBps(p.slippage)) errors.slippage = t("swap.error.slippage", { max: MAX_SLIPPAGE_PERCENT });
		if (Object.keys(errors).length === 0) {
			try {
				swapShape(p, chainId);
			} catch (e) {
				const key = e instanceof AppError ? e.key : "swap.error.amount";
				errors[key === "swap.error.tokenIn" ? "tokenIn" : cross ? "destChainId" : "tokenOut"] = t(key);
			}
		}
		return errors;
	},
	prepare: async (p, env) => {
		const chainId = env.account.chainId as number;
		const safe = env.account.address;
		const params: SwapParams = { ...p, resolved: await resolveSwap(p, chainId, safe) };
		// Dry-run exactly what will be signed; a revert now saves a round of signatures.
		const tx = toSafeTx(buildSwapCalls(params, chainId, safe), 0);
		const sim = await simulateSafeTx(chainId, safe, tx);
		if (!sim.success) throw new AppError("swap.error.simulation", { detail: sim.reason || "?" });
		return params;
	},
	buildSafe: (p, ctx) => buildSwapCalls(p, ctx.chainId, ctx.safe),
	summary: (p, { t, lang, account }) => {
		const chainId = account.chainId as number;
		const chain = getChain(chainId);
		const r = p.resolved;
		const cross = p.destChainId !== chainId;
		const dest = findChain(p.destChainId);
		const rows: SummaryRow[] = [
			{ label: t("swap.sum.sell"), value: `${formatAmount(p.amount, lang)} ${p.tokenInSymbol}` },
		];
		if (!r) return rows;
		const amount = (raw: string, decimals: number, symbol: string): string =>
			`${formatAmount(formatUnits(BigInt(raw), decimals), lang)} ${symbol}`;
		// What crosses, and through which bridge: read from the leg the operation carries.
		const crossing = legOf(r);
		const asset = cross ? bridgeAssetOf(chainId, p.destChainId, p.tokenIn, viaOf(p)) : undefined;
		if (r.swap) {
			rows.push({
				label: t("swap.sum.minOut"),
				value: asset
					? amount(r.swap.minOut, asset.decimals, asset.symbol)
					: amount(r.swap.minOut, p.tokenOutDecimals, p.tokenOutSymbol),
			});
			rows.push({
				label: t("swap.sum.route"),
				value: `${r.swap.tokens.map((a) => symbolOf(chainId, a)).join(" → ")} · ${r.swap.fees.map(feeLabel).join(" + ")} · ${chain.dex?.name ?? ""}`,
			});
			rows.push({ label: t("swap.sum.deadline"), value: formatDateTime(r.swap.deadline * 1000, lang) });
		}
		if (crossing && asset) {
			const view = crossing.provider.view(crossing.leg, t);
			rows.push({ label: t("swap.sum.networks"), value: `${chain.name} → ${dest?.name ?? p.destChainId}` });
			if (r.fallback) {
				// The bridge it was meant for: the one the token takes when nothing is in the way.
				const asked = bridgeRoute(chain, getChain(p.destChainId), tokenOf(p, chain), p.receive);
				const bridge = asked ? bridgeOf(asked.kind).name : "";
				rows.push({
					label: t("swap.sum.fallback", { bridge }),
					value: t("swap.sum.fallbackValue", { bridge }),
					tone: "warning",
				});
			}
			if (r.swap) rows.push({ label: t("swap.sum.bridged"), value: amount(view.amount, asset.decimals, asset.symbol) });
			rows.push({
				label: t("swap.sum.bridgeFee"),
				value: `${amount(view.fee, asset.decimals, asset.symbol)} · ${view.feeNote}`,
			});
			rows.push({
				label: t("swap.sum.receive"),
				value: amount(view.output, asset.destDecimals, receivedSymbol(asset, view.wrapped)),
			});
		}
		rows.push({
			label: t("swap.sum.recipient"),
			address: (parseAddress(p.recipient) ?? account.address) as Address,
			chainId: p.destChainId,
		});
		if (crossing && dest) {
			rows.push(...(crossing.provider.summaryRows?.(crossing.leg, { src: chain, dst: dest, t }) ?? []));
		}
		if (r.swap && crossing) {
			rows.push({
				label: t("swap.sum.surplus"),
				value: t("swap.sum.surplusValue", { symbol: asset?.symbol ?? "" }),
			});
		}
		return rows;
	},
	Result: SwapResult,
	unfinished: (op) => {
		const crossing = legOf((op.params as unknown as SwapParams).resolved);
		return !!crossing && crossing.provider.unfinished(bridgeProgressOf(op));
	},
	deleteWarning: (op) => {
		const crossing = legOf((op.params as unknown as SwapParams).resolved);
		if (!crossing || op.result?.extra?.txStatus === "reverted") return undefined;
		return crossing.provider.deleteWarning?.(bridgeProgressOf(op));
	},
};
