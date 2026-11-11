import { ExternalLink } from "lucide-react";
import type { Hex } from "viem";
import { Spinner } from "@/components/ui/Spinner";
import { explorerTx } from "@/config/chains";
import { useT } from "@/i18n";

export interface DeploymentStatusProps {
	chainId: number;
	txHash: Hex;
	waiting: boolean;
	error?: string;
	onRetry: () => void;
	onDiscard: () => void;
}

/** Progress of a sent deployment transaction, with a way out when it never confirms. */
export const DeploymentStatus: React.FC<DeploymentStatusProps> = ({ chainId, txHash, waiting, error, onRetry, onDiscard }) => {
	const t = useT();
	return (
		<div className="card-surface flex flex-col gap-3 px-4 py-4" role="status">
			<div className="flex items-center gap-2 font-medium">
				{waiting && <Spinner />}
				{waiting ? t("createSafe.deploy.waiting") : t("createSafe.deploy.unconfirmed")}
			</div>
			<a
				className="link text-base-content/70 mono inline-flex items-center gap-1 self-start text-xs break-all"
				href={explorerTx(chainId, txHash)}
				target="_blank"
				rel="noopener noreferrer"
			>
				{txHash.slice(0, 18)}…
				<ExternalLink className="size-3 shrink-0" />
			</a>
			{error && <p className="text-error text-sm">{error}</p>}
			{!waiting && (
				<div className="flex flex-wrap gap-2">
					<button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>
						{t("createSafe.deploy.checkAgain")}
					</button>
					<button type="button" className="btn btn-ghost btn-sm" onClick={onDiscard}>
						{t("createSafe.deploy.discard")}
					</button>
				</div>
			)}
		</div>
	);
};
