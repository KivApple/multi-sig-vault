import { useCallback, useMemo } from "react";
import { Field } from "@/components/ui/Field";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import { useT } from "@/i18n";
import type { ForwardLevel } from "@/lib/evm/cctp";
import { fastAvailable, type SwapParams } from "@/lib/evm/swapBuild";

export interface SwapBridgeOptionsProps {
	value: SwapParams;
	onChange: (patch: Partial<SwapParams>) => void;
	chainId: number;
}

/** Bridge leg options: transfer speed and who submits the mint on the destination network. */
export const SwapBridgeOptions: React.FC<SwapBridgeOptionsProps> = ({ value, onChange, chainId }) => {
	const t = useT();
	const fast = fastAvailable(chainId);

	const speedOptions = useMemo<SegmentedOption<SwapParams["speed"]>[]>(
		() => [
			{ value: "standard", label: t("swap.speed.standard") },
			{ value: "fast", label: t("swap.speed.fast") },
		],
		[t],
	);
	const levelOptions = useMemo<SegmentedOption<ForwardLevel>[]>(
		() => [
			{ value: "low", label: t("swap.level.low") },
			{ value: "med", label: t("swap.level.med") },
			{ value: "high", label: t("swap.level.high") },
		],
		[t],
	);
	const handleSpeed = useCallback((speed: SwapParams["speed"]) => onChange({ speed }), [onChange]);
	const handleLevel = useCallback((forwardLevel: ForwardLevel) => onChange({ forwardLevel }), [onChange]);
	const handleForward = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => onChange({ forward: e.target.checked }),
		[onChange],
	);

	return (
		<>
			{fast && (
				<Field label={t("swap.speed")} hint={t(value.speed === "fast" ? "swap.speed.fastHint" : "swap.speed.standardHint")}>
					<Segmented value={value.speed} options={speedOptions} onChange={handleSpeed} size="sm" ariaLabel={t("swap.speed")} />
				</Field>
			)}
			<label className="flex cursor-pointer items-start gap-3">
				<input type="checkbox" className="toggle toggle-sm mt-0.5" checked={value.forward} onChange={handleForward} />
				<span className="flex flex-col leading-tight">
					<span className="text-sm font-medium">{t("swap.forward")}</span>
					<span className="text-base-content/60 text-xs">{t(value.forward ? "swap.forwardOn" : "swap.forwardOff")}</span>
				</span>
			</label>
			{value.forward && (
				<Field label={t("swap.level")} hint={t("swap.levelHint")}>
					<Segmented
						value={value.forwardLevel}
						options={levelOptions}
						onChange={handleLevel}
						size="sm"
						ariaLabel={t("swap.level")}
					/>
				</Field>
			)}
		</>
	);
};
