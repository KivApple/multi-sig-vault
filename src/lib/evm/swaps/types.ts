import type { Address } from "viem";
import type { ChainConfig } from "@/config/chains";
import type { MetaTx } from "@/lib/safe/tx";

/** One exchange on one network, as a provider sees it. */
export interface SwapCtx {
	chain: ChainConfig;
	/** Route endpoints (the wrapped token stands for the native coin). */
	tokenIn: Address;
	tokenOut: Address;
	/** The coin itself is sold / bought, not its wrapped token. */
	nativeIn: boolean;
	nativeOut: boolean;
	amountIn: bigint;
	safe: Address;
	/** Who gets what the exchange returns. */
	recipient: Address;
}

export interface SwapOptions {
	/** Basis points. */
	slippageBps: number;
	/** Pinned pool fee tier of the first hop; `undefined` – the best route. */
	feeTier?: number;
}

/** The resolved exchange. Kept in `SwapResolved.swap`. */
export interface SwapLeg {
	/** Token addresses along the route (wrapped native for the native coin). */
	tokens: Address[];
	/** Pool fee per hop, hundredths of a bip. */
	fees: number[];
	/** Quoted output at preparation time, raw units. */
	quoteOut: string;
	/** Guaranteed minimum output (quote minus slippage), raw units. */
	minOut: string;
	/** Unix seconds. */
	deadline: number;
	/** Token needs its allowance zeroed first (USDT-style approve). */
	resetAllowance: boolean;
	/** Price impact of the trade size, basis points (when it could be estimated). */
	impactBps?: number;
}

/**
 * One way to exchange tokens on a network. To add one: implement this and add it to `SWAPS`
 * (swaps/index.ts). As with bridges, the app must be able to build the transaction itself from the
 * stored leg, and it must stay valid while signatures are collected.
 */
export interface SwapProvider {
	id: string;
	/** It works on this network. */
	available: (chain: ChainConfig) => boolean;
	name: (chain: ChainConfig) => string;
	/** Network part: the route, the quote, the guaranteed minimum, the allowance state. */
	resolve: (ctx: SwapCtx, options: SwapOptions) => Promise<SwapLeg>;
	/** Pure. The calls the Safe makes; throws when the leg contradicts the exchange. */
	build: (ctx: SwapCtx, leg: SwapLeg) => MetaTx[];
}
