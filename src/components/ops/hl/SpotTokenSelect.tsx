import { useMemo } from "react";
import { PickerSelect, type PickerOption } from "@/components/common/PickerSelect";
import { TokenIcon } from "@/components/icons/TokenIcon";
import { Field } from "@/components/ui/Field";
import { useLang, useT } from "@/i18n";
import { formatAmount, formatUsd } from "@/lib/format";

export interface SpotTokenOption {
	/** Option id (token index or `perp`). */
	id: string;
	coin: string;
	tokenRef: string;
	balance: string;
	usd?: number;
	caption?: string;
}

export interface SpotTokenSelectProps {
	value: string | undefined;
	options: SpotTokenOption[];
	onChange: (option: SpotTokenOption) => void;
	error?: string;
}

/** Token picker for Hyperliquid balances: icon, name, balance and USD value. */
export const SpotTokenSelect: React.FC<SpotTokenSelectProps> = ({ value, options, onChange, error }) => {
	const t = useT();
	const lang = useLang();
	const items = useMemo<PickerOption[]>(
		() =>
			options.map((o) => ({
				value: o.id,
				title: o.caption ? `${o.coin} · ${o.caption}` : o.coin,
				subtitle: formatAmount(o.balance, lang, 8),
				icon: <TokenIcon symbol={o.coin} hl size={32} />,
				aside: o.usd !== undefined ? formatUsd(o.usd, lang) : undefined,
			})),
		[options, lang],
	);
	return (
		<Field label={t("ops.token")} error={error}>
			<PickerSelect
				value={value}
				options={items}
				onChange={(id) => {
					const hit = options.find((o) => o.id === id);
					if (hit) onChange(hit);
				}}
				title={t("ops.token")}
				placeholder={t("ops.chooseToken")}
				invalid={!!error}
			/>
		</Field>
	);
};
