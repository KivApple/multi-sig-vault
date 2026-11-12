import { useCallback, type MouseEvent, type ReactNode } from "react";
import { useHref } from "react-router";
import { useStackNav } from "@/lib/navStack";

export interface SectionLinkProps {
	to: string;
	className?: string;
	children: ReactNode;
	"aria-current"?: "page";
}

/** Link to a top-level section: switches in place instead of adding a history entry (see navStack). */
export const SectionLink: React.FC<SectionLinkProps> = ({ to, className, children, ...rest }) => {
	const href = useHref(to);
	const { toSection } = useStackNav();
	const handleClick = useCallback(
		(e: MouseEvent<HTMLAnchorElement>) => {
			// Leave "open in a new tab" and the like to the browser.
			if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			e.preventDefault();
			toSection(to);
		},
		[to, toSection],
	);
	return (
		<a href={href} className={className} onClick={handleClick} {...rest}>
			{children}
		</a>
	);
};
