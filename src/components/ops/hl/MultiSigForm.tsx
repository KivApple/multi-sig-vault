import { useCallback } from "react";
import { Notice } from "@/components/common/Notice";
import { OwnersEditor } from "@/components/common/OwnersEditor";
import { useT } from "@/i18n";
import { HL_MAX_SIGNERS, type MultiSigParams } from "@/lib/ops/hl/multisig";
import type { OpFormProps } from "@/lib/ops/types";

export const MultiSigForm: React.FC<OpFormProps<MultiSigParams>> = ({ value, onChange, env, errors }) => {
	const t = useT();
	const handleChange = useCallback(
		(owners: string[], threshold: number) => onChange({ owners, threshold }),
		[onChange],
	);
	return (
		<div className="flex flex-col gap-4">
			{!env.hl?.multiSig && <Notice tone="warning">{t("hl.multiSig.convertNote")}</Notice>}
			<OwnersEditor
				owners={value.owners}
				threshold={value.threshold}
				onChange={handleChange}
				maxOwners={HL_MAX_SIGNERS}
				errors={errors}
			/>
		</div>
	);
};
