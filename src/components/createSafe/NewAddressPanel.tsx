import { OwnersEditor } from "@/components/common/OwnersEditor";

export interface NewAddressPanelProps {
	owners: string[];
	threshold: number;
	onChange: (owners: string[], threshold: number) => void;
	errors: Record<string, string>;
	disabled?: boolean;
}

/** Mode "new address": pick signers and the threshold; the address follows from them and a random salt. */
export const NewAddressPanel: React.FC<NewAddressPanelProps> = ({ owners, threshold, onChange, errors, disabled }) => (
	<OwnersEditor owners={owners} threshold={threshold} onChange={onChange} errors={errors} disabled={disabled} />
);
