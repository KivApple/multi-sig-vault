import type { CSSProperties } from "react";

export interface TestRibbonProps {
	/** Size of the icon the ribbon is drawn over. */
	size: number;
}

/** Diagonal "test" band across the top-left corner; below 32 px it is a plain colour band. */
export const TestRibbon: React.FC<TestRibbonProps> = ({ size }) => {
	const withText = size >= 32;
	const height = size * (withText ? 0.26 : 0.2);
	const style: CSSProperties = {
		width: size,
		height,
		left: -size * 0.23,
		top: size * 0.27 - height / 2,
		transform: "rotate(-45deg)",
		fontSize: size * 0.185,
		lineHeight: `${height}px`,
		background: "#F5A524",
		color: "#231500",
	};
	return (
		<span
			className="pointer-events-none absolute block text-center font-bold tracking-wide uppercase select-none"
			style={style}
			aria-hidden="true"
		>
			{withText ? "test" : ""}
		</span>
	);
};
