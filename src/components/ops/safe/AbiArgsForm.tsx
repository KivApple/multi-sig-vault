import { useCallback, useMemo } from "react";
import type { AbiParameter } from "viem";
import { knownRecipients } from "@/lib/known";
import { useAppStore } from "@/store/appStore";
import { AbiArgInput } from "./AbiArgInput";

export interface AbiArgsFormProps {
	inputs: readonly AbiParameter[];
	values: string[];
	onChange: (values: string[]) => void;
	chainId: number;
	/** Errors keyed `arg0`, `arg1`, … */
	errors: Record<string, string>;
}

/** Inputs for every argument of a function or constructor. */
export const AbiArgsForm: React.FC<AbiArgsFormProps> = ({ inputs, values, onChange, chainId, errors }) => {
	const signers = useAppStore((s) => s.signers);
	const accounts = useAppStore((s) => s.accounts);
	const known = useMemo(() => knownRecipients(signers, accounts, { chainId }), [signers, accounts, chainId]);

	const handleChange = useCallback(
		(index: number, value: string) => {
			const next = inputs.map((_, i) => values[i] ?? "");
			next[index] = value;
			onChange(next);
		},
		[inputs, values, onChange],
	);

	return (
		<>
			{inputs.map((param, i) => (
				<AbiArgInput
					// biome-ignore lint/suspicious/noArrayIndexKey: arguments are positional
					key={i}
					param={param}
					index={i}
					value={values[i] ?? ""}
					onChange={handleChange}
					known={known}
					error={errors[`arg${i}`]}
				/>
			))}
		</>
	);
};
