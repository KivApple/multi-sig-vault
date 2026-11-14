import { crossLegOf, type SwapParams } from "@/lib/evm/swapBuild";
import type { OpResultProps } from "@/lib/ops/types";
import { BRIDGE_UI } from "./bridgeUi";

/** Sent card of a cross-chain transfer: its progress, as the bridge that carries it reports it. */
export const SwapResult: React.FC<OpResultProps> = (props) => {
	const kind = crossLegOf(props.op.params as unknown as SwapParams);
	const Result = kind && BRIDGE_UI[kind].Result;
	return Result ? <Result {...props} /> : null;
};
