import { useCallback, useMemo } from "react";
import { parseUnits, type AbiParameter } from "viem";
import { AddressField } from "@/components/common/AddressField";
import { TextField } from "@/components/common/TextField";
import { Field } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { argKind, argLabel, argPlaceholder } from "@/lib/evm/abi";
import type { KnownAddress } from "@/lib/known";

export interface AbiArgInputProps {
	param: AbiParameter;
	index: number;
	value: string;
	onChange: (index: number, value: string) => void;
	known: KnownAddress[];
	error?: string;
}

const SHIFTS = [6, 8, 18];

/** One function argument; the control follows the ABI type. */
export const AbiArgInput: React.FC<AbiArgInputProps> = ({ param, index, value, onChange, known, error }) => {
	const t = useT();
	const kind = argKind(param);
	const label = argLabel(param, index);
	const handleChange = useCallback((v: string) => onChange(index, v), [index, onChange]);
	const placeholder = useMemo(() => (kind === "json" ? argPlaceholder(param) : undefined), [kind, param]);

	const handleShift = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => {
			const decimals = Number(e.target.value);
			e.target.value = "";
			if (!/^\d+(\.\d+)?$/.test(value.trim())) return;
			try {
				onChange(index, parseUnits(value.trim(), decimals).toString());
			} catch {
				// Keep the value as is.
			}
		},
		[index, onChange, value],
	);

	if (kind === "address") {
		return <AddressField label={label} value={value} onChange={handleChange} known={known} error={error} />;
	}
	if (kind === "bool") {
		return (
			<Field label={label} error={error}>
				<label className="flex min-h-10 cursor-pointer items-center gap-3">
					<input
						type="checkbox"
						className="toggle toggle-primary"
						checked={value === "true"}
						onChange={(e) => handleChange(e.target.checked ? "true" : "false")}
						aria-label={label}
					/>
					<span className="mono text-sm">{value === "true" ? "true" : "false"}</span>
				</label>
			</Field>
		);
	}
	if (kind === "uint") {
		return (
			<Field label={label} error={error}>
				<div className="join w-full">
					<input
						type="text"
						inputMode="decimal"
						className={`input join-item mono w-full ${error ? "input-error" : ""}`}
						value={value}
						onChange={(e) => handleChange(e.target.value)}
						placeholder="0"
						autoComplete="off"
						spellCheck={false}
						aria-label={label}
					/>
					<select
						className="select join-item w-24 shrink-0"
						defaultValue=""
						onChange={handleShift}
						aria-label={t("advanced.shift")}
						title={t("advanced.shiftHint")}
					>
						<option value="" disabled>
							×10ⁿ
						</option>
						{SHIFTS.map((n) => (
							<option key={n} value={n}>
								×10^{n}
							</option>
						))}
					</select>
				</div>
			</Field>
		);
	}
	return (
		<TextField
			label={label}
			value={value}
			onChange={handleChange}
			error={error}
			placeholder={placeholder ?? (kind === "bytes" ? "0x…" : kind === "int" ? "0" : undefined)}
			mono={kind !== "string"}
			rows={kind === "json" ? 3 : undefined}
			hint={kind === "json" ? t("advanced.jsonHint") : undefined}
		/>
	);
};
