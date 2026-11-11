import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useT } from "@/i18n";

export interface PageHeaderProps {
	title: ReactNode;
	/** Route to go back to; omit on top-level pages. */
	back?: string;
	actions?: ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, back, actions }) => {
	const t = useT();
	return (
		<header className="mb-4 flex min-h-10 items-center gap-2">
			{back && (
				<Link to={back} className="btn btn-ghost btn-sm btn-square -ml-2" aria-label={t("common.back")}>
					<ArrowLeft className="size-5" />
				</Link>
			)}
			<h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">{title}</h1>
			{actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
		</header>
	);
};
