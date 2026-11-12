import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import { getChain } from "@/config/chains";
import { useLang, useT } from "@/i18n";
import { expectedGasPrice, FEE_SPEEDS, quoteFees, type FeeQuote, type FeeSpeed } from "@/lib/evm/fees";
import { formatAmount } from "@/lib/format";
import { useAppStore } from "@/store/appStore";

export interface FeeChoiceProps {
	chainId: number;
	/** Gas the transaction is expected to use; `null` – being estimated, `undefined` – unknown. */
	gas: bigint | null | undefined;
}

const REFRESH_MS = 12_000;

/**
 * Network fee of the transaction about to be sent, with a choice between a cheaper and a faster one
 * wherever the chain has a tip market. The choice is the app-wide setting the wallets read.
 */
export const FeeChoice: React.FC<FeeChoiceProps> = ({ chainId, gas }) => {
	const t = useT();
	const lang = useLang();
	const speed = useAppStore((s) => s.settings.feeSpeed);
	const updateSettings = useAppStore((s) => s.updateSettings);
	const [quotes, setQuotes] = useState<Record<FeeSpeed, FeeQuote>>();
	const chain = getChain(chainId);

	useEffect(() => {
		let stale = false;
		const load = (): void => {
			quoteFees(chainId)
				.then((q) => !stale && setQuotes(q))
				.catch(() => undefined);
		};
		setQuotes(undefined);
		load();
		const timer = setInterval(load, REFRESH_MS);
		return () => {
			stale = true;
			clearInterval(timer);
		};
	}, [chainId]);

	const cost = (s: FeeSpeed): string | undefined =>
		quotes && typeof gas === "bigint"
			? `≈ ${formatAmount(formatUnits(gas * expectedGasPrice(quotes[s]), 18), lang, 6)} ${chain.nativeSymbol}`
			: undefined;
	const hasChoice = !!quotes && expectedGasPrice(quotes.slow) !== expectedGasPrice(quotes.fast);
	const waiting = gas === null || (!quotes && gas !== undefined);

	return (
		<div className="bg-base-200 rounded-field mb-3 flex flex-col gap-2 px-3 py-2 text-sm">
			<div className="flex items-center justify-between">
				<span className="text-base-content/70">{t("ops.networkFee")}</span>
				{waiting ? <Spinner size="xs" /> : <span className="tabular font-medium">{cost(speed) ?? "—"}</span>}
			</div>
			{hasChoice && (
				<Segmented
					value={speed}
					options={FEE_SPEEDS.map((s) => ({ value: s, label: t(`ops.fee.${s}`) }))}
					onChange={(s) => updateSettings({ feeSpeed: s })}
					size="sm"
					ariaLabel={t("ops.networkFee")}
				/>
			)}
			{hasChoice && speed === "slow" && <p className="text-base-content/60 text-xs">{t("ops.fee.slowHint")}</p>}
		</div>
	);
};
