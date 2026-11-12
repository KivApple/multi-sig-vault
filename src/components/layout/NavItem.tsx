import type { ReactNode } from "react";
import { useMatch } from "react-router";
import { SectionLink } from "@/components/ui/SectionLink";

export interface NavItemProps {
	to: string;
	label: string;
	icon: ReactNode;
	variant: "dock" | "bar";
	/** Highlight even when the route does not match (sub-pages of the section). */
	forceActive?: boolean;
}

export const NavItem: React.FC<NavItemProps> = ({ to, label, icon, variant, forceActive }) => {
	const active = !!useMatch({ path: to, end: to === "/" }) || !!forceActive;
	const current = active ? "page" : undefined;
	return variant === "dock" ? (
		<SectionLink to={to} className={active ? "dock-active text-primary" : ""} aria-current={current}>
			{icon}
			<span className="dock-label">{label}</span>
		</SectionLink>
	) : (
		<SectionLink to={to} className={`btn btn-sm gap-2 ${active ? "btn-neutral" : "btn-ghost"}`} aria-current={current}>
			{icon}
			{label}
		</SectionLink>
	);
};
