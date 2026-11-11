import { Lock } from "lucide-react";
import type { Address } from "viem";
import { AddressLabel } from "@/components/common/AddressLabel";
import { useT } from "@/i18n";

export interface OwnersSummaryProps {
	owners: Address[];
	threshold: number;
	/** Why the set cannot be edited. */
	reason: string;
}

/** Read-only signer set – shown when owners are part of the address being reproduced. */
export const OwnersSummary: React.FC<OwnersSummaryProps> = ({ owners, threshold, reason }) => {
	const t = useT();
	return (
		<div className="card-surface px-4 py-3">
			<div className="flex items-center justify-between gap-2">
				<span className="text-base-content/60 text-xs font-medium tracking-wide uppercase">
					{t("createSafe.signers")}
				</span>
				<span className="badge badge-neutral badge-sm">
					{t("addAccount.multiSig", { threshold, total: owners.length })}
				</span>
			</div>
			<ul className="mt-3 flex flex-col gap-2 text-sm">
				{owners.map((o) => (
					<li key={o}>
						<AddressLabel address={o} size={24} />
					</li>
				))}
			</ul>
			<p className="text-base-content/60 mt-3 flex items-start gap-1.5 text-xs">
				<Lock className="mt-0.5 size-3 shrink-0" />
				{reason}
			</p>
		</div>
	);
};
