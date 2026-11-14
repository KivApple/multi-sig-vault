import type { ChainConfig } from "@/config/chains";
import type { SwapProvider } from "./types";
import { v3Swap } from "./v3";

export type { SwapCtx, SwapLeg, SwapOptions, SwapProvider } from "./types";

/** Every way to exchange tokens the app knows; the first that works on a network is used there. */
export const SWAPS: SwapProvider[] = [v3Swap];

export const swapProviderFor = (chain: ChainConfig): SwapProvider | undefined => SWAPS.find((s) => s.available(chain));
