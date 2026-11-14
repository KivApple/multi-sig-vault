import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, type Address } from "viem";
import { AddressLabel } from "@/components/common/AddressLabel";
import { Notice } from "@/components/common/Notice";
import { Dialog } from "@/components/ui/Dialog";
import { getChain } from "@/config/chains";
import { useCached } from "@/hooks/useCached";
import { useLang, useT } from "@/i18n";
import { formatAmount, sameAddress } from "@/lib/format";
import { fetchNativeBalances } from "@/lib/safe/account";
import { useAppStore } from "@/store/appStore";
import type { Account, SendMode } from "@/types/domain";

export interface AccountSettingsDialogProps {
	open: boolean;
	onClose: () => void;
	/** A Safe. */
	account: Account;
}

const MODES: SendMode[] = ["any", "owners", "selected"];

/** Settings of one Safe, kept on this device with the account: who sends its transactions. */
export const AccountSettingsDialog: React.FC<AccountSettingsDialogProps> = ({ open, onClose, account }) => {
	const t = useT();
	const lang = useLang();
	const signers = useAppStore((s) => s.signers);
	const chainId = account.chainId as number;
	const chain = getChain(chainId);
	const [mode, setMode] = useState<SendMode>("any");
	const [picked, setPicked] = useState<Address[]>([]);

	// Nothing is stored until "Save": every opening starts from what the account has.
	useEffect(() => {
		if (!open) return;
		setMode(account.sendMode ?? "any");
		setPicked(account.senders ?? []);
	}, [open, account.sendMode, account.senders]);

	const addresses = useMemo(() => signers.map((s) => s.address), [signers]);
	// The picked sender pays gas: show what each one has, as the "who sends" dialog does.
	const balanceKey =
		open && mode === "selected" && addresses.length > 0
			? `native:${chainId}:${addresses.join(",").toLowerCase()}`
			: null;
	const fetchBalances = useCallback(() => fetchNativeBalances(chainId, addresses), [chainId, addresses]);
	const balances = useCached(balanceKey, fetchBalances, 20_000).data;

	// A picked signer removed from the app since is dropped on saving.
	const chosen = useMemo(() => addresses.filter((a) => picked.some((p) => sameAddress(p, a))), [addresses, picked]);
	const valid = mode !== "selected" || chosen.length > 0;

	const toggle = useCallback((address: Address) => {
		setPicked((prev) =>
			prev.some((p) => sameAddress(p, address)) ? prev.filter((p) => !sameAddress(p, address)) : [...prev, address],
		);
	}, []);

	const handleSave = useCallback(() => {
		if (!valid) return;
		// Absent rather than "any": an account that never used the setting is stored as before.
		useAppStore.getState().updateAccount(account.id, {
			sendMode: mode === "any" ? undefined : mode,
			senders: mode === "selected" ? chosen : undefined,
		});
		onClose();
	}, [valid, account.id, mode, chosen, onClose]);

	return (
		<Dialog
			open={open}
			onClose={onClose}
			title={t("accounts.settings")}
			actions={
				<>
					<button type="button" className="btn btn-ghost" onClick={onClose}>
						{t("common.cancel")}
					</button>
					<button type="button" className="btn btn-primary" onClick={handleSave} disabled={!valid}>
						{t("common.save")}
					</button>
				</>
			}
		>
			<h3 className="text-sm font-medium">{t("accounts.sendMode")}</h3>
			<p className="text-base-content/60 mt-0.5 text-xs">{t("accounts.sendModeHint")}</p>
			<div className="-mx-2 mt-2 flex flex-col" role="radiogroup" aria-label={t("accounts.sendMode")}>
				{MODES.map((m) => (
					<label key={m} className="hover:bg-base-200 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2">
						<input
							type="radio"
							name="send-mode"
							className="radio radio-primary radio-sm"
							checked={mode === m}
							onChange={() => setMode(m)}
						/>
						<span className="min-w-0 flex-1 leading-tight">
							<span className="block text-sm font-medium">{t(`accounts.sendMode.${m}`)}</span>
							<span className="text-base-content/60 block text-xs">{t(`accounts.sendMode.${m}Hint`)}</span>
						</span>
					</label>
				))}
			</div>
			{mode === "selected" && (
				<>
					<ul className="border-base-300 -mx-2 mt-2 flex flex-col border-t pt-2">
						{signers.map((s) => {
							const balance = balances?.[s.address.toLowerCase()];
							return (
								<li key={s.id}>
									<label className="hover:bg-base-200 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2">
										<input
											type="checkbox"
											className="checkbox checkbox-primary checkbox-sm"
											checked={picked.some((p) => sameAddress(p, s.address))}
											onChange={() => toggle(s.address)}
										/>
										<span className="flex min-w-0 flex-1">
											<AddressLabel address={s.address} size={32} />
										</span>
										<span className="tabular text-base-content/80 shrink-0 text-sm">
											{balance === undefined
												? ""
												: `${formatAmount(formatUnits(BigInt(balance), 18), lang, 5)} ${chain.nativeSymbol}`}
										</span>
									</label>
								</li>
							);
						})}
					</ul>
					{signers.length === 0 ? (
						<p className="text-base-content/60 py-2 text-sm">{t("ops.noSigners")}</p>
					) : (
						!valid && <Notice className="mt-2">{t("accounts.sendMode.pickOne")}</Notice>
					)}
				</>
			)}
		</Dialog>
	);
};
