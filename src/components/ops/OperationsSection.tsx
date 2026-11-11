import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { uuid } from "@/lib/format";
import type { OpDefinition, OpEnv } from "@/lib/ops/types";
import { toast } from "@/lib/toast";
import { useAppStore } from "@/store/appStore";
import type { Operation } from "@/types/domain";
import { NewOperationDialog } from "./NewOperationDialog";
import { OperationCard } from "./OperationCard";

export interface OperationsSectionProps {
	env: OpEnv;
}

/** Queue position labels: Safe – the transaction nonce; Hyperliquid – order of signing start. */
const queueLabels = (ops: Operation[]): Map<string, string> => {
	const labels = new Map<string, string>();
	const signing = ops.filter((o) => o.status === "signing" && o.payload);
	const hl = signing.filter((o) => o.payload?.kind === "hl").sort((a, b) => (a.frozenAt ?? 0) - (b.frozenAt ?? 0));
	hl.forEach((o, i) => labels.set(o.id, `#${i + 1}`));
	for (const o of signing) {
		if (o.payload?.kind === "safe") labels.set(o.id, `#${o.payload.tx.nonce}`);
	}
	return labels;
};

/** "New operation" button and the account's operation cards. */
export const OperationsSection: React.FC<OperationsSectionProps> = ({ env }) => {
	const t = useT();
	const [picking, setPicking] = useState(false);
	const all = useAppStore((s) => s.operations);
	const ops = useMemo(() => all.filter((o) => o.accountId === env.account.id), [all, env.account.id]);
	const labels = useMemo(() => queueLabels(ops), [ops]);
	// Active operations first (in creation order), finished ones below.
	const ordered = useMemo(
		() =>
			[...ops].sort((a, b) => Number(a.status === "sent") - Number(b.status === "sent") || a.createdAt - b.createdAt),
		[ops],
	);

	const handlePick = useCallback(
		async (def: OpDefinition) => {
			setPicking(false);
			const id = uuid();
			try {
				const params = { ...def.defaults(env), ...(def.init ? await def.init(id, def.defaults(env)) : {}) };
				useAppStore.getState().addOperation({
					id,
					accountId: env.account.id,
					type: def.type,
					params,
					status: "draft",
					createdAt: Date.now(),
					signatures: [],
				});
			} catch (e) {
				toast.error(describeError(e, t));
			}
		},
		[env, t],
	);

	return (
		<section className="flex flex-col gap-3">
			<button type="button" className="btn btn-primary self-start" onClick={() => setPicking(true)}>
				<Plus className="size-4" />
				{t("ops.new")}
			</button>
			{ordered.map((op) => (
				<OperationCard key={op.id} op={op} env={env} queueLabel={labels.get(op.id)} />
			))}
			<NewOperationDialog
				open={picking}
				onClose={() => setPicking(false)}
				env={env}
				onPick={(d) => void handlePick(d)}
			/>
		</section>
	);
};
