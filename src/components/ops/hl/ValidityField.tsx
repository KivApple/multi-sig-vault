import { useCallback } from "react";
import { Field } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { AGENT_DAY_PRESETS, AGENT_MAX_DAYS } from "@/lib/ops/hl/agents";

export interface ValidityFieldProps {
	days: number;
	onChange: (days: number) => void;
	error?: string;
}

/** How long an agent key stays valid: common terms as buttons, or any whole number of days the exchange allows. */
export const ValidityField: React.FC<ValidityFieldProps> = ({ days, onChange, error }) => {
	const t = useT();
	const handleInput = useCallback(
		(text: string) => {
			const digits = text.replace(/\D/g, "").slice(0, 3);
			// An empty field is 0 days: invalid, and reported as such, rather than silently replaced.
			onChange(digits ? Number(digits) : 0);
		},
		[onChange],
	);

	return (
		<Field label={t("hl.agent.validity")} error={error} hint={t("hl.agent.validityHint", { max: AGENT_MAX_DAYS })}>
			<div className="flex flex-wrap items-center gap-2">
				<div className="join" role="radiogroup" aria-label={t("hl.agent.validity")}>
					{AGENT_DAY_PRESETS.map((preset) => (
						<button
							key={preset}
							type="button"
							role="radio"
							aria-checked={days === preset}
							className={`btn btn-sm join-item tabular ${days === preset ? "btn-primary" : ""}`}
							onClick={() => onChange(preset)}
						>
							{preset}
						</button>
					))}
				</div>
				<label className="input input-sm flex w-28 items-center gap-2">
					<input
						className="tabular w-full min-w-0"
						inputMode="numeric"
						value={days > 0 ? String(days) : ""}
						onChange={(e) => handleInput(e.target.value)}
						aria-label={t("hl.agent.validityCustom")}
						aria-invalid={!!error}
					/>
					<span className="text-base-content/60 text-xs">{t("hl.agent.daysUnit")}</span>
				</label>
			</div>
		</Field>
	);
};
