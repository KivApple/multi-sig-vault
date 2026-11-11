export interface SpinnerProps {
	size?: "xs" | "sm" | "md";
	className?: string;
}

const SIZE = { xs: "loading-xs", sm: "loading-sm", md: "loading-md" } as const;

export const Spinner: React.FC<SpinnerProps> = ({ size = "sm", className }) => (
	<span className={`loading loading-spinner ${SIZE[size]} ${className ?? ""}`} aria-hidden="true" />
);
