import { ArrowLeftRight } from "lucide-react";
import { formatUnits, type Address } from "viem";
import { SwapForm } from "@/components/ops/safe/SwapForm";
import { SwapResult } from "@/components/ops/safe/SwapResult";
import { findChain, getChain } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { FINALITY_FAST } from "@/lib/evm/cctp";
import {
	bridgeProgressOf,
	buildSwapCalls,
	MAX_SLIPPAGE_PERCENT,
	NATIVE,
	parseAmountIn,
	resolveSwap,
	slippageBps,
	swapShape,
	USDC_DECIMALS,
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
		return !!chain && (!!chain.dex || !!chain.cctp);
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
		if (!dest || dest.env !== env.account.env || (cross && !dest.cctp)) errors.destChainId = t("swap.error.noBridge");
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
		const usdc = (raw: string): string => `${formatAmount(formatUnits(BigInt(raw), USDC_DECIMALS), lang)} USDC`;
		if (r.swap) {
			const outDecimals = cross ? USDC_DECIMALS : p.tokenOutDecimals;
			const outSymbol = cross ? "USDC" : p.tokenOutSymbol;
			rows.push({
				label: t("swap.sum.minOut"),
				value: `${formatAmount(formatUnits(BigInt(r.swap.minOut), outDecimals), lang)} ${outSymbol}`,
			});
			rows.push({
				label: t("swap.sum.route"),
				value: `${r.swap.tokens.map((a) => symbolOf(chainId, a)).join(" → ")} · ${r.swap.fees.map(feeLabel).join(" + ")} · ${chain.dex?.name ?? ""}`,
			});
			rows.push({ label: t("swap.sum.deadline"), value: formatDateTime(r.swap.deadline * 1000, lang) });
		}
		if (r.bridge) {
			rows.push({ label: t("swap.sum.networks"), value: `${chain.name} → ${dest?.name ?? p.destChainId}` });
			if (r.swap) rows.push({ label: t("swap.sum.bridged"), value: usdc(r.bridge.amount) });
			rows.push({
				label: t("swap.sum.bridgeFee"),
				value: `${usdc(r.bridge.maxFee)} · ${t(r.bridge.finality === FINALITY_FAST ? "swap.speed.fast" : "swap.speed.standard")}${
					r.bridge.forward ? "" : ` · ${t("swap.sum.selfMint")}`
				}`,
			});
			rows.push({ label: t("swap.sum.receive"), value: usdc(r.bridge.receive) });
		}
		rows.push({
			label: t("swap.sum.recipient"),
			address: (parseAddress(p.recipient) ?? account.address) as Address,
			chainId: p.destChainId,
		});
		if (r.swap && r.bridge) rows.push({ label: t("swap.sum.surplus"), value: t("swap.sum.surplusValue") });
		return rows;
	},
	Result: SwapResult,
	unfinished: (op) => {
		const p = op.params as unknown as SwapParams;
		return !!p.resolved?.bridge && bridgeProgressOf(op)?.stage !== "credited";
	},
	deleteWarning: (op) => {
		const p = op.params as unknown as SwapParams;
		if (!p.resolved?.bridge) return undefined;
		if (op.result?.extra?.txStatus === "reverted") return undefined;
		return bridgeProgressOf(op)?.stage === "credited" ? undefined : "swap.deleteWarning";
	},
};
