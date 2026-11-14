import { EllipsisVertical, PenLine, QrCode, RotateCcw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAddress, type Address } from "viem";
import { Notice } from "@/components/common/Notice";
import { TransferQrDialog } from "@/components/qr/TransferQrDialog";
import { Spinner } from "@/components/ui/Spinner";
import { useConfirm } from "@/hooks/useConfirm";
import { useLang, useT } from "@/i18n";
import { celebrate } from "@/lib/confetti";
import { describeError } from "@/lib/describeError";
import { formatDateTime, sameAddress } from "@/lib/format";
import {
	deleteOperation,
	opExpiresAt,
	ownerSetOf,
	planSafeSend,
	resetOperation,
	sendersOf,
	sendHlOperation,
	sendSafeOperation,
	signOperation,
	validSignatureCount,
} from "@/lib/ops/engine";
import { opTitleKey } from "@/lib/ops/registry";
import { exportOperation } from "@/lib/ops/transfer";
import type { OpDefinition, OpEnv } from "@/lib/ops/types";
import { toast } from "@/lib/toast";
import type { Operation, Signer } from "@/types/domain";
import { OpCardFrame } from "./OpCardFrame";
import { OpSummary } from "./OpSummary";
import { SignerPickerDialog } from "./SignerPickerDialog";
import { SignersProgress } from "./SignersProgress";

export interface SigningOperationProps {
	op: Operation;
	def: OpDefinition;
	env: OpEnv;
	/** Position in the send queue ("#3"). */
	queueLabel?: string;
}

/** Frozen operation: compact summary, signature progress, then sending. */
export const SigningOperation: React.FC<SigningOperationProps> = ({ op, def, env, queueLabel }) => {
	const t = useT();
	const lang = useLang();
	const confirm = useConfirm();
	const { account } = env;
	const [dialog, setDialog] = useState<"sign" | "send" | null>(null);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string>();
	const [exportText, setExportText] = useState<string>();
	const [fee, setFee] = useState<bigint | null>(null);

	const live = useMemo(() => ownerSetOf(env), [env]);
	// Live owners win over the snapshot: signatures of removed signers no longer count.
	const owners = live?.owners ?? op.owners ?? [];
	const threshold = live?.threshold ?? op.threshold ?? 1;
	const signedBy = useMemo(() => op.signatures.map((s) => s.signer), [op.signatures]);
	const count = validSignatureCount(op, owners);
	const ready = count >= threshold;
	const payload = op.payload;
	const hlPayload = payload?.kind === "hl" ? payload : undefined;
	const safePayload = payload?.kind === "safe" ? payload : undefined;
	const scope = account.kind === "safe" ? { chainId: account.chainId as number } : { hlEnv: account.env };
	const rows = useMemo(() => def.summary(op.params, { t, lang, account }), [def, op.params, t, lang, account]);
	const expiresAt = opExpiresAt(op);
	const expired = expiresAt !== undefined && expiresAt < Date.now();

	// Safe transactions execute strictly in nonce order.
	const safeNonce = env.safe?.nonce;
	const nonceState = useMemo<"ok" | "used" | "waiting">(() => {
		if (!safePayload || safeNonce === undefined) return "ok";
		const diff = BigInt(safeNonce) - BigInt(safePayload.tx.nonce);
		return diff > 0n ? "used" : diff < 0n ? "waiting" : "ok";
	}, [safePayload, safeNonce]);

	const closeDialog = useCallback(() => setDialog(null), []);
	const handleSignPick = useCallback((signer: Signer) => signOperation(op.id, signer, env), [op.id, env]);

	const finish = useCallback(() => {
		toast.success(t("ops.sent"));
		void celebrate();
	}, [t]);

	const handleSendPick = useCallback(
		async (signer: Signer) => {
			if (account.kind === "hl") await sendHlOperation(op, account, signer);
			else await sendSafeOperation(op, account, signer);
			finish();
		},
		[op, account, finish],
	);

	const handleSend = useCallback(async () => {
		setError(undefined);
		if (hlPayload && !hlPayload.multiSig) {
			setSending(true);
			try {
				await sendHlOperation(op, account);
				finish();
			} catch (e) {
				setError(describeError(e, t));
			} finally {
				setSending(false);
			}
			return;
		}
		setDialog("send");
	}, [hlPayload, op, account, finish, t]);

	const signers = env.signers;
	const sendAddresses = useMemo<Address[]>(() => {
		if (hlPayload) return [getAddress(hlPayload.leader)];
		const known = signers.map((s) => s.address);
		const isKnown = (a: Address): boolean => known.some((k) => sameAddress(k, a));
		// The account limits who sends: everyone it allows, the ones with a key here first.
		const limited = sendersOf(account, owners);
		if (limited) return [...limited.filter(isKnown), ...limited.filter((a) => !isKnown(a))];
		// Anyone may execute a Safe transaction: owners first, then the other known signers.
		return [
			...known.filter((a) => owners.some((o) => sameAddress(o, a))),
			...known.filter((a) => !owners.some((o) => sameAddress(o, a))),
		];
	}, [hlPayload, signers, owners, account]);

	// Estimate the execution cost while the "send" dialog is open.
	useEffect(() => {
		if (dialog !== "send" || account.kind !== "safe" || sendAddresses.length === 0) return undefined;
		let stale = false;
		setFee(null);
		planSafeSend(op, account, sendAddresses[0])
			.then((plan) => {
				if (!stale) setFee(plan.gas);
			})
			.catch((e: unknown) => {
				if (stale) return;
				setDialog(null);
				setError(describeError(e, t));
			});
		return () => {
			stale = true;
		};
	}, [dialog, account, op, sendAddresses, t]);

	const disabledForSign = useCallback(
		(signer: Signer) =>
			hlPayload?.signing === "l1" && signer.wallet === "metamask" ? t("ops.l1NoMetaMask") : undefined,
		[hlPayload, t],
	);

	const handleExport = useCallback(async () => {
		try {
			setExportText(await exportOperation(op, account));
		} catch (e) {
			toast.error(describeError(e, t));
		}
	}, [op, account, t]);

	const handleReset = useCallback(async () => {
		if (
			await confirm({
				title: t("ops.reset.title"),
				body: t("ops.reset.body"),
				confirmLabel: t("ops.reset.confirm"),
				danger: true,
			})
		) {
			resetOperation(op.id);
		}
	}, [confirm, op.id, t]);

	const handleDelete = useCallback(async () => {
		if (
			await confirm({
				title: t("ops.delete.title"),
				body: t("ops.delete.signing"),
				confirmLabel: t("common.delete"),
				danger: true,
			})
		) {
			deleteOperation(op.id);
		}
	}, [confirm, op.id, t]);

	const leaderKnown = !hlPayload?.multiSig || signers.some((s) => sameAddress(s.address, hlPayload.leader));
	const canSend = ready && nonceState === "ok" && !expired;

	return (
		<OpCardFrame
			icon={def.icon}
			title={t(opTitleKey(op.type))}
			badges={queueLabel && <span className="badge badge-ghost badge-sm tabular">{queueLabel}</span>}
			actions={
				<div className="dropdown dropdown-end">
					<button type="button" tabIndex={0} className="btn btn-ghost btn-sm btn-square" aria-label={t("ops.more")}>
						<EllipsisVertical className="size-4" />
					</button>
					<ul
						tabIndex={-1}
						className="dropdown-content menu bg-base-100 border-base-300 rounded-box z-10 w-60 border p-1 shadow-lg"
					>
						<li>
							<button type="button" onClick={() => void handleExport()}>
								<QrCode className="size-4" />
								{t("ops.export")}
							</button>
						</li>
						<li>
							<button type="button" onClick={() => void handleReset()}>
								<RotateCcw className="size-4" />
								{t("ops.reset.action")}
							</button>
						</li>
						<li>
							<button type="button" className="text-error" onClick={() => void handleDelete()}>
								<Trash2 className="size-4" />
								{t("common.delete")}
							</button>
						</li>
					</ul>
				</div>
			}
			footer={
				<>
					<button
						type="button"
						className="btn btn-ghost mr-auto whitespace-nowrap max-sm:px-2"
						onClick={() => void handleExport()}
						title={t("ops.export")}
					>
						<QrCode className="size-4" />
						{t("ops.exportShort")}
					</button>
					{ready ? (
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => void handleSend()}
							disabled={!canSend || sending}
						>
							{sending ? <Spinner /> : <Send className="size-4" />}
							{t("ops.send")}
						</button>
					) : (
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => setDialog("sign")}
							disabled={expired || nonceState === "used"}
						>
							<PenLine className="size-4" />
							{t("ops.sign")}
						</button>
					)}
				</>
			}
		>
			<OpSummary rows={rows} hlEnv={account.kind === "hl" ? account.env : undefined} />
			<SignersProgress
				owners={owners}
				threshold={threshold}
				signed={signedBy}
				leader={hlPayload?.multiSig ? getAddress(hlPayload.leader) : undefined}
				scope={scope}
			/>
			{expiresAt !== undefined && !expired && (
				<p className="text-base-content/60 text-xs">{t("ops.validUntil", { date: formatDateTime(expiresAt, lang) })}</p>
			)}
			{expired && <Notice tone="error">{t("ops.expired")}</Notice>}
			{nonceState === "used" && <Notice tone="error">{t("ops.nonceUsedNote")}</Notice>}
			{nonceState === "waiting" && ready && <Notice>{t("ops.nonceWaitingNote", { nonce: safeNonce ?? "" })}</Notice>}
			{ready && !leaderKnown && hlPayload && <Notice tone="warning">{t("ops.leaderElsewhere")}</Notice>}
			{error && <Notice tone="error">{error}</Notice>}

			<SignerPickerDialog
				open={dialog === "sign"}
				onClose={closeDialog}
				title={t("ops.pick.next")}
				addresses={owners}
				signed={signedBy}
				disabledReason={disabledForSign}
				scope={scope}
				onPick={handleSignPick}
			/>
			<SignerPickerDialog
				open={dialog === "send"}
				onClose={closeDialog}
				title={t("ops.pick.send")}
				hint={
					account.kind === "hl"
						? t("ops.pick.sendHlHint")
						: t(
								account.sendMode === "owners"
									? "ops.pick.sendOwnersHint"
									: account.sendMode === "selected"
										? "ops.pick.sendSelectedHint"
										: "ops.pick.sendSafeHint",
							)
				}
				addresses={sendAddresses}
				balanceChainId={account.kind === "safe" ? account.chainId : undefined}
				feeGas={account.kind === "safe" ? fee : undefined}
				scope={scope}
				onPick={handleSendPick}
			/>
			<TransferQrDialog
				open={exportText !== undefined}
				onClose={() => setExportText(undefined)}
				title={t("ops.exportTitle")}
				text={exportText ?? ""}
				summary={<p className="text-base-content/70 text-sm">{t("ops.exportHint")}</p>}
			/>
		</OpCardFrame>
	);
};
