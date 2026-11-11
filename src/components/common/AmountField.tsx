import { useCallback, type ReactNode } from "react";
import { Field } from "@/components/ui/Field";
import { useLang, useT } from "@/i18n";
import { formatAmount, trimDecimal } from "@/lib/format";

export interface AmountFieldProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
	/** Unit shown inside the input. */
	symbol?: string;
	/** Available balance (token units) – enables the "Max" button and the balance caption. */
	max?: string;
	error?: string;
	hint?: ReactNode;
	disabled?: boolean;
}

/** Decimal amount input with unit, balance caption and "Max". Accepts both `.` and `,`. */
export const AmountField: React.FC<AmountFieldProps> = ({
	label,
	value,
	onChange,
	symbol,
	max,
	error,
	hint,
	disabled,
}) => {
	const t = useT();
	const lang = useLang();
	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const v = e.target.value.replace(",", ".").replace(/[^\d.]/g, "");
			const firstDot = v.indexOf(".");
			onChange(firstDot === -1 ? v : v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, ""));
		},
		[onChange],
	);
	const handleMax = useCallback(() => {
		if (max !== undefined) onChange(trimDecimal(max));
	}, [max, onChange]);

	return (
		<Field
			label={label}
			error={error}
			hint={hint}
			aside={
				max !== undefined ? t("amount.available", { amount: formatAmount(max, lang), symbol: symbol ?? "" }) : undefined
			}
		>
			<label className={`input flex w-full items-center gap-2 ${error ? "input-error" : ""}`}>
				<input
					type="text"
					inputMode="decimal"
					className="tabular grow"
					value={value}
					onChange={handleChange}
					placeholder="0"
					autoComplete="off"
					disabled={disabled}
					aria-label={label}
				/>
				{symbol && <span className="text-base-content/60 shrink-0 text-sm">{symbol}</span>}
				{max !== undefined && (
					<button type="button" className="btn btn-ghost btn-xs" onClick={handleMax} disabled={disabled}>
						{t("common.max")}
					</button>
				)}
			</label>
		</Field>
	);
};
