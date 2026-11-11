import { ScanLine } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { AccountIcon } from "@/components/icons/AccountIcon";
import { WalletIcon } from "@/components/icons/WalletIcon";
import { ScannerDialog } from "@/components/qr/ScannerDialog";
import { Field } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { parseAddress, sameAddress, shortAddress } from "@/lib/format";
import type { KnownAddress } from "@/lib/known";
import { parseAddressQr } from "@/lib/qr/address";
import { toast } from "@/lib/toast";
import { PickerSelect, type PickerOption } from "./PickerSelect";

export interface AddressFieldProps {
	label: string;
	value: string;
	onChange: (address: string) => void;
	/** Known addresses offered in the drop-down; "Other…" is always the last option. */
	known: KnownAddress[];
	error?: string;
	hint?: React.ReactNode;
	disabled?: boolean;
}

const OTHER = "__other__";

/**
 * Address input used everywhere: pick a known signer/account, or choose "Other…" to type,
 * paste or scan (MetaMask-compatible QR) an address.
 */
export const AddressField: React.FC<AddressFieldProps> = ({ label, value, onChange, known, error, hint, disabled }) => {
	const t = useT();
	const matched = useMemo(() => known.find((k) => sameAddress(k.address, value)), [known, value]);
	const [custom, setCustom] = useState(() => !!value && !matched);
	const [scanning, setScanning] = useState(false);
	const showInput = custom || known.length === 0;

	const options = useMemo<PickerOption[]>(
		() => [
			...known.map((k) => ({
				value: k.address,
				title: k.account ? k.account.name?.trim() || shortAddress(k.address) : (k.signer?.name ?? ""),
				subtitle: shortAddress(k.address),
				icon: k.account ? (
					<AccountIcon kind={k.account.kind} env={k.account.env} chainId={k.account.chainId} size={32} />
				) : (
					k.signer && <WalletIcon kind={k.signer.wallet} size={32} />
				),
			})),
			{ value: OTHER, title: t("common.other"), subtitle: t("address.otherHint") },
		],
		[known, t],
	);

	const handlePick = useCallback(
		(v: string) => {
			if (v === OTHER) {
				setCustom(true);
				onChange("");
			} else {
				setCustom(false);
				onChange(v);
			}
		},
		[onChange],
	);

	const handleScan = useCallback(
		(text: string) => {
			const parsed = parseAddressQr(text);
			if (!parsed) {
				toast.error(t("address.badQr"));
				return;
			}
			setScanning(false);
			onChange(parsed.address);
		},
		[onChange, t],
	);

	const handleBlur = useCallback(() => {
		const checksummed = parseAddress(value);
		if (checksummed && checksummed !== value) onChange(checksummed);
	}, [onChange, value]);

	return (
		<Field label={label} error={error} hint={hint}>
			{known.length > 0 && (
				<PickerSelect
					value={showInput ? OTHER : matched?.address}
					options={options}
					onChange={handlePick}
					title={label}
					placeholder={t("address.choose")}
					disabled={disabled}
					invalid={!!error && !showInput}
				/>
			)}
			{showInput && (
				<div className={`join w-full ${known.length > 0 ? "mt-2" : ""}`}>
					<input
						type="text"
						className={`input join-item mono w-full ${error ? "input-error" : ""}`}
						value={value}
						onChange={(e) => onChange(e.target.value.trim())}
						onBlur={handleBlur}
						placeholder="0x…"
						spellCheck={false}
						autoCapitalize="off"
						autoCorrect="off"
						autoComplete="off"
						disabled={disabled}
						aria-label={label}
					/>
					<button
						type="button"
						className="btn join-item"
						onClick={() => setScanning(true)}
						disabled={disabled}
						aria-label={t("common.scanQr")}
						title={t("common.scanQr")}
					>
						<ScanLine className="size-5" />
					</button>
				</div>
			)}
			<ScannerDialog
				open={scanning}
				onClose={() => setScanning(false)}
				onResult={handleScan}
				title={t("address.scanTitle")}
			/>
		</Field>
	);
};
