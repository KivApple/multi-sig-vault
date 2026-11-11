import { Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export interface NoticeProps {
	tone?: "info" | "warning" | "error";
	children: ReactNode;
	className?: string;
}

const TONE = {
	info: "bg-info/10 text-base-content",
	warning: "bg-warning/15 text-base-content",
	error: "bg-error/10 text-error",
} as const;

/** Short inline note inside forms and cards. */
export const Notice: React.FC<NoticeProps> = ({ tone = "info", children, className }) => {
	const Icon = tone === "info" ? Info : TriangleAlert;
	return (
		<div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${TONE[tone]} ${className ?? ""}`} role="note">
			<Icon
				className={`mt-0.5 size-4 shrink-0 ${tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : ""}`}
			/>
			<div className="min-w-0 break-words">{children}</div>
		</div>
	);
};
