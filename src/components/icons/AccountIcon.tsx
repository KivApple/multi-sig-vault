import type { CSSProperties } from "react";
import type { AccountKind, NetworkEnv } from "@/types/domain";
import { BRAND_SRC } from "./BrandIcon";
import { IconChip } from "./IconChip";
import { NetworkIcon } from "./NetworkIcon";
import { TestRibbon } from "./TestRibbon";

export interface AccountIconProps {
	kind: AccountKind;
	env: NetworkEnv;
	/** Safe accounts: chain shown as a badge in the bottom-right corner. */
	chainId?: number;
	size?: number;
	className?: string;
}

/**
 * Account type logo (Hyperliquid or Safe). Safe gets its network badge bottom-right,
 * testnet accounts a "test" ribbon top-left; mainnet is the unmarked default.
 */
export const AccountIcon: React.FC<AccountIconProps> = ({ kind, env, chainId, size = 40, className }) => {
	const badge = Math.round(size * 0.46);
	const offset = -Math.round(size * 0.12);
	const badgeStyle: CSSProperties = { right: offset, bottom: offset };
	return (
		<span
			className={`relative inline-block shrink-0 align-middle ${className ?? ""}`}
			style={{ width: size, height: size }}
			role="img"
			aria-label={`${kind === "hl" ? "Hyperliquid" : "Safe"}${env === "testnet" ? " testnet" : ""}`}
		>
			<IconChip src={BRAND_SRC[kind === "hl" ? "hyperliquid" : "safe"]} size={size} shape="squircle">
				{env === "testnet" && <TestRibbon size={size} />}
			</IconChip>
			{kind === "safe" && chainId !== undefined && (
				<span className="border-base-100 bg-base-100 absolute flex rounded-full border-2" style={badgeStyle}>
					<NetworkIcon chainId={chainId} size={badge} />
				</span>
			)}
		</span>
	);
};
