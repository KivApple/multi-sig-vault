import { useCallback, useMemo } from "react";
import { Field } from "@/components/ui/Field";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import { useT } from "@/i18n";
import type { BridgeOptionsProps } from "./bridgeUi";

type Reserve = "on" | "off";

/**
 * Across' one option. Relayers compete on speed at a price fixed by the quote: paying more does not
 * make a transfer faster, paying too little makes nobody take it. What can be chosen is room for the
 * gas price to grow between the quote and the moment the transaction runs.
 */
export const SwapAcrossOptions: React.FC<BridgeOptionsProps> = ({ value, onChange }) => {
	const t = useT();
	const options = useMemo<SegmentedOption<Reserve>[]>(
		() => [
			{ value: "on", label: t("swap.reserve.on") },
			{ value: "off", label: t("swap.reserve.off") },
		],
		[t],
	);
	const reserve: Reserve = value.acrossReserve === false ? "off" : "on";
	const handle = useCallback((v: Reserve) => onChange({ acrossReserve: v === "on" }), [onChange]);
	return (
		<Field label={t("swap.reserve")} hint={t(reserve === "on" ? "swap.reserve.onHint" : "swap.reserve.offHint")}>
			<Segmented value={reserve} options={options} onChange={handle} size="sm" ariaLabel={t("swap.reserve")} />
		</Field>
	);
};
