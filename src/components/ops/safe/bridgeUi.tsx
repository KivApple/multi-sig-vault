import type { BridgeKind, ChainConfig } from "@/config/chains";
import { useT } from "@/i18n";
import type { SwapParams } from "@/lib/evm/swapBuild";
import type { OpResultProps } from "@/lib/ops/types";
import { SwapAcrossResult } from "./SwapAcrossResult";
import { SwapBridgeOptions } from "./SwapBridgeOptions";
import { SwapCctpResult } from "./SwapCctpResult";

export interface BridgeOptionsProps {
	value: SwapParams;
	onChange: (patch: Partial<SwapParams>) => void;
	chainId: number;
}

/** What a bridge shows of its own: every bridge has an entry (see `BridgeProvider`). */
export interface BridgeUi {
	/** Settings of the transfer only this bridge has. */
	Options?: React.FC<BridgeOptionsProps>;
	/** What the user should know before sending through it. */
	Note?: React.FC<{ src: ChainConfig }>;
	/** Sent card: follows the transfer to the other network. */
	Result: React.FC<OpResultProps>;
}

const AcrossNote: React.FC<{ src: ChainConfig }> = ({ src }) => {
	const t = useT();
	return <p className="text-base-content/60 text-xs">{t("swap.acrossNote", { network: src.name })}</p>;
};

export const BRIDGE_UI: Record<BridgeKind, BridgeUi> = {
	cctp: { Options: SwapBridgeOptions, Result: SwapCctpResult },
	across: { Note: AcrossNote, Result: SwapAcrossResult },
};
