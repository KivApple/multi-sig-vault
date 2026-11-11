import type { ReactNode } from "react";

export interface SettingsSectionProps {
	title: string;
	children: ReactNode;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({ title, children }) => (
	<section className="mb-5">
		<h2 className="text-base-content/60 mb-2 px-1 text-xs font-semibold tracking-wide uppercase">{title}</h2>
		<div className="card-surface divide-base-300 divide-y">{children}</div>
	</section>
);
