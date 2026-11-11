import { create } from "zustand";
import type { TokenInfo } from "@/types/domain";
import builtin from "./builtin.json";
import { unpackTokens, type PackedList } from "./sanitize";

export interface TokenState {
	lists: Record<number, TokenInfo[]>;
	version: string;
	/** Time of the last successful download; `undefined` while only the built-in snapshot is used. */
	updatedAt?: number;
	updating: boolean;
	error?: string;
	iconCount: number;
	iconProgress?: { done: number; total: number };
	/** Bumped whenever new icons become available so mounted `TokenIcon`s re-resolve. */
	iconEpoch: number;
}

export const unpackList = (packed: PackedList): Record<number, TokenInfo[]> => {
	const lists: Record<number, TokenInfo[]> = {};
	for (const [chainId, tokens] of Object.entries(packed.chains ?? {})) {
		const id = Number(chainId);
		if (Number.isSafeInteger(id)) lists[id] = unpackTokens(id, tokens);
	}
	return lists;
};

export const BUILTIN_LIST = builtin as unknown as PackedList;

export const useTokenStore = create<TokenState>()(() => ({
	lists: unpackList(BUILTIN_LIST),
	version: BUILTIN_LIST.version,
	updating: false,
	iconCount: 0,
	iconEpoch: 0,
}));

export const bumpIconEpoch = (): void => useTokenStore.setState((s) => ({ iconEpoch: s.iconEpoch + 1 }));
