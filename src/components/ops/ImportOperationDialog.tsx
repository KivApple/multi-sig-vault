import { useCallback, useMemo } from "react";
import { AccountIcon } from "@/components/icons/AccountIcon";
import { Notice } from "@/components/common/Notice";
import { Dialog } from "@/components/ui/Dialog";
import { useLang, useT } from "@/i18n";
import { shortAddress } from "@/lib/format";
import { accountNetworkName } from "@/lib/known";
import { getOpDefinition, opTitleKey } from "@/lib/ops/registry";
import type { ParsedImport } from "@/lib/ops/transfer";
import { OpSummary } from "./OpSummary";
import { SignersProgress } from "./SignersProgress";

export interface ImportOperationDialogProps {
	parsed: ParsedImport | null;
	onClose: () => void;
	onConfirm: (parsed: ParsedImport) => void;
}

/** Shows exactly what a scanned operation contains before it is stored. */
export const ImportOperationDialog: React.FC<ImportOperationDialogProps> = ({ parsed, onClose, onConfirm }) => {
	const t = useT();
	const lang = useLang();
	const def = parsed ? getOpDefinition(parsed.op.type) : undefined;
	const rows = useMemo(
		() => (parsed && def ? def.summary(parsed.op.params, { t, lang, account: parsed.account }) : []),
		[parsed, def, t, lang],
	);
	const handleConfirm = useCallback(() => {
		if (parsed) onConfirm(parsed);
	}, [parsed, onConfirm]);

	const nothingToDo = parsed?.action === "upToDate" || parsed?.action === "alreadySent";
	const account = parsed?.account;
	return (
		<Dialog
			open={!!parsed}
			onClose={onClose}
			title={t("import.title")}
			actions={
				<>
					<button type="button" className="btn btn-ghost" onClick={onClose}>
						{t(nothingToDo ? "common.close" : "common.cancel")}
					</button>
					{!nothingToDo && (
						<button type="button" className="btn btn-primary" onClick={handleConfirm}>
							{t("import.confirm")}
						</button>
					)}
				</>
			}
		>
			{parsed && account && (
				<div className="flex flex-col gap-4">
					<div className="flex items-center gap-3">
						<AccountIcon kind={account.kind} env={account.env} chainId={account.chainId} size={40} />
						<div className="min-w-0 flex-1 leading-tight">
							<div className="truncate font-medium">{account.name?.trim() || shortAddress(account.address)}</div>
							<div className="text-base-content/60 text-xs">
								{accountNetworkName(account)} · <span className="mono">{shortAddress(account.address)}</span>
							</div>
						</div>
						{parsed.accountIsNew && <span className="badge badge-info badge-sm">{t("import.newAccount")}</span>}
					</div>
					<div className="card-surface flex flex-col gap-3 p-3">
						<div className="font-semibold">{t(opTitleKey(parsed.op.type))}</div>
						<OpSummary rows={rows} hlEnv={account.kind === "hl" ? account.env : undefined} />
						<SignersProgress
							owners={parsed.op.owners ?? []}
							threshold={parsed.op.threshold ?? 1}
							signed={parsed.op.signatures.map((s) => s.signer)}
							scope={account.kind === "safe" ? { chainId: account.chainId as number } : { hlEnv: account.env }}
						/>
					</div>
					<Notice tone={parsed.action === "replace" ? "warning" : "info"}>
						{t(`import.action.${parsed.action}`, { count: parsed.newSignatures.length })}
					</Notice>
				</div>
			)}
		</Dialog>
	);
};
