import { useCallback, useMemo } from "react";
import { Field } from "@/components/ui/Field";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import { getChain } from "@/config/chains";
import { useT } from "@/i18n";
import { SLIPPAGE_CHOICES, type SwapParams } from "@/lib/evm/swapBuild";

export interface SwapTradeOptionsProps {
	value: SwapParams;
	onChange: (patch: Partial<SwapParams>) => void;
	chainId: number;
	/** Slippage validation message. */
	error?: string;
}

const CUSTOM = "custom";

/** Slippage tolerance and pool fee tier of the swap leg. */
export const SwapTradeOptions: React.FC<SwapTradeOptionsProps> = ({ value, onChange, chainId, error }) => {
	const t = useT();
	const tiers = getChain(chainId).dex?.feeTiers;
	const preset = SLIPPAGE_CHOICES.includes(value.slippage);

	const slippageOptions = useMemo<SegmentedOption<string>[]>(
		() => [...SLIPPAGE_CHOICES.map((c) => ({ value: c, label: `${c}%` })), { value: CUSTOM, label: t("swap.custom") }],
		[t],
	);
	const handleSlippage = useCallback((v: string) => onChange({ slippage: v === CUSTOM ? "" : v }), [onChange]);
	const handleCustom = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) =>
			onChange({ slippage: e.target.value.replace(",", ".").replace(/[^\d.]/g, "") }),
		[onChange],
	);
	const handleTier = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => onChange({ feeTier: Number(e.target.value) }),
		[onChange],
	);

	return (
		<>
			<Field label={t("swap.slippage")} error={error} hint={t("swap.slippageHint")}>
				<Segmented
					value={preset ? value.slippage : CUSTOM}
					options={slippageOptions}
					onChange={handleSlippage}
					size="sm"
					ariaLabel={t("swap.slippage")}
				/>
				{!preset && (
					<label className={`input mt-2 flex w-32 items-center gap-2 ${error ? "input-error" : ""}`}>
						<input
							type="text"
							inputMode="decimal"
							className="tabular grow"
							value={value.slippage}
							onChange={handleCustom}
							placeholder="2"
							aria-label={t("swap.slippage")}
						/>
						<span className="text-base-content/60">%</span>
					</label>
				)}
			</Field>
			{tiers && (
				<Field label={t("swap.poolFee")}>
					<select className="select w-full" value={value.feeTier} onChange={handleTier} aria-label={t("swap.poolFee")}>
						<option value={0}>{t("swap.poolFeeAuto")}</option>
						{tiers.map((fee) => (
							<option key={fee} value={fee}>
								{fee / 10_000}%
							</option>
						))}
					</select>
				</Field>
			)}
		</>
	);
};
