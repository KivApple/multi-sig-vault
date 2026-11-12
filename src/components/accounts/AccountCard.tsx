import { Eye, EyeOff, QrCode, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Link } from "react-router";
import { AccountIcon } from "@/components/icons/AccountIcon";
import { QrDialog } from "@/components/qr/QrDialog";
import { CopyButton } from "@/components/ui/CopyButton";
import { IconButton } from "@/components/ui/IconButton";
import { useAccountData } from "@/hooks/useAccountData";
import { useConfirm } from "@/hooks/useConfirm";
import { useLang, useT } from "@/i18n";
import { formatUsd, shortAddress } from "@/lib/format";
import { accountNetworkName } from "@/lib/known";
import { addressQrValue } from "@/lib/qr/address";
import { useAppStore } from "@/store/appStore";
import type { Account } from "@/types/domain";
import { multiSigLabel } from "./multiSigLabel";

export interface AccountCardProps {
	account: Account;
	editing: boolean;
}

/** Account in the list: type icon, name, total balance and multi-sig mode. */
export const AccountCard: React.FC<AccountCardProps> = ({ account, editing }) => {
	const t = useT();
	const lang = useLang();
	const confirm = useConfirm();
	const { data, error } = useAccountData(account);
	const [qr, setQr] = useState(false);
	const title = account.name?.trim() || shortAddress(account.address);
	const mode = multiSigLabel(account, data, t);

	const toggleHidden = useCallback(() => {
		useAppStore.getState().updateAccount(account.id, { hidden: !account.hidden });
	}, [account.id, account.hidden]);

	const handleDelete = useCallback(async () => {
		const ok = await confirm({
			title: t("accounts.delete.title"),
			body: t("accounts.delete.body", { name: title }),
			confirmLabel: t("common.delete"),
			danger: true,
		});
		if (ok) useAppStore.getState().removeAccount(account.id);
	}, [confirm, account.id, title, t]);

	const text = (
		<>
			<div className="text-base-content/60 truncate text-xs">{accountNetworkName(account)}</div>
			{mode && <div className="text-base-content/60 truncate text-xs">{mode}</div>}
		</>
	);

	// Three short lines on the left, balance over the actions on the right: nothing competes for one row on a phone.
	return (
		<div
			className={`card-surface relative flex items-center gap-3 py-2.5 pr-1.5 pl-3 ${
				editing ? "" : "hover:bg-base-200/60"
			} ${account.hidden ? "opacity-50" : ""}`}
		>
			<AccountIcon kind={account.kind} env={account.env} chainId={account.chainId} size={44} />
			<div className="min-w-0 flex-1 leading-tight">
				{editing ? (
					<div className="truncate font-semibold">{title}</div>
				) : (
					// The link's ::after covers the whole card; the action buttons sit above it.
					<Link
						to={`/account/${encodeURIComponent(account.id)}`}
						className="after:rounded-box block truncate font-semibold after:absolute after:inset-0"
					>
						{title}
					</Link>
				)}
				{text}
			</div>
			<div className="flex shrink-0 flex-col items-end gap-0.5">
				<div className="tabular pr-1.5 font-semibold">
					{data ? (
						formatUsd(data.totalUsd, lang, true)
					) : error ? (
						<span className="text-base-content/40">—</span>
					) : (
						<span className="skeleton inline-block h-5 w-16" />
					)}
				</div>
				<div className="relative z-10 flex">
					{editing ? (
						<>
							<IconButton label={t(account.hidden ? "common.show" : "common.hide")} onClick={toggleHidden}>
								{account.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
							</IconButton>
							<IconButton label={t("common.delete")} onClick={() => void handleDelete()} className="text-error">
								<Trash2 className="size-4" />
							</IconButton>
						</>
					) : (
						<>
							<CopyButton value={account.address} label={t("common.copyAddress")} />
							<IconButton label={t("common.showQr")} onClick={() => setQr(true)}>
								<QrCode className="size-4" />
							</IconButton>
						</>
					)}
				</div>
			</div>
			<QrDialog
				open={qr}
				onClose={() => setQr(false)}
				title={title}
				value={addressQrValue(account.address, account.chainId)}
				copyValue={account.address}
				caption={<span className="mono text-sm break-all">{account.address}</span>}
			/>
		</div>
	);
};
