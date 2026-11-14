import { RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { Notice } from "@/components/common/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/i18n";
import type { OpDefinition, OpEnv, OpNotices } from "@/lib/ops/types";

const NO_NOTICES: OpNotices = { notices: [] };
const useNoNotices = (): OpNotices => NO_NOTICES;

export interface OpNoticesState {
	state: OpNotices;
	ticked: string[];
	toggle: (id: string) => void;
	/** Something is still being found out, or is waiting for a tick: the card's action stays off. */
	waiting: boolean;
}

/**
 * What an operation wants the user to know and agree to, worked out on this device from what it can
 * see now – for the one who drafts the operation and for everyone who signs or sends it later. The
 * ticks live with the card: they are consent to what is on screen, not part of the operation, and
 * nothing of this travels with it.
 */
export const useOpNotices = (def: OpDefinition, params: Record<string, unknown>, env: OpEnv): OpNoticesState => {
	const state = (def.useNotices ?? useNoNotices)(params, env);
	const [ticked, setTicked] = useState<string[]>([]);
	const toggle = useCallback(
		(id: string) => setTicked((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id])),
		[],
	);
	const waiting = !!state.pending || state.notices.some((n) => n.confirm && !ticked.includes(n.id));
	return { state, ticked, toggle, waiting };
};

export const OpNoticeList: React.FC<OpNoticesState> = ({ state, ticked, toggle }) => {
	const t = useT();
	const { notices, pending, checking, refresh } = state;
	return (
		<>
			{pending && (
				<p className="text-base-content/60 flex items-center gap-2 text-sm">
					<Spinner size="xs" />
					{t("ops.notice.checking")}
				</p>
			)}
			{notices.map((n) => (
				<Notice key={n.id} tone="warning">
					<div className="flex items-start gap-2">
						<div className="min-w-0 flex-1">
							<p>{n.text}</p>
							{n.confirm && (
								<label className="mt-2 flex cursor-pointer items-start gap-2 font-medium">
									<input
										type="checkbox"
										className="checkbox checkbox-sm mt-0.5"
										checked={ticked.includes(n.id)}
										onChange={() => toggle(n.id)}
									/>
									<span>{n.confirm}</span>
								</label>
							)}
						</div>
						{refresh && (
							<button
								type="button"
								className="btn btn-ghost btn-xs btn-square -mt-0.5 -mr-1 shrink-0"
								onClick={refresh}
								disabled={checking}
								aria-label={t("ops.notice.recheck")}
								title={t("ops.notice.recheck")}
							>
								{checking ? <Spinner size="xs" /> : <RefreshCw className="size-4" />}
							</button>
						)}
					</div>
				</Notice>
			))}
		</>
	);
};
