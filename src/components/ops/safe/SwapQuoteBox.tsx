import { formatUnits } from "viem";
import { Spinner } from "@/components/ui/Spinner";
import { getChain } from "@/config/chains";
import { useLang, useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { USDC_DECIMALS, type SwapParams } from "@/lib/evm/swapBuild";
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
	const outSymbol = cross ? "USDC" : params.tokenOutSymbol;
	const outDecimals = cross ? USDC_DECIMALS : params.tokenOutDecimals;
	const fmt = (raw: string, decimals: number, symbol: string): string =>
		`${formatAmount(formatUnits(BigInt(raw), decimals), lang)} ${symbol}`;

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
					{resolved.bridge && (
						<>
							{resolved.swap && (
								<SwapQuoteRow
									label={t("swap.quote.bridged")}
									value={fmt(resolved.bridge.amount, USDC_DECIMALS, "USDC")}
								/>
							)}
							<SwapQuoteRow
								label={t("swap.quote.bridgeFee")}
								value={fmt(resolved.bridge.maxFee, USDC_DECIMALS, "USDC")}
								busy={loading && !resolved.swap}
							/>
							<SwapQuoteRow
								label={t("swap.quote.receive")}
								value={fmt(resolved.bridge.receive, USDC_DECIMALS, "USDC")}
								strong
							/>
							{resolved.swap && <p className="text-base-content/60 text-xs">{t("swap.surplusNote")}</p>}
						</>
					)}
				</>
			)}
		</div>
	);
};
