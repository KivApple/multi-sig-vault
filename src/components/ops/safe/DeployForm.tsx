import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, keccak256, size, type Address } from "viem";
import { AmountField } from "@/components/common/AmountField";
import { TextField } from "@/components/common/TextField";
import { AddressText } from "@/components/ui/AddressText";
import { CopyButton } from "@/components/ui/CopyButton";
import { Field } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { getChain } from "@/config/chains";
import { useT } from "@/i18n";
import { normalizeHex, parseAbiText, parseCtorFragment } from "@/lib/evm/abi";
import { deployAddress, deployInitCode, deploySalt, fetchCreateAddress, type DeployParams } from "@/lib/evm/abiDeploy";
import type { OpFormProps } from "@/lib/ops/types";
import { AbiArgsForm } from "./AbiArgsForm";
import { AbiCalldataPreview } from "./AbiCalldataPreview";

/** Contract deployment from the Safe: bytecode or artifact → constructor arguments → CREATE / CREATE2. */
export const DeployForm: React.FC<OpFormProps<DeployParams>> = ({ value, onChange, env, errors }) => {
	const t = useT();
	const chainId = env.account.chainId as number;
	const safe = env.account.address;
	const chain = getChain(chainId);
	const ctor = useMemo(() => parseCtorFragment(value.ctor), [value.ctor]);
	const methods = useMemo(
		() => [
			{ value: "create" as const, label: "CREATE" },
			{ value: "create2" as const, label: "CREATE2" },
		],
		[],
	);

	const handleBytecode = useCallback(
		(text: string) => {
			const src = text.trim();
			let bytecode = "";
			let ctorJson = "";
			if (src.startsWith("{")) {
				try {
					const parsed = parseAbiText(src);
					bytecode = parsed.bytecode ?? "";
					if (parsed.ctor) ctorJson = JSON.stringify(parsed.ctor);
				} catch {
					// Reported by validation as invalid bytecode.
				}
			} else {
				bytecode = normalizeHex(src) ?? "";
			}
			const sameCtor = ctorJson === value.ctor;
			const nextCtor = ctorJson ? parseCtorFragment(ctorJson) : undefined;
			onChange({
				bytecodeText: text,
				bytecode,
				ctor: ctorJson,
				args: sameCtor ? value.args : (nextCtor?.inputs.map((i) => (i.type === "bool" ? "false" : "")) ?? []),
			});
		},
		[onChange, value.ctor, value.args],
	);

	const initCode = useMemo(() => {
		try {
			return deployInitCode(value);
		} catch {
			return undefined;
		}
	}, [value]);

	const salt = useMemo(() => deploySalt(value.salt), [value.salt]);
	const create2Address = useMemo(() => deployAddress(value, safe), [value, safe]);

	// CREATE: the address follows from the Safe's own nonce – look it up while the form is open.
	const [createAddress, setCreateAddress] = useState<Address>();
	useEffect(() => {
		if (value.method !== "create") return undefined;
		let alive = true;
		fetchCreateAddress(chainId, safe)
			.then((a) => alive && setCreateAddress(a))
			.catch(() => undefined);
		return () => {
			alive = false;
		};
	}, [value.method, chainId, safe]);

	const predicted = value.method === "create2" ? create2Address : createAddress;
	const showValue = !ctor || ctor.stateMutability === "payable";
	const nativeBalance = env.safe?.holdings[0];

	return (
		<div className="flex flex-col gap-4">
			<TextField
				label={t("advanced.bytecode")}
				value={value.bytecodeText}
				onChange={handleBytecode}
				error={errors.bytecode}
				rows={4}
				mono
				placeholder="0x6080…"
				hint={
					value.bytecode && value.bytecode !== "0x"
						? t("advanced.bytecodeInfo", { count: size(value.bytecode as `0x${string}`) })
						: t("advanced.bytecodeHint")
				}
			/>
			{ctor ? (
				<AbiArgsForm
					inputs={ctor.inputs}
					values={value.args}
					onChange={(args) => onChange({ args })}
					chainId={chainId}
					errors={errors}
				/>
			) : (
				value.bytecode && (
					<TextField
						label={t("advanced.rawArgs")}
						value={value.rawArgs}
						onChange={(rawArgs) => onChange({ rawArgs })}
						error={errors.rawArgs}
						mono
						placeholder="0x"
						hint={t("advanced.rawArgsHint")}
					/>
				)
			)}
			{showValue && value.bytecode && (
				<AmountField
					label={t("advanced.value")}
					value={value.value}
					onChange={(v) => onChange({ value: v })}
					symbol={chain.nativeSymbol}
					max={nativeBalance ? formatEther(BigInt(nativeBalance.balance)) : undefined}
					error={errors.value}
				/>
			)}
			<Field label={t("advanced.method")} hint={value.method === "create2" ? t("advanced.create2Hint") : t("advanced.createHint")}>
				<Segmented value={value.method} options={methods} onChange={(method) => onChange({ method })} size="sm" ariaLabel={t("advanced.method")} />
			</Field>
			{value.method === "create2" && (
				<TextField
					label={t("advanced.salt")}
					value={value.salt}
					onChange={(s) => onChange({ salt: s })}
					error={errors.salt}
					mono
					placeholder={t("advanced.saltPlaceholder")}
					hint={salt && salt !== value.salt.trim().toLowerCase() ? <span className="mono break-all">{salt}</span> : undefined}
				/>
			)}
			{initCode && predicted && (
				<div className="bg-base-200 rounded-box flex items-center gap-2 px-3 py-2 text-sm">
					<div className="min-w-0 flex-1">
						<div className="text-base-content/60 text-xs">
							{value.method === "create2" ? t("advanced.contractAddress") : t("advanced.expectedAddress")}
						</div>
						<AddressText address={predicted} full />
						{value.method === "create" && <div className="text-base-content/60 text-xs">{t("advanced.expectedAddressHint")}</div>}
					</div>
					<CopyButton value={predicted} />
				</div>
			)}
			{initCode && <AbiCalldataPreview data={initCode} caption={`${keccak256(initCode).slice(0, 10)}…`} />}
		</div>
	);
};
