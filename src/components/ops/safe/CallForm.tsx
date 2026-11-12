import { useCallback, useMemo } from "react";
import { formatEther } from "viem";
import { AddressField } from "@/components/common/AddressField";
import { AmountField } from "@/components/common/AmountField";
import { PickerSelect, type PickerOption } from "@/components/common/PickerSelect";
import { TextField } from "@/components/common/TextField";
import { Field } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { getChain } from "@/config/chains";
import { useT } from "@/i18n";
import { AppError } from "@/lib/errors";
import {
	functionKey,
	functionSelector,
	functionSignature,
	isWritable,
	normalizeHex,
	parseAbiText,
	parseFragment,
} from "@/lib/evm/abi";
import { callData, type CallParams } from "@/lib/evm/abiCall";
import type { KnownAddress } from "@/lib/known";
import type { OpFormProps } from "@/lib/ops/types";
import { AbiArgsForm } from "./AbiArgsForm";
import { AbiCalldataPreview } from "./AbiCalldataPreview";
import { AbiSourceInput } from "./AbiSourceInput";

const NO_KNOWN: KnownAddress[] = [];

/** Contract call builder: address → ABI → function → typed arguments, or raw calldata. */
export const CallForm: React.FC<OpFormProps<CallParams>> = ({ value, onChange, env, errors }) => {
	const t = useT();
	const chainId = env.account.chainId as number;
	const chain = getChain(chainId);
	const modes = useMemo(
		() => [
			{ value: "abi" as const, label: t("advanced.modeAbi") },
			{ value: "raw" as const, label: t("advanced.modeRaw") },
		],
		[t],
	);

	const parsed = useMemo(() => {
		try {
			return { functions: parseAbiText(value.abiText).functions.filter(isWritable) };
		} catch (e) {
			return { functions: [], error: e instanceof AppError ? t(e.key, e.vars) : t("advanced.err.abi") };
		}
	}, [value.abiText, t]);

	const selected = useMemo(() => parseFragment(value.fragment), [value.fragment]);

	// The selected function stays available even when the ABI text is gone (after a signature reset).
	const functions = useMemo(() => {
		const list = [...parsed.functions];
		if (selected && !list.some((f) => functionKey(f) === functionKey(selected))) list.unshift(selected);
		return list;
	}, [parsed.functions, selected]);

	const options = useMemo<PickerOption[]>(
		() => functions.map((f) => ({ value: functionKey(f), title: f.name, subtitle: functionSignature(f) })),
		[functions],
	);

	const handleFunction = useCallback(
		(key: string) => {
			const fn = functions.find((f) => functionKey(f) === key);
			if (!fn) return;
			onChange({
				fragment: JSON.stringify(fn),
				args: fn.inputs.map((i) => (i.type === "bool" ? "false" : "")),
				value: fn.stateMutability === "payable" ? value.value : "",
			});
		},
		[functions, onChange, value.value],
	);

	const handleAbi = useCallback(
		(abiText: string) => {
			let keep = false;
			try {
				keep = !!selected && parseAbiText(abiText).functions.some((f) => functionKey(f) === functionKey(selected));
			} catch {
				// Invalid text – the error is shown under the field.
			}
			onChange(keep || !abiText.trim() ? { abiText } : { abiText, fragment: "", args: [] });
		},
		[onChange, selected],
	);

	const encoded = useMemo(() => {
		try {
			return callData(value);
		} catch {
			return undefined;
		}
	}, [value]);

	const showValue = value.mode === "raw" || selected?.stateMutability === "payable";
	const nativeBalance = env.safe?.holdings[0];

	return (
		<div className="flex flex-col gap-4">
			<AddressField
				label={t("advanced.contract")}
				value={value.to}
				onChange={(to) => onChange({ to })}
				// A contract is never one of our signers or accounts: straight to typing or scanning.
				known={NO_KNOWN}
				error={errors.to}
			/>
			<Segmented
				value={value.mode}
				options={modes}
				onChange={(mode) => onChange({ mode })}
				size="sm"
				ariaLabel={t("advanced.mode")}
			/>
			{value.mode === "abi" ? (
				<>
					<AbiSourceInput
						value={value.abiText}
						onChange={handleAbi}
						chainId={chainId}
						address={value.to}
						error={parsed.error}
					/>
					{functions.length > 0 && (
						<Field label={t("advanced.function")} error={errors.fragment}>
							<PickerSelect
								value={selected ? functionKey(selected) : undefined}
								options={options}
								onChange={handleFunction}
								title={t("advanced.function")}
								placeholder={t("advanced.chooseFunction")}
								invalid={!!errors.fragment}
							/>
						</Field>
					)}
					{functions.length === 0 && value.abiText.trim() && !parsed.error && (
						<p className="text-warning text-sm">{t("advanced.noWritable")}</p>
					)}
					{selected && (
						<AbiArgsForm
							inputs={selected.inputs}
							values={value.args}
							onChange={(args) => onChange({ args })}
							chainId={chainId}
							errors={errors}
						/>
					)}
				</>
			) : (
				<TextField
					label={t("advanced.data")}
					value={value.data}
					onChange={(data) => onChange({ data })}
					error={errors.data}
					rows={4}
					mono
					placeholder="0x…"
					hint={t("advanced.rawHint")}
				/>
			)}
			{showValue && (
				<AmountField
					label={t("advanced.value")}
					value={value.value}
					onChange={(v) => onChange({ value: v })}
					symbol={chain.nativeSymbol}
					max={nativeBalance ? formatEther(BigInt(nativeBalance.balance)) : undefined}
					error={errors.value}
				/>
			)}
			{value.mode === "abi" && selected && encoded && (
				<AbiCalldataPreview data={encoded} caption={functionSelector(selected)} />
			)}
			{value.mode === "raw" && normalizeHex(value.data) && (normalizeHex(value.data) as string).length >= 10 && (
				<p className="text-base-content/60 text-xs">
					{t("advanced.selector")}: <span className="mono">{(normalizeHex(value.data) as string).slice(0, 10)}</span>
				</p>
			)}
		</div>
	);
};
