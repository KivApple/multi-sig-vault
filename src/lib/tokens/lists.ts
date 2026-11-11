import { CHAINS, HL_API } from "@/config/chains";
import { TOKEN_LIST_UPDATE_INTERVAL_MS } from "@/config/constants";
import { errorText } from "@/lib/errors";
import { idbGet, idbSet } from "@/lib/idb";
import { useAppStore } from "@/store/appStore";
import type { TokenInfo } from "@/types/domain";
import { initIcons, resetIconFailures, syncIcons } from "./icons";
import {
	deriveHyperEvmTokens,
	packTokens,
	parseTokenList,
	withEssentials,
	type PackedList,
	type RawToken,
} from "./sanitize";
import { unpackList, useTokenStore } from "./store";

const LIST_KEY = "tokens:list";
const LIST_URLS = ["https://tokens.uniswap.org", "https://ipfs.io/ipns/tokens.uniswap.org"];
const MAX_LIST_BYTES = 8 * 1024 * 1024;
const CHECK_INTERVAL_MS = 6 * 3600 * 1000;

interface StoredList extends PackedList {
	updatedAt: number;
}

const fetchJson = async (url: string, init?: RequestInit): Promise<unknown> => {
	const res = await fetch(url, {
		...init,
		credentials: "omit",
		referrerPolicy: "no-referrer",
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const text = await res.text();
	if (text.length > MAX_LIST_BYTES) throw new Error("Response is too large");
	return JSON.parse(text) as unknown;
};

const fetchUniswapList = async (): Promise<unknown> => {
	let lastError: unknown;
	for (const url of LIST_URLS) {
		try {
			return await fetchJson(url);
		} catch (e) {
			lastError = e;
		}
	}
	throw lastError;
};

const fetchSpotMeta = (env: "mainnet" | "testnet"): Promise<unknown> =>
	fetchJson(`${HL_API[env]}/info`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "spotMeta" }),
	});

let updating: Promise<void> | undefined;

/**
 * Downloads fresh token lists (Uniswap default list + Hyperliquid spot metadata for HyperEVM),
 * stores them and starts the bulk icon download. A source that fails keeps its previous tokens.
 */
export const updateTokenLists = (): Promise<void> => {
	updating ??= (async () => {
		useTokenStore.setState({ updating: true, error: undefined });
		try {
			const current = useTokenStore.getState();
			const evmChains = CHAINS.filter((c) => c.key !== "hyperevm");
			const [uniswap, spotMain, spotTest] = await Promise.allSettled([
				fetchUniswapList().then((json) =>
					parseTokenList(
						json,
						evmChains.map((c) => c.id),
					),
				),
				fetchSpotMeta("mainnet"),
				fetchSpotMeta("testnet"),
			]);
			if (uniswap.status === "rejected" && spotMain.status === "rejected" && spotTest.status === "rejected") {
				throw uniswap.reason;
			}
			const lists: Record<number, TokenInfo[]> = {};
			for (const chain of CHAINS) {
				let base: RawToken[] | undefined;
				if (chain.key === "hyperevm") {
					const spot = chain.env === "mainnet" ? spotMain : spotTest;
					if (spot.status === "fulfilled") {
						try {
							base = deriveHyperEvmTokens(spot.value, chain.id);
						} catch {
							base = undefined;
						}
					}
				} else if (uniswap.status === "fulfilled") {
					base = uniswap.value.byChain.get(chain.id) ?? [];
				}
				lists[chain.id] = withEssentials(base ?? current.lists[chain.id] ?? [], chain);
			}
			const version = uniswap.status === "fulfilled" ? uniswap.value.version : current.version;
			const updatedAt = Date.now();
			const stored: StoredList = {
				version,
				generatedAt: updatedAt,
				updatedAt,
				chains: Object.fromEntries(Object.entries(lists).map(([id, tokens]) => [id, packTokens(tokens)])),
			};
			await idbSet("meta", LIST_KEY, stored);
			useTokenStore.setState({ lists, version, updatedAt });
			resetIconFailures();
			void syncIcons();
		} catch (e) {
			useTokenStore.setState({ error: errorText(e) });
		} finally {
			useTokenStore.setState({ updating: false });
			updating = undefined;
		}
	})();
	return updating;
};

const autoUpdateIfDue = (): void => {
	if (!useAppStore.getState().settings.tokenListAutoUpdate || !navigator.onLine) return;
	if (document.visibilityState !== "visible") return;
	const { updatedAt, updating: busy } = useTokenStore.getState();
	if (!busy && (!updatedAt || Date.now() - updatedAt >= TOKEN_LIST_UPDATE_INTERVAL_MS)) void updateTokenLists();
};

let started = false;

/** Loads the stored list and icons, then keeps the list fresh (weekly, if enabled in settings). */
export const initTokens = async (): Promise<void> => {
	if (started) return;
	started = true;
	try {
		const stored = await idbGet<StoredList>("meta", LIST_KEY);
		if (stored && typeof stored.updatedAt === "number" && stored.chains) {
			const lists = unpackList(stored);
			// Chains added to the app after the list was stored fall back to the built-in snapshot.
			useTokenStore.setState((s) => ({
				lists: { ...s.lists, ...lists },
				version: String(stored.version),
				updatedAt: stored.updatedAt,
			}));
		}
	} catch {
		// Built-in snapshot stays in use.
	}
	await initIcons();
	setTimeout(() => {
		autoUpdateIfDue();
		// Resume an interrupted icon download (no-op when everything is cached).
		if (useTokenStore.getState().updatedAt && !useTokenStore.getState().updating) void syncIcons();
	}, 4000);
	setInterval(autoUpdateIfDue, CHECK_INTERVAL_MS);
	window.addEventListener("online", autoUpdateIfDue);
};
