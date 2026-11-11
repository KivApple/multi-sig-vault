import { RefreshCw } from "lucide-react";
import type { Address } from "viem";
import { AddressText } from "@/components/ui/AddressText";
import { CopyButton } from "@/components/ui/CopyButton";
import { useT } from "@/i18n";

export interface AddressPreviewProps {
	address: Address;
	/** Shown for the "new address" mode: picks another random salt. */
	onRegenerate?: () => void;
	disabled?: boolean;
}

/** The address the Safe will get – known before anything is sent. */
export const AddressPreview: React.FC<AddressPreviewProps> = ({ address, onRegenerate, disabled }) => {
	const t = useT();
	return (
		<div className="card-surface px-4 py-3">
			<div className="text-base-content/60 text-xs font-medium tracking-wide uppercase">{t("createSafe.preview")}</div>
			<div className="mt-1 flex items-center gap-1">
				<AddressText address={address} full className="min-w-0 flex-1 text-sm" />
				<CopyButton value={address} label={t("common.copyAddress")} />
				{onRegenerate && (
					<button
						type="button"
						className="btn btn-ghost btn-sm btn-square"
						onClick={onRegenerate}
						disabled={disabled}
						aria-label={t("createSafe.regenerate")}
						title={t("createSafe.regenerate")}
					>
						<RefreshCw className="size-4" />
					</button>
				)}
			</div>
		</div>
	);
};
