import { CircleAlert, CircleCheck, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { AddressLabel } from "@/components/common/AddressLabel";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/i18n";
import type { AccountCheck } from "./useAccountCheck";

export interface CheckResultProps {
	check: AccountCheck;
	/** Network name used in the texts. */
	network: string;
	/** Shown instead of the check when set (e.g. "already added" with a link). */
	notice?: ReactNode;
}

/** Inline outcome of the account verification. */
export const CheckResult: React.FC<CheckResultProps> = ({ check, network, notice }) => {
	const t = useT();
	if (notice) {
		return (
			<div className="alert alert-soft alert-info text-sm" role="status">
				{notice}
			</div>
		);
	}
	if (check.status === "idle") return null;
	if (check.status === "checking") {
		return (
			<div className="text-base-content/70 flex items-center gap-2 text-sm" role="status">
				<Spinner size="xs" />
				{t("addAccount.checking", { network })}
			</div>
		);
	}
	if (check.status === "offline") {
		return (
			<div className="alert alert-soft alert-warning text-sm" role="status">
				<WifiOff className="size-4 shrink-0" />
				{t("addAccount.offline")}
			</div>
		);
	}
	if (check.status === "error") {
		return (
			<div className="alert alert-soft alert-error text-sm" role="alert">
				<CircleAlert className="size-4 shrink-0" />
				<span className="min-w-0 break-words">{check.message}</span>
			</div>
		);
	}
	const owners = check.safe?.owners ?? check.multiSig?.authorizedUsers;
	const threshold = check.safe?.threshold ?? check.multiSig?.threshold;
	return (
		<div className="border-success/40 bg-success/5 rounded-box border px-4 py-3" role="status">
			<div className="flex items-center gap-2 text-sm font-medium">
				<CircleCheck className="text-success size-4 shrink-0" />
				{check.safe
					? t("addAccount.foundSafe", { version: check.safe.version, network })
					: t("addAccount.foundHl", { network })}
			</div>
			{owners && threshold !== undefined ? (
				<>
					<p className="text-base-content/70 mt-2 text-xs font-medium tracking-wide uppercase">
						{t("addAccount.multiSig", { threshold, total: owners.length })}
					</p>
					<ul className="mt-2 flex flex-col gap-2 text-sm">
						{owners.map((o) => (
							<li key={o}>
								<AddressLabel address={o} size={24} />
							</li>
						))}
					</ul>
				</>
			) : (
				<p className="text-base-content/70 mt-1 text-sm">{t("addAccount.regularAccount")}</p>
			)}
		</div>
	);
};
