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

	const body = (
		<>
			<AccountIcon kind={account.kind} env={account.env} chainId={account.chainId} size={44} />
			<div className="min-w-0 flex-1 leading-tight">
				<div className="truncate font-semibold">{title}</div>
				<div className="text-base-content/60 truncate text-xs">
					{accountNetworkName(account)}
					{mode && ` · ${mode}`}
				</div>
			</div>
			<div className="tabular shrink-0 text-right font-semibold">
				{data ? (
					formatUsd(data.totalUsd, lang, true)
				) : error ? (
					<span className="text-base-content/40">—</span>
				) : (
					<span className="skeleton inline-block h-5 w-16" />
				)}
			</div>
		</>
	);

	return (
		<div className={`card-surface flex items-center gap-1 pr-1 ${account.hidden ? "opacity-50" : ""}`}>
			{editing ? (
				<div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3">{body}</div>
			) : (
				<Link
					to={`/account/${encodeURIComponent(account.id)}`}
					className="hover:bg-base-200/60 rounded-box flex min-w-0 flex-1 items-center gap-3 px-3 py-3"
				>
					{body}
				</Link>
			)}
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
