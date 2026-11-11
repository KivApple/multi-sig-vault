import { Download } from "lucide-react";
import { useCallback, useState } from "react";
import { TextField } from "@/components/common/TextField";
import { Spinner } from "@/components/ui/Spinner";
import { useOnline } from "@/hooks/useOnline";
import { useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { fetchSourcifyAbi } from "@/lib/evm/abi";
import { parseAddress } from "@/lib/format";
import { toast } from "@/lib/toast";

export interface AbiSourceInputProps {
	value: string;
	onChange: (text: string) => void;
	chainId: number;
	/** Contract whose verified ABI can be downloaded. */
	address: string;
	error?: string;
}

/** ABI text area plus "load the verified ABI" for the entered contract address. */
export const AbiSourceInput: React.FC<AbiSourceInputProps> = ({ value, onChange, chainId, address, error }) => {
	const t = useT();
	const online = useOnline();
	const [loading, setLoading] = useState(false);
	const target = parseAddress(address);

	const handleLoad = useCallback(async () => {
		if (!target) return;
		setLoading(true);
		try {
			onChange(await fetchSourcifyAbi(chainId, target));
		} catch (e) {
			toast.error(describeError(e, t));
		} finally {
			setLoading(false);
		}
	}, [chainId, onChange, t, target]);

	return (
		<div className="flex flex-col gap-2">
			<TextField
				label={t("advanced.abi")}
				value={value}
				onChange={onChange}
				error={error}
				rows={4}
				mono
				placeholder={t("advanced.abiPlaceholder")}
				hint={t("advanced.abiHint")}
			/>
			{target && online && (
				<button type="button" className="btn btn-outline btn-sm self-start" onClick={handleLoad} disabled={loading}>
					{loading ? <Spinner size="xs" /> : <Download className="size-4" />}
					{t("advanced.loadAbi")}
				</button>
			)}
		</div>
	);
};
