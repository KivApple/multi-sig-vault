import { size, type Hex } from "viem";
import { CopyButton } from "@/components/ui/CopyButton";
import { useT } from "@/i18n";

export interface AbiCalldataPreviewProps {
	data: Hex;
	/** Caption of the collapsed row, e.g. the 4-byte selector. */
	caption?: string;
}

/** Collapsed, copyable view of encoded bytes. */
export const AbiCalldataPreview: React.FC<AbiCalldataPreviewProps> = ({ data, caption }) => {
	const t = useT();
	return (
		<details className="bg-base-200 rounded-box text-sm">
			<summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
				<span className="text-base-content/60">{t("advanced.data")}</span>
				<span className="mono min-w-0 flex-1 truncate">
					{caption ? `${caption} · ` : ""}
					{t("advanced.bytes", { count: size(data) })}
				</span>
				<CopyButton value={data} className="btn btn-ghost btn-xs btn-square" />
			</summary>
			<p className="mono max-h-40 overflow-y-auto px-3 pb-3 text-xs break-all">{data}</p>
		</details>
	);
};
