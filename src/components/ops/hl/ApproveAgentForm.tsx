import { useCallback, useEffect } from "react";
import { Notice } from "@/components/common/Notice";
import { TextField } from "@/components/common/TextField";
import { Field } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { useT } from "@/i18n";
import { agentDays, type AgentParams } from "@/lib/ops/hl/agents";
import { ensureAgentKey } from "@/lib/ops/hl/common";
import type { OpFormProps } from "@/lib/ops/types";
import { ValidityField } from "./ValidityField";

export const ApproveAgentForm: React.FC<OpFormProps<AgentParams>> = ({ opId, value, onChange, errors }) => {
	const t = useT();
	const generated = value.mode === "generate";

	// The generated key lives in the secure store under the operation id; make sure it exists.
	useEffect(() => {
		if (!generated || value.agentAddress) return;
		let stale = false;
		void ensureAgentKey(opId).then((agentAddress) => {
			if (!stale) onChange({ agentAddress });
		});
		return () => {
			stale = true;
		};
	}, [generated, value.agentAddress, opId, onChange]);

	const handleMode = useCallback((mode: AgentParams["mode"]) => onChange({ mode, agentAddress: "" }), [onChange]);

	return (
		<div className="flex flex-col gap-4">
			<TextField
				label={t("hl.agent.name")}
				value={value.name}
				onChange={(name) => onChange({ name })}
				maxLength={16}
				error={errors.name}
				hint={t("hl.agent.nameHint")}
			/>
			<ValidityField days={agentDays(value)} onChange={(days) => onChange({ days })} error={errors.days} />
			<Field label={t("hl.agent.key")}>
				<Segmented
					value={value.mode}
					options={[
						{ value: "generate", label: t("hl.agent.generate") },
						{ value: "manual", label: t("hl.agent.manual") },
					]}
					onChange={handleMode}
					ariaLabel={t("hl.agent.key")}
				/>
			</Field>
			{generated ? (
				<Notice>{t("hl.agent.generateNote")}</Notice>
			) : (
				<TextField
					label={t("hl.agent.address")}
					value={value.agentAddress}
					onChange={(agentAddress) => onChange({ agentAddress: agentAddress.trim() })}
					placeholder="0x…"
					mono
					error={errors.agentAddress}
				/>
			)}
		</div>
	);
};
