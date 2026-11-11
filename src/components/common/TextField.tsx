import type { ReactNode } from "react";
import { Field } from "@/components/ui/Field";

export interface TextFieldProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
	error?: string;
	hint?: ReactNode;
	placeholder?: string;
	maxLength?: number;
	mono?: boolean;
	/** Renders a textarea with this many rows. */
	rows?: number;
	disabled?: boolean;
}

export const TextField: React.FC<TextFieldProps> = ({
	label,
	value,
	onChange,
	error,
	hint,
	placeholder,
	maxLength,
	mono,
	rows,
	disabled,
}) => (
	<Field label={label} error={error} hint={hint}>
		{rows ? (
			<textarea
				className={`textarea w-full ${mono ? "mono text-xs" : ""} ${error ? "textarea-error" : ""}`}
				rows={rows}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				spellCheck={false}
				autoCapitalize="off"
				autoCorrect="off"
				disabled={disabled}
				aria-label={label}
			/>
		) : (
			<input
				type="text"
				className={`input w-full ${mono ? "mono" : ""} ${error ? "input-error" : ""}`}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				maxLength={maxLength}
				spellCheck={false}
				autoCapitalize="off"
				autoCorrect="off"
				autoComplete="off"
				disabled={disabled}
				aria-label={label}
			/>
		)}
	</Field>
);
