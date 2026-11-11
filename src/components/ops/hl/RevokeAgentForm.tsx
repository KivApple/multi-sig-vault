import { KeyRound } from "lucide-react";
import { useMemo } from "react";
import { PickerSelect, type PickerOption } from "@/components/common/PickerSelect";
import { Field } from "@/components/ui/Field";
import { useLang, useT } from "@/i18n";
import { formatDateTime, shortAddress } from "@/lib/format";
import type { RevokeParams } from "@/lib/ops/hl/agents";
import type { OpFormProps } from "@/lib/ops/types";

export const RevokeAgentForm: React.FC<OpFormProps<RevokeParams>> = ({ value, onChange, env, errors }) => {
	const t = useT();
	const lang = useLang();
	const options = useMemo<PickerOption[]>(
		() =>
			(env.hlExtras?.agents ?? []).map((a) => ({
				value: a.name,
				title: a.name,
				subtitle: `${shortAddress(a.address)} · ${t("hl.agent.validUntil", { date: formatDateTime(a.validUntil, lang) })}`,
				icon: <KeyRound className="text-base-content/60 size-5" />,
			})),
		[env.hlExtras, lang, t],
	);
	return (
		<Field label={t("hl.agent.which")} error={errors.name}>
			<PickerSelect
				value={value.name || undefined}
				options={options}
				onChange={(name) => {
					const agent = env.hlExtras?.agents.find((a) => a.name === name);
					onChange({ name, address: agent?.address ?? "" });
				}}
				title={t("hl.agent.which")}
				invalid={!!errors.name}
			/>
		</Field>
	);
};
