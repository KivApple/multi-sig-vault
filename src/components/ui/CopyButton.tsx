import { Copy } from "lucide-react";
import { useCallback, type MouseEvent } from "react";
import { useCopy } from "@/hooks/useCopy";
import { useT } from "@/i18n";

export interface CopyButtonProps {
	value: string;
	label?: string;
	className?: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({ value, label, className }) => {
	const copy = useCopy();
	const t = useT();
	const handleClick = useCallback(
		(e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			void copy(value);
		},
		[copy, value],
	);
	return (
		<button
			type="button"
			className={className ?? "btn btn-ghost btn-sm btn-square"}
			onClick={handleClick}
			aria-label={label ?? t("common.copy")}
			title={label ?? t("common.copy")}
		>
			<Copy className="size-4" />
		</button>
	);
};
