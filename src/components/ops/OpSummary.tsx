import { AddressLabel } from "@/components/common/AddressLabel";
import type { SummaryRow } from "@/lib/ops/types";
import type { NetworkEnv } from "@/types/domain";

export interface OpSummaryProps {
	rows: SummaryRow[];
	/** Hyperliquid environment used to resolve addresses without an explicit chain. */
	hlEnv?: NetworkEnv;
}

/** Compact read-only view of operation parameters: label on the left, value on the right. */
export const OpSummary: React.FC<OpSummaryProps> = ({ rows, hlEnv }) => (
	<dl className="flex flex-col gap-1.5 text-sm">
		{rows.map((row, i) =>
			!row.label ? (
				// A row without a label is a note that takes the whole width.
				// biome-ignore lint/suspicious/noArrayIndexKey: rows are static per render
				<div key={i} className={`text-xs ${row.tone === "warning" ? "text-warning" : "text-base-content/60"}`}>
					<dd>{row.value}</dd>
				</div>
			) : (
				// biome-ignore lint/suspicious/noArrayIndexKey: rows are static per render
				<div key={i} className="flex items-start justify-between gap-4">
					<dt className="text-base-content/60 shrink-0">{row.label}</dt>
					<dd
						className={`min-w-0 text-right ${row.mono ? "mono text-xs leading-5 break-all" : "break-words"} ${
							row.tone === "warning" ? "text-warning" : ""
						}`}
					>
						{row.address ? (
							<AddressLabel
								address={row.address}
								scope={row.chainId !== undefined ? { chainId: row.chainId } : hlEnv ? { hlEnv } : {}}
								size={22}
								className="justify-end text-left"
							/>
						) : (
							row.value
						)}
					</dd>
				</div>
			),
		)}
	</dl>
);
