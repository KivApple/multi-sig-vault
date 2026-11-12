import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/i18n";
import { useStackNav } from "@/lib/navStack";

export interface PageHeaderProps {
	title: ReactNode;
	/** Shows the back button; the route is used only when there is nothing to go back to. Omit on top-level pages. */
	back?: string;
	actions?: ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, back, actions }) => {
	const t = useT();
	const nav = useStackNav();
	return (
		<header className="mb-4 flex min-h-10 items-center gap-2">
			{back && (
				<button
					type="button"
					className="btn btn-ghost btn-sm btn-square -ml-2"
					aria-label={t("common.back")}
					onClick={() => nav.back(back)}
				>
					<ArrowLeft className="size-5" />
				</button>
			)}
			{/* Only plain text is clipped here: a title with an icon must not lose the icon's badge. */}
			<h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">
				{typeof title === "string" ? <span className="block truncate">{title}</span> : title}
			</h1>
			{actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
		</header>
	);
};
