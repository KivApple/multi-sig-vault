import { PenLine, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Notice } from "@/components/common/Notice";
import { IconButton } from "@/components/ui/IconButton";
import { useConfirm } from "@/hooks/useConfirm";
import { useT } from "@/i18n";
import { deleteOperation, ownerSetOf, signOperation } from "@/lib/ops/engine";
import { opTitleKey } from "@/lib/ops/registry";
import type { OpDefinition, OpEnv } from "@/lib/ops/types";
import { useAppStore } from "@/store/appStore";
import type { Operation, Signer } from "@/types/domain";
import { OpCardFrame } from "./OpCardFrame";
import { SignerPickerDialog } from "./SignerPickerDialog";

export interface DraftOperationProps {
	op: Operation;
	def: OpDefinition;
	env: OpEnv;
}

/** Editable operation: parameter form, then the first signature. */
export const DraftOperation: React.FC<DraftOperationProps> = ({ op, def, env }) => {
	const t = useT();
	const confirm = useConfirm();
	const [showErrors, setShowErrors] = useState(false);
	const [picking, setPicking] = useState(false);
	const errors = useMemo(() => def.validate(op.params, env, t), [def, op.params, env, t]);
	const owners = useMemo(() => ownerSetOf(env), [env]);
	const { Form } = def;

	const handleChange = useCallback(
		(patch: Record<string, unknown>) => {
			useAppStore.getState().updateOperation(op.id, (current) => ({ params: { ...current.params, ...patch } }));
		},
		[op.id],
	);

	const handleSign = useCallback(() => {
		setShowErrors(true);
		if (Object.keys(errors).length === 0 && owners) setPicking(true);
	}, [errors, owners]);

	const handleDelete = useCallback(async () => {
		if (
			await confirm({
				title: t("ops.delete.title"),
				body: t("ops.delete.draft"),
				confirmLabel: t("common.delete"),
				danger: true,
			})
		) {
			deleteOperation(op.id);
		}
	}, [confirm, op.id, t]);

	const handlePick = useCallback((signer: Signer) => signOperation(op.id, signer, env), [op.id, env]);

	const disabledReason = useCallback(
		(signer: Signer) => (def.hlSigning === "l1" && signer.wallet === "metamask" ? t("ops.l1NoMetaMask") : undefined),
		[def.hlSigning, t],
	);
	const closePicker = useCallback(() => setPicking(false), []);

	const scope = env.account.kind === "safe" ? { chainId: env.account.chainId as number } : { hlEnv: env.account.env };
	const firstMatters = env.account.kind === "hl" && owners?.multiSig;

	return (
		<OpCardFrame
			icon={def.icon}
			title={t(opTitleKey(op.type))}
			actions={
				<IconButton label={t("common.delete")} onClick={() => void handleDelete()}>
					<Trash2 className="size-4" />
				</IconButton>
			}
			footer={
				<button type="button" className="btn btn-primary" onClick={handleSign} disabled={!owners}>
					<PenLine className="size-4" />
					{t("ops.sign")}
				</button>
			}
		>
			<Form opId={op.id} value={op.params} onChange={handleChange} env={env} errors={showErrors ? errors : {}} />
			{!owners && <Notice tone="warning">{t("ops.needAccountData")}</Notice>}
			{def.hlSigning === "l1" && <Notice>{t("ops.l1Note")}</Notice>}
			{owners && (
				<SignerPickerDialog
					open={picking}
					onClose={closePicker}
					title={t("ops.pick.first")}
					hint={firstMatters ? t("ops.pick.firstHlHint") : t("ops.pick.freezeHint")}
					addresses={owners.owners}
					disabledReason={disabledReason}
					scope={scope}
					onPick={handlePick}
				/>
			)}
		</OpCardFrame>
	);
};
