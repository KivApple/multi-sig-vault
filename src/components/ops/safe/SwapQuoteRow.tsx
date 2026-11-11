import { Spinner } from "@/components/ui/Spinner";

export interface SwapQuoteRowProps {
	label: string;
	value: string;
	strong?: boolean;
	warn?: boolean;
	/** A fresher value is being fetched. */
	busy?: boolean;
}

export const SwapQuoteRow: React.FC<SwapQuoteRowProps> = ({ label, value, strong, warn, busy }) => (
	<div className="flex items-baseline justify-between gap-3">
		<span className="text-base-content/60">{label}</span>
		<span className={`tabular flex items-center gap-1.5 text-right ${strong ? "font-semibold" : ""} ${warn ? "text-warning" : ""}`}>
			{busy && <Spinner size="xs" />}
			{value}
		</span>
	</div>
);
