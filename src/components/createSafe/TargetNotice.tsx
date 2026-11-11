import { CircleAlert, WifiOff } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/i18n";
import { shortAddress } from "@/lib/format";
import type { TargetCheck } from "./useTargetState";

export interface TargetNoticeProps {
	target: TargetCheck;
	network: string;
	onRetry: () => void;
}

/** What stands between the form and the "Create" button on the target network. */
export const TargetNotice: React.FC<TargetNoticeProps> = ({ target, network, onRetry }) => {
	const t = useT();
	if (target.status === "idle") return null;
	if (target.status === "checking") {
		return (
			<div className="text-base-content/70 flex items-center gap-2 text-sm" role="status">
				<Spinner size="xs" />
				{t("createSafe.target.checking", { network })}
			</div>
		);
	}
	if (target.status === "offline") {
		return (
			<div className="alert alert-soft alert-warning text-sm" role="status">
				<WifiOff className="size-4 shrink-0" />
				{t("createSafe.target.offline")}
			</div>
		);
	}
	if (target.status === "error") {
		return (
			<div className="alert alert-soft alert-error text-sm" role="alert">
				<CircleAlert className="size-4 shrink-0" />
				<span className="min-w-0 flex-1 break-words">{target.message}</span>
				<button type="button" className="btn btn-xs" onClick={onRetry}>
					{t("common.retry")}
				</button>
			</div>
		);
	}
	if (target.missing.length > 0) {
		return (
			<div className="alert alert-soft alert-error text-sm" role="alert">
				<CircleAlert className="size-4 shrink-0" />
				<span>
					{t("createSafe.target.missing", { network, contracts: target.missing.map(shortAddress).join(", ") })}
				</span>
			</div>
		);
	}
	if (target.deployed) {
		return (
			<div className="alert alert-soft alert-info text-sm" role="status">
				{t("createSafe.target.exists", { network })}
			</div>
		);
	}
	return null;
};
