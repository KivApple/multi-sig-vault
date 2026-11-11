import { TextField } from "@/components/common/TextField";
import { useT } from "@/i18n";
import type { OpFormProps } from "@/lib/ops/types";
import type { SignMessageParams } from "@/lib/ops/safe/signMessage";

/** A single 32-byte hash the Safe will approve on-chain (EIP-1271). */
export const SignMessageForm: React.FC<OpFormProps<SignMessageParams>> = ({ value, onChange, errors }) => {
	const t = useT();
	return (
		<TextField
			label={t("advanced.hash")}
			value={value.hash}
			onChange={(hash) => onChange({ hash: hash.trim() })}
			error={errors.hash}
			mono
			placeholder="0x…"
			hint={t("advanced.hashHint")}
		/>
	);
};
