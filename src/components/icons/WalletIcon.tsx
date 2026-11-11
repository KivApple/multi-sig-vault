import ledger from "@/assets/icons/brand/ledger.svg";
import metamask from "@/assets/icons/brand/metamask.svg";
import trezor from "@/assets/icons/brand/trezor.svg";
import type { WalletKind } from "@/types/domain";
import { IconChip } from "./IconChip";

export interface WalletIconProps {
	kind: WalletKind;
	size?: number;
	className?: string;
}

const SRC: Record<WalletKind, string> = { metamask, ledger, trezor };

/** Official wallet marks: MetaMask fox, Ledger and Trezor logos on their brand chips. */
export const WalletIcon: React.FC<WalletIconProps> = ({ kind, size = 24, className }) => (
	<IconChip src={SRC[kind]} size={size} shape="squircle" className={className} />
);
