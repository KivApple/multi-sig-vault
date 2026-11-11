import { Pencil, QrCode, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { RenameDialog } from "@/components/common/RenameDialog";
import { WalletIcon } from "@/components/icons/WalletIcon";
import { QrDialog } from "@/components/qr/QrDialog";
import { CopyButton } from "@/components/ui/CopyButton";
import { IconButton } from "@/components/ui/IconButton";
import { useConfirm } from "@/hooks/useConfirm";
import { useT } from "@/i18n";
import { shortAddress } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import type { Signer } from "@/types/domain";

export interface SignerCardProps {
	signer: Signer;
	editing: boolean;
}

export const SignerCard: React.FC<SignerCardProps> = ({ signer, editing }) => {
	const t = useT();
	const confirm = useConfirm();
	const [renaming, setRenaming] = useState(false);
	const [qr, setQr] = useState(false);

	const handleRename = useCallback(
		(name: string) => useAppStore.getState().updateSigner(signer.id, { name }),
		[signer.id],
	);
	const handleDelete = useCallback(async () => {
		const ok = await confirm({
			title: t("signers.delete.title"),
			body: t("signers.delete.body", { name: signer.name }),
			confirmLabel: t("common.delete"),
			danger: true,
		});
		if (ok) useAppStore.getState().removeSigner(signer.id);
	}, [confirm, signer, t]);

	return (
		<div className="card-surface flex items-center gap-1 py-3 pr-1 pl-3">
			<WalletIcon kind={signer.wallet} size={40} />
			<div className="ml-2 min-w-0 flex-1 leading-tight">
				<div className="truncate font-semibold">{signer.name}</div>
				<div className="mono text-base-content/60 text-xs" title={signer.address}>
					{shortAddress(signer.address)}
				</div>
			</div>
			{editing ? (
				<IconButton label={t("common.delete")} onClick={() => void handleDelete()} className="text-error">
					<Trash2 className="size-4" />
				</IconButton>
			) : (
				<>
					<IconButton label={t("common.rename")} onClick={() => setRenaming(true)}>
						<Pencil className="size-4" />
					</IconButton>
					<CopyButton value={signer.address} label={t("common.copyAddress")} />
					<IconButton label={t("common.showQr")} onClick={() => setQr(true)}>
						<QrCode className="size-4" />
					</IconButton>
				</>
			)}
			<RenameDialog
				open={renaming}
				onClose={() => setRenaming(false)}
				title={t("signers.rename")}
				initial={signer.name}
				onSave={handleRename}
			/>
			<QrDialog
				open={qr}
				onClose={() => setQr(false)}
				title={signer.name}
				value={signer.address}
				caption={<span className="mono text-sm break-all">{signer.address}</span>}
			/>
		</div>
	);
};
