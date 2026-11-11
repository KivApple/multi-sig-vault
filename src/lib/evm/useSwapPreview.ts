import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { parseAmountIn, resolveSwap, slippageBps, type SwapParams, type SwapResolved } from "./swapBuild";

export interface SwapPreview {
	resolved?: SwapResolved;
	error?: unknown;
	loading: boolean;
}

const DEBOUNCE_MS = 500;

/** Live quote and fees for the form – the same computation `prepare` runs before signing. */
export const useSwapPreview = (params: SwapParams, chainId: number, safe: Address): SwapPreview => {
	const [state, setState] = useState<SwapPreview>({ loading: false });
	// Only fields that change the result – the preview must not refetch on unrelated edits.
	const key = useMemo(
		() =>
			JSON.stringify([
				params.tokenIn,
				params.tokenInDecimals,
				params.amount,
				params.destChainId,
				params.tokenOut,
				params.slippage,
				params.feeTier,
				params.speed,
				params.forward,
				params.forwardLevel,
			]),
		[params],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures every relevant field of `params`
	useEffect(() => {
		const ready =
			!!parseAmountIn(params) && !!slippageBps(params.slippage) && (params.destChainId !== chainId || !!params.tokenOut);
		if (!ready) {
			setState({ loading: false });
			return undefined;
		}
		let cancelled = false;
		setState((s) => ({ ...s, loading: true }));
		const timer = setTimeout(() => {
			resolveSwap(params, chainId, safe)
				.then((resolved) => {
					if (!cancelled) setState({ resolved, loading: false });
				})
				.catch((error: unknown) => {
					if (!cancelled) setState({ error, loading: false });
				});
		}, DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [key, chainId, safe]);

	return state;
};
