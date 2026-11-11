import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { CHAIN_KEYS, type ChainKey } from "@/config/chains";
import type { NetworkEnv } from "@/types/domain";

export type UrlPatch = Record<string, string | undefined>;

export interface UrlState {
	params: URLSearchParams;
	/** Updates search params in place (no history entry); `undefined`/empty removes a param. */
	patch: (changes: UrlPatch) => void;
	env: NetworkEnv;
	chain: ChainKey;
}

/** Form state kept in the URL so the page survives a reload and can be opened pre-filled. */
export const useUrlState = (): UrlState => {
	const [params, setParams] = useSearchParams();
	const patch = useCallback(
		(changes: UrlPatch) => {
			setParams(
				(prev) => {
					const next = new URLSearchParams(prev);
					for (const [key, value] of Object.entries(changes)) {
						if (value) next.set(key, value);
						else next.delete(key);
					}
					return next;
				},
				{ replace: true },
			);
		},
		[setParams],
	);
	const env: NetworkEnv = params.get("env") === "testnet" ? "testnet" : "mainnet";
	const chainParam = params.get("chain") as ChainKey | null;
	const chain: ChainKey = chainParam && CHAIN_KEYS.includes(chainParam) ? chainParam : "ethereum";
	return useMemo(() => ({ params, patch, env, chain }), [params, patch, env, chain]);
};
