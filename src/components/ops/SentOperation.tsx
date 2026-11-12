import { CircleCheck, ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AddressLabel } from "@/components/common/AddressLabel";
import { Notice } from "@/components/common/Notice";
import { IconButton } from "@/components/ui/IconButton";
import { Spinner } from "@/components/ui/Spinner";
import { explorerTx } from "@/config/chains";
import { useConfirm } from "@/hooks/useConfirm";
import { useLang, useT } from "@/i18n";
import { formatDateTime, shortAddress } from "@/lib/format";
import { deleteOperation, retrySafeOperation } from "@/lib/ops/engine";
import { opTitleKey } from "@/lib/ops/registry";
import type { OpDefinition } from "@/lib/ops/types";
import type { Account, Operation } from "@/types/domain";
import { OpCardFrame } from "./OpCardFrame";
import { OpSummary } from "./OpSummary";
import { useTxStatus } from "./useTxStatus";

export interface SentOperationProps {
	op: Operation;
	def: OpDefinition;
	account: Account;
}

const STUCK_AFTER_MS = 3 * 60_000;

/** Submitted operation: what was done, on-chain status and operation-specific results. */
export const SentOperation: React.FC<SentOperationProps> = ({ op, def, account }) => {
	const t = useT();
	const lang = useLang();
	const confirm = useConfirm();
	const txStatus = useTxStatus(op, account);
	const rows = useMemo(() => def.summary(op.params, { t, lang, account }), [def, op.params, t, lang, account]);
	const result = op.result;
	const isSafe = account.kind === "safe";
	const pending = isSafe && !txStatus;
	const reverted = txStatus === "reverted";
	const { Result } = def;

	const handleDelete = useCallback(async () => {
		const warning = def.deleteWarning?.(op);
		if (
			warning &&
			!(await confirm({
				title: t("ops.delete.title"),
				body: t(warning),
				confirmLabel: t("common.delete"),
				danger: true,
			}))
		) {
			return;
		}
		deleteOperation(op.id);
	}, [confirm, def, op, t]);

	const handleRetry = useCallback(() => retrySafeOperation(op.id), [op.id]);

	// A transaction that is still not mined after a while most likely pays too little.
	const sentAt = result?.sentAt;
	const [stuck, setStuck] = useState(false);
	useEffect(() => {
		if (!pending || sentAt === undefined) {
			setStuck(false);
			return undefined;
		}
		const left = sentAt + STUCK_AFTER_MS - Date.now();
		if (left <= 0) {
			setStuck(true);
			return undefined;
		}
		const timer = setTimeout(() => setStuck(true), left);
		return () => clearTimeout(timer);
	}, [pending, sentAt]);

	return (
		<OpCardFrame
			icon={reverted ? def.icon : CircleCheck}
			tone={reverted || pending ? "default" : "success"}
			title={t(opTitleKey(op.type))}
			badges={
				pending ? (
					<span className="badge badge-ghost badge-sm gap-1">
						<Spinner size="xs" />
						{t("ops.status.pending")}
					</span>
				) : reverted ? (
					<span className="badge badge-error badge-sm">{t("ops.status.reverted")}</span>
				) : (
					<span className="badge badge-success badge-sm">{t("ops.status.done")}</span>
				)
			}
			actions={
				<IconButton label={t("common.delete")} onClick={() => void handleDelete()}>
					<Trash2 className="size-4" />
				</IconButton>
			}
		>
			<OpSummary rows={rows} hlEnv={account.kind === "hl" ? account.env : undefined} />
			{result && (
				<div className="text-base-content/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
					<span>{formatDateTime(result.sentAt, lang)}</span>
					{result.sender && (
						<span className="inline-flex items-center gap-1">
							{t("ops.sentBy")}
							<AddressLabel address={result.sender} size={16} compact className="text-base-content/80" />
						</span>
					)}
					{result.txHash && account.chainId !== undefined && (
						<a
							className="link link-hover inline-flex items-center gap-1"
							href={explorerTx(account.chainId, result.txHash)}
							target="_blank"
							rel="noopener noreferrer"
						>
							<span className="mono">{shortAddress(result.txHash)}</span>
							<ExternalLink className="size-3" />
						</a>
					)}
				</div>
			)}
			{stuck && (
				<Notice tone="warning">
					<p>{t("ops.stuckNote")}</p>
					<button type="button" className="btn btn-sm mt-2" onClick={handleRetry}>
						<RotateCcw className="size-4" />
						{t("ops.sendAgain")}
					</button>
				</Notice>
			)}
			{reverted && (
				<Notice tone="error">
					<p>{t("ops.revertedNote")}</p>
					<button type="button" className="btn btn-sm mt-2" onClick={handleRetry}>
						<RotateCcw className="size-4" />
						{t("ops.backToSending")}
					</button>
				</Notice>
			)}
			{Result && !reverted && <Result op={op} account={account} />}
		</OpCardFrame>
	);
};
