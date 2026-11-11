import { useMemo } from "react";
import type { TokenInfo } from "@/types/domain";
import { useTokenStore } from "./store";

export { initTokens, updateTokenLists } from "./lists";
export { iconSymbol } from "./symbols";

const EMPTY: TokenInfo[] = [];
const indexes = new WeakMap<TokenInfo[], Map<string, TokenInfo>>();

/** Tokens known on a chain (USDC and the wrapped native token come first). */
export const getTokens = (chainId: number): TokenInfo[] => useTokenStore.getState().lists[chainId] ?? EMPTY;

export const useTokens = (chainId: number | undefined): TokenInfo[] =>
	useTokenStore((s) => (chainId === undefined ? EMPTY : (s.lists[chainId] ?? EMPTY)));

export const findToken = (chainId: number, address: string): TokenInfo | undefined => {
	const list = getTokens(chainId);
	let index = indexes.get(list);
	if (!index) {
		index = new Map(list.map((t) => [t.address.toLowerCase(), t]));
		indexes.set(list, index);
	}
	return index.get(address.toLowerCase());
};

export interface TokenListStatus {
	version: string;
	updatedAt?: number;
	tokenCount: number;
	iconCount: number;
	updating: boolean;
	iconProgress?: { done: number; total: number };
	error?: string;
}

export const useTokenListStatus = (): TokenListStatus => {
	const version = useTokenStore((s) => s.version);
	const updatedAt = useTokenStore((s) => s.updatedAt);
	const lists = useTokenStore((s) => s.lists);
	const iconCount = useTokenStore((s) => s.iconCount);
	const updating = useTokenStore((s) => s.updating);
	const iconProgress = useTokenStore((s) => s.iconProgress);
	const error = useTokenStore((s) => s.error);
	return useMemo(
		() => ({
			version,
			updatedAt,
			tokenCount: Object.values(lists).reduce((n, l) => n + l.length, 0),
			iconCount,
			updating,
			iconProgress,
			error,
		}),
		[version, updatedAt, lists, iconCount, updating, iconProgress, error],
	);
};
