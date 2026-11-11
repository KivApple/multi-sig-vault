import type { CSSProperties, ReactNode } from "react";

export interface IconChipProps {
	/** Static SVG asset: an official mark on its own filled square. */
	src: string;
	size: number;
	shape: "circle" | "squircle";
	className?: string;
	/** Overlays clipped to the chip (e.g. the testnet ribbon). */
	children?: ReactNode;
}

/**
 * Fixed-size logo chip. Marks carry their brand background, so they read the same on light and
 * dark themes; a hairline ring separates dark chips from dark surfaces and light from light.
 */
export const IconChip: React.FC<IconChipProps> = ({ src, size, shape, className, children }) => {
	const style: CSSProperties = { width: size, height: size };
	return (
		<span
			className={`ring-base-content/15 relative inline-block shrink-0 overflow-hidden align-middle ring-1 ${
				shape === "circle" ? "rounded-full" : "rounded-[28%]"
			} ${className ?? ""}`}
			style={style}
		>
			<img src={src} alt="" width={size} height={size} draggable={false} className="block size-full" />
			{children}
		</span>
	);
};
