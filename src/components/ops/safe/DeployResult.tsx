import { ExternalLink } from "lucide-react";
import { useEffect } from "react";
import { getAddress, parseEventLogs, type Address } from "viem";
import { AddressText } from "@/components/ui/AddressText";
import { CopyButton } from "@/components/ui/CopyButton";
import { explorerAddress } from "@/config/chains";
import { useT } from "@/i18n";
import { sameAddress } from "@/lib/format";
import { patchResultExtra } from "@/lib/ops/engine";
import type { OpResultProps } from "@/lib/ops/types";
import { getPublicClient } from "@/lib/rpc";
import { CREATE_CALL_ABI } from "@/lib/safe/abis";

/** Reads the `ContractCreation` event of an executed deployment and shows the new contract's address. */
export const DeployResult: React.FC<OpResultProps> = ({ op, account }) => {
	const t = useT();
	const chainId = account.chainId as number;
	const txHash = op.result?.txHash;
	const txStatus = op.result?.extra?.txStatus;
	const deployed = op.result?.extra?.deployed as Address | undefined;

	useEffect(() => {
		if (deployed || !txHash || txStatus === "reverted") return undefined;
		let alive = true;
		const load = async (): Promise<void> => {
			const receipt = await getPublicClient(chainId).getTransactionReceipt({ hash: txHash });
			if (!alive || receipt.status !== "success") return;
			// CreateCall runs as a delegatecall, so the Safe itself emits the event.
			const logs = parseEventLogs({ abi: CREATE_CALL_ABI, eventName: "ContractCreation", logs: receipt.logs });
			const hit = logs.find((l) => sameAddress(l.address, account.address));
			if (hit) patchResultExtra(op.id, { deployed: getAddress(hit.args.newContract) });
		};
		void load().catch(() => undefined);
		return () => {
			alive = false;
		};
	}, [deployed, txHash, txStatus, chainId, account.address, op.id]);

	if (!deployed) return null;
	return (
		<div className="bg-base-200 rounded-box flex items-center gap-2 px-3 py-2 text-sm">
			<div className="min-w-0 flex-1">
				<div className="text-base-content/60 text-xs">{t("advanced.deployedAt")}</div>
				<AddressText address={deployed} full />
			</div>
			<CopyButton value={deployed} />
			<a
				className="btn btn-ghost btn-sm btn-square"
				href={explorerAddress(chainId, deployed)}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={t("advanced.openExplorer")}
				title={t("advanced.openExplorer")}
			>
				<ExternalLink className="size-4" />
			</a>
		</div>
	);
};
