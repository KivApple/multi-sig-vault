import { useCallback } from "react";
import { OwnersEditor } from "@/components/common/OwnersEditor";
import type { SafeOwnersParams } from "@/lib/ops/safe/owners";
import type { OpFormProps } from "@/lib/ops/types";

export const SafeOwnersForm: React.FC<OpFormProps<SafeOwnersParams>> = ({ value, onChange, errors }) => {
	const handleChange = useCallback(
		(owners: string[], threshold: number) => onChange({ owners, threshold }),
		[onChange],
	);
	return <OwnersEditor owners={value.owners} threshold={value.threshold} onChange={handleChange} errors={errors} />;
};
