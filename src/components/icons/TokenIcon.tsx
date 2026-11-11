import { useCallback, useMemo, useState, type CSSProperties } from "react";
import type { Address } from "viem";
import { builtinIconUrl } from "@/lib/tokens/builtinPack";
import { downloadedIconUrl } from "@/lib/tokens/icons";
import { useTokenStore } from "@/lib/tokens/store";
import { iconSymbol } from "@/lib/tokens/symbols";
import { LetterAvatar } from "./LetterAvatar";

export interface TokenIconProps {
	symbol: string;
	chainId?: number;
	address?: Address;
	/** Hyperliquid coin name (`kPEPE`, `xyz:AMZN`, spot token name). */
	hl?: boolean;
	size?: number;
	className?: string;
}

/**
 * Token icon from local sources only: the bulk-downloaded icon for this exact token,
 * then the built-in pack by symbol, then a letter avatar. Nothing is requested per token.
 */
export const TokenIcon: React.FC<TokenIconProps> = ({ symbol, chainId, address, hl, size = 24, className }) => {
	const epoch = useTokenStore((s) => s.iconEpoch);
	const [broken, setBroken] = useState<string>();

	const src = useMemo(
		() =>
			(chainId !== undefined && address ? downloadedIconUrl(chainId, address) : undefined) ??
			builtinIconUrl(iconSymbol(symbol, hl)),
		// `epoch` changes when new icons arrive.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[symbol, chainId, address, hl, epoch],
	);
	const handleError = useCallback(() => setBroken(src), [src]);

	if (!src || broken === src) return <LetterAvatar symbol={symbol} size={size} className={className} />;

	const style: CSSProperties = { width: size, height: size };
	return (
		<span
			className={`ring-base-content/15 inline-block shrink-0 overflow-hidden rounded-full bg-white align-middle ring-1 ${className ?? ""}`}
			style={style}
		>
			<img
				src={src}
				alt=""
				width={size}
				height={size}
				draggable={false}
				decoding="async"
				className="block size-full object-cover"
				onError={handleError}
			/>
		</span>
	);
};
