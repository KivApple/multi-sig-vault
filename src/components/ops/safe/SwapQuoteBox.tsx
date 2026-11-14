import { TriangleAlert } from "lucide-react";
import { formatUnits } from "viem";
import { Spinner } from "@/components/ui/Spinner";
import { getChain } from "@/config/chains";
import { useLang, useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { bridgeOf, bridgeRoute, legOf } from "@/lib/evm/bridges";
import { bridgeAssetOf, NATIVE, receivedSymbol, viaOf, type SwapParams } from "@/lib/evm/swapBuild";
import type { SwapPreview } from "@/lib/evm/useSwapPreview";
import { formatAmount } from "@/lib/format";
import { SwapQuoteRow } from "./SwapQuoteRow";

export interface SwapQuoteBoxProps {
	params: SwapParams;
	preview: SwapPreview;
	chainId: number;
}

/** Above this price impact the row turns into a warning. */
const IMPACT_WARN_BPS = 300;

/** What the operation would do right now: quote, guaranteed minimum, fees. Final numbers are fixed when signing starts. */
export const SwapQuoteBox: React.FC<SwapQuoteBoxProps> = ({ params, preview, chainId }) => {
	const t = useT();
	const lang = useLang();
	const { resolved, error, loading } = preview;
	if (!resolved && !error && !loading) return null;

	const cross = params.destChainId !== chainId;
	// What crosses, and through which bridge: read from the leg the quote resolved to.
	const crossing = legOf(resolved);
	const view = crossing?.provider.view(crossing.leg, t);
	const asset = cross
		? bridgeAssetOf(chainId, params.destChainId, params.tokenIn, viaOf({ ...params, resolved }))
		: undefined;
	const outSymbol = asset ? asset.symbol : params.tokenOutSymbol;
	const outDecimals = asset ? asset.decimals : params.tokenOutDecimals;
	const fmt = (raw: string, decimals: number, symbol: string): string =>
		`${formatAmount(formatUnits(BigInt(raw), decimals), lang)} ${symbol}`;
	// The bridge the transfer was meant for, when another one carries it instead.
	const chain = getChain(chainId);
	const asked =
		resolved?.fallback && cross
			? bridgeRoute(
					chain,
					getChain(params.destChainId),
					params.tokenIn === NATIVE ? chain.wrappedNative : params.tokenIn,
					params.receive,
				)
			: undefined;

	return (
		<div className="bg-base-200 rounded-box flex flex-col gap-1.5 px-3 py-2.5 text-sm" aria-live="polite">
			{error && !loading ? (
				<p className="text-error">{describeError(error, t)}</p>
			) : !resolved ? (
				<p className="text-base-content/60 flex items-center gap-2">
					<Spinner size="xs" />
					{t("swap.quoting")}
				</p>
			) : (
				<>
					{resolved.fallback && (
						<p className="text-warning flex items-start gap-1.5">
							<TriangleAlert className="mt-0.5 size-4 shrink-0" />
							{t("swap.fallbackWarning", {
								symbol: params.tokenInSymbol,
								bridge: asked ? bridgeOf(asked.kind).name : "",
							})}
						</p>
					)}
					{resolved.swap && (
						<>
							<SwapQuoteRow
								label={t("swap.quote.out")}
								value={fmt(resolved.swap.quoteOut, outDecimals, outSymbol)}
								busy={loading}
							/>
							<SwapQuoteRow label={t("swap.quote.minOut")} value={fmt(resolved.swap.minOut, outDecimals, outSymbol)} />
							{resolved.swap.impactBps !== undefined && (
								<SwapQuoteRow
									label={t("swap.quote.impact")}
									value={`${(resolved.swap.impactBps / 100).toFixed(2)}%`}
									warn={resolved.swap.impactBps >= IMPACT_WARN_BPS}
								/>
							)}
							<SwapQuoteRow
								label={t("swap.quote.poolFee")}
								value={`${resolved.swap.fees.map((f) => `${f / 10_000}%`).join(" + ")} · ${getChain(chainId).dex?.name ?? ""}`}
							/>
						</>
					)}
					{view && asset && (
						<>
							{resolved.swap && (
								<SwapQuoteRow label={t("swap.quote.bridged")} value={fmt(view.amount, asset.decimals, asset.symbol)} />
							)}
							<SwapQuoteRow
								label={t("swap.quote.bridgeFee")}
								value={`${fmt(view.fee, asset.decimals, asset.symbol)} · ${view.feeNote}`}
								busy={loading && !resolved.swap}
							/>
							<SwapQuoteRow
								label={t("swap.quote.receive")}
								value={fmt(view.output, asset.destDecimals, receivedSymbol(asset, view.wrapped))}
								strong
							/>
							{resolved.swap && (
								<p className="text-base-content/60 text-xs">{t("swap.surplusNote", { symbol: asset.symbol })}</p>
							)}
						</>
					)}
				</>
			)}
		</div>
	);
};
