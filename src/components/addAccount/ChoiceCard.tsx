import type { ReactNode } from "react";

export interface ChoiceCardProps {
	selected: boolean;
	onSelect: () => void;
	icon: ReactNode;
	title: string;
	subtitle?: string;
	/** Compact variant for grids of four. */
	dense?: boolean;
}

/** Large radio-like card used for the account type and the network. */
export const ChoiceCard: React.FC<ChoiceCardProps> = ({ selected, onSelect, icon, title, subtitle, dense }) => (
	<button
		type="button"
		role="radio"
		aria-checked={selected}
		onClick={onSelect}
		className={`rounded-box flex min-w-0 items-center border text-left transition-colors ${
			dense ? "gap-2 px-3 py-2.5" : "gap-3 px-4 py-3.5"
		} ${selected ? "border-primary bg-primary/10" : "border-base-300 bg-base-100 hover:border-base-content/30"}`}
	>
		{icon}
		<span className="flex min-w-0 flex-col leading-tight">
			<span className="truncate font-semibold">{title}</span>
			{subtitle && <span className="text-base-content/60 truncate text-xs">{subtitle}</span>}
		</span>
	</button>
);
