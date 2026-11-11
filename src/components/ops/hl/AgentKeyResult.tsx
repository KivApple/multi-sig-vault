import { Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Notice } from "@/components/common/Notice";
import { useCopy } from "@/hooks/useCopy";
import { useT } from "@/i18n";
import type { AgentParams } from "@/lib/ops/hl/agents";
import type { OpResultProps } from "@/lib/ops/types";
import { useAgentKey } from "./useAgentKey";

/** Shows the agent key the app generated so it can be copied into a trading bot. */
export const AgentKeyResult: React.FC<OpResultProps> = ({ op }) => {
	const t = useT();
	const copy = useCopy();
	const key = useAgentKey(op.id);
	const [visible, setVisible] = useState(false);
	if ((op.params as unknown as AgentParams).mode !== "generate" || key === undefined) return null;
	if (key === null) return <Notice tone="warning">{t("hl.agent.keyMissing")}</Notice>;
	return (
		<div className="flex flex-col gap-2">
			<span className="field-label mb-0">{t("hl.agent.privateKey")}</span>
			<div className="bg-base-200 rounded-field mono px-3 py-2 text-xs break-all select-all">
				{visible ? key : "•".repeat(40)}
			</div>
			<div className="flex gap-2">
				<button type="button" className="btn btn-sm" onClick={() => void copy(key, t("hl.agent.keyCopied"))}>
					<Copy className="size-4" />
					{t("common.copy")}
				</button>
				<button type="button" className="btn btn-ghost btn-sm" onClick={() => setVisible((v) => !v)}>
					{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
					{t(visible ? "common.hide" : "common.show")}
				</button>
			</div>
			<p className="text-base-content/60 text-xs">{t("hl.agent.keyNote")}</p>
		</div>
	);
};
