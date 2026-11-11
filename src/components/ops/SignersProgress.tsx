import { Check, Circle } from "lucide-react";
import type { Address } from "viem";
import { AddressLabel } from "@/components/common/AddressLabel";
import { useT } from "@/i18n";
import { sameAddress } from "@/lib/format";
import type { AddressScope } from "@/lib/known";

export interface SignersProgressProps {
	owners: Address[];
	threshold: number;
	signed: Address[];
	/** Hyperliquid: the signer who must submit the operation. */
	leader?: Address;
	scope: AddressScope;
}

/** Who has signed, and how far the operation is from its threshold. */
export const SignersProgress: React.FC<SignersProgressProps> = ({ owners, threshold, signed, leader, scope }) => {
	const t = useT();
	const count = owners.filter((o) => signed.some((s) => sameAddress(s, o))).length;
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-3">
				<progress
					className={`progress h-2 flex-1 ${count >= threshold ? "progress-success" : "progress-primary"}`}
					value={Math.min(count, threshold)}
					max={threshold}
					aria-label={t("ops.signatures")}
				/>
				<span className="tabular text-sm font-medium">{t("ops.signedOf", { count, threshold })}</span>
			</div>
			<ul className="flex flex-col gap-1.5">
				{owners.map((owner) => {
					const done = signed.some((s) => sameAddress(s, owner));
					return (
						<li key={owner} className="flex items-center gap-2 text-sm">
							{done ? (
								<Check className="text-success size-4 shrink-0" aria-label={t("ops.signed")} />
							) : (
								<Circle className="text-base-content/25 size-4 shrink-0" aria-label={t("ops.notSigned")} />
							)}
							<AddressLabel address={owner} scope={scope} size={22} compact />
							{leader && sameAddress(leader, owner) && (
								<span className="badge badge-ghost badge-sm">{t("ops.sender")}</span>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
};
