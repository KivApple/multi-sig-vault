import { ArrowLeftRight } from "lucide-react";
import { useCallback } from "react";
import { formatUnits, type Address } from "viem";
import { SwapForm } from "@/components/ops/safe/SwapForm";
import { SwapResult } from "@/components/ops/safe/SwapResult";
import { useCached } from "@/hooks/useCached";
import { useOnline } from "@/hooks/useOnline";
import { useT } from "@/i18n";
import { findChain, getChain } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { acrossFeeLimit, acrossGasCost, acrossToken } from "@/lib/evm/across";
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
	swapRecipientRules,
	swapShape,
	viaOf,
	type SwapParams,
} from "@/lib/evm/swapBuild";
import { formatAmount, formatDateTime, parseAddress, sameAddress } from "@/lib/format";
import { recipientError } from "@/lib/recipient";
import { inspectTwin, twinFinding } from "@/lib/safe/creation";
import { simulateSafeTx } from "@/lib/safe/simulate";
import { toSafeTx } from "@/lib/safe/tx";
import { findToken } from "@/lib/tokens";
import { mergeNotices, useContractRecipient } from "../recipientNotices";
import type { OpDefinition, OpEnv, OpErrors, OpNotices, SummaryRow } from "../types";

const NO_NOTICES: OpNotices = { notices: [] };
const TWIN_TTL_MS = 5 * 60_000;

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
	// Sent to the Safe's own address on another network: is there a Safe at that address yet?
	useNotices: (p, env) => {
		const t = useT();
		const { account, safe } = env;
		const online = useOnline();
		const network = findChain(p.destChainId)?.name ?? String(p.destChainId);

		// Sent to the Safe's own address on another network: is there a Safe at that address, and whose?
		const toTwin = p.destChainId !== account.chainId && !p.recipient;
		const owners = safe?.owners;
		const threshold = safe?.threshold;
		const twinFetcher = useCallback(
			() => inspectTwin(account, p.destChainId, owners && threshold ? { owners, threshold } : undefined),
			[account, p.destChainId, owners, threshold],
		);
		// A Safe may be created at the address at any moment, by anyone: the answer is kept for five minutes.
		const twin = useCached(toTwin ? `twin:${account.id}:${p.destChainId}` : null, twinFetcher, TWIN_TTL_MS);
		let twinNotices: OpNotices = NO_NOTICES;
		if (toTwin) {
			const notice = (kind: string): OpNotices => ({
				notices: [
					{
						// A tick is for this network and this finding, not for the next one.
						id: `twin:${p.destChainId}:${kind}`,
						text: t(`swap.twin.${kind}`, { network }),
						confirm: t("swap.twin.confirm", { network }),
					},
				],
				refresh: () => void twin.refresh(),
				checking: twin.loading,
			});
			const finding = twin.data && twinFinding(twin.data);
			// Without a network there is nothing to wait for: a device that signs offline says it could
			// not look, and lets the signer decide.
			if (!twin.data)
				twinNotices = twin.error !== undefined || !online ? notice("unknown") : { notices: [], pending: true };
			else if (finding) twinNotices = notice(finding);
		}

		// Somebody else's address typed in: is it a contract on the network the funds arrive on?
		const contract = useContractRecipient(p.destChainId, p.recipient, env);

		// A fee fixed earlier – by another device, or imported – is weighed again against the gas price
		// this device sees. Too high is pointed out, not refused: gas may simply have fallen since.
		const leg = p.resolved?.across;
		const feeFetcher = useCallback(async () => {
			if (!leg) return true;
			const src = acrossToken(account.chainId as number, leg.asset);
			const dst = acrossToken(p.destChainId, leg.asset);
			const gas = await acrossGasCost(p.destChainId, dst, src);
			return BigInt(leg.fee) <= acrossFeeLimit(BigInt(leg.amount), gas);
		}, [leg, account.chainId, p.destChainId]);
		const fair = useCached(
			leg ? `across-fee:${p.destChainId}:${leg.amount}:${leg.fee}` : null,
			feeFetcher,
			TWIN_TTL_MS,
		);
		const feeNotices: OpNotices =
			leg && fair.data === false
				? {
						notices: [
							{
								id: `across-fee:${leg.fee}`,
								text: t("swap.across.feeHigh", { network }),
								confirm: t("swap.across.feeConfirm"),
							},
						],
						refresh: () => void fair.refresh(),
						checking: fair.loading,
					}
				: NO_NOTICES;

		return mergeNotices(twinNotices, contract, feeNotices);
	},
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
		// Empty is the Safe's own address; anything typed goes through the same check as every recipient.
		const r = p.recipient ? recipientError(p.recipient, t, swapRecipientRules(p, chainId)) : undefined;
		if (r) errors.recipient = r;
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
