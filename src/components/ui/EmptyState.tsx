import type { ReactNode } from "react";

export interface EmptyStateProps {
	icon?: ReactNode;
	title: string;
	text?: string;
	action?: ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, text, action }) => (
	<div className="card-surface flex flex-col items-center gap-3 px-6 py-10 text-center">
		{icon && <div className="text-base-content/40">{icon}</div>}
		<div>
			<p className="font-semibold">{title}</p>
			{text && <p className="text-base-content/60 mx-auto mt-1 max-w-sm text-sm">{text}</p>}
		</div>
		{action}
	</div>
);
