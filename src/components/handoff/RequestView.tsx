import type { ReactNode } from "react";
import { formatEther } from "viem";
import { findChain } from "@/config/chains";
import { useT } from "@/i18n";
import type { HandoffRequest } from "@/lib/handoff/protocol";

export interface RequestViewProps {
	request: HandoffRequest;
}

interface Row {
	label: string;
	value: ReactNode;
}

const chainName = (id: number | undefined): string | undefined =>
	id === undefined ? undefined : (findChain(id)?.name ?? `chain ${id}`);

/** What the user is about to confirm, read from the decrypted request. Everything is rendered as text. */
export const RequestView: React.FC<RequestViewProps> = ({ request }) => {
	const t = useT();
	const rows: Row[] = [];
	let block: string | undefined;

	if (request.method === "accounts") {
		return <p className="text-sm">{t("handoff.accountsText")}</p>;
	}
	rows.push({ label: t("handoff.field.account"), value: request.address });
	if (request.method === "signTypedData") {
		const { domain, primaryType, message } = request.data;
		const network = chainName(domain.chainId);
		if (network) rows.push({ label: t("handoff.field.network"), value: network });
		if (domain.name) rows.push({ label: t("handoff.field.app"), value: domain.name });
		rows.push({ label: t("handoff.field.type"), value: primaryType });
		block = JSON.stringify(message, null, 2);
	} else {
		const chain = findChain(request.tx.chainId);
		rows.push({ label: t("handoff.field.network"), value: chainName(request.tx.chainId) });
		rows.push({ label: t("handoff.field.to"), value: request.tx.to });
		rows.push({
			label: t("handoff.field.value"),
			value: `${formatEther(BigInt(request.tx.value))} ${chain?.nativeSymbol ?? ""}`,
		});
		block = request.tx.data;
	}

	return (
		<div className="flex flex-col gap-3">
			<dl className="flex flex-col gap-2">
				{rows.map((row) => (
					<div key={row.label}>
						<dt className="field-label mb-0">{row.label}</dt>
						<dd className="mono text-sm break-all">{row.value}</dd>
					</div>
				))}
			</dl>
			{block && (
				<div>
					<div className="field-label">
						{t(request.method === "signTypedData" ? "handoff.field.message" : "handoff.field.data")}
					</div>
					<pre className="bg-base-200 rounded-box mono max-h-64 overflow-auto p-3 text-xs break-all whitespace-pre-wrap">
						{block}
					</pre>
				</div>
			)}
		</div>
	);
};
