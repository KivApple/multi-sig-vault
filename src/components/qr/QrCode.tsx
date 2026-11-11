import { useMemo } from "react";
import { useT } from "@/i18n";
import { buildQrMatrix } from "@/lib/qr/matrix";

export interface QrCodeProps {
	value: string;
	/** Rendered width/height in CSS pixels (scales down to the container). */
	size?: number;
	className?: string;
}

const QUIET = 3;

/** Always dark-on-white with a quiet zone, so it scans regardless of the app theme. */
export const QrCode: React.FC<QrCodeProps> = ({ value, size = 240, className }) => {
	const t = useT();
	const matrix = useMemo(() => buildQrMatrix(value), [value]);

	if (!matrix) {
		return (
			<div
				className={`bg-base-200 text-base-content/70 rounded-box flex aspect-square max-w-full items-center justify-center p-6 text-center text-sm ${className ?? ""}`}
				style={{ width: size }}
			>
				{t("qr.tooLong")}
			</div>
		);
	}

	const full = matrix.size + QUIET * 2;
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox={`0 0 ${full} ${full}`}
			width={size}
			height={size}
			role="img"
			aria-label="QR"
			shapeRendering="crispEdges"
			className={`h-auto max-w-full ${className ?? ""}`}
		>
			<rect width={full} height={full} rx={1.5} fill="#fff" />
			<path d={matrix.path} transform={`translate(${QUIET} ${QUIET})`} fill="#000" />
		</svg>
	);
};
