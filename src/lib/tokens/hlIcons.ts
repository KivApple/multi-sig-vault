import { hlInfo } from "@/lib/hl/api";
import { idbGet, idbGetAll, idbSet } from "@/lib/idb";
import { builtinIconUrl, loadBuiltinPack } from "./builtinPack";
import { bumpIconEpoch } from "./store";
import { iconSymbol } from "./symbols";

/**
 * Icons of Hyperliquid coins that the built-in pack does not have (new listings, large files).
 *
 * The exchange serves its icons without CORS headers, so they come through the app's relay, which
 * re-serves and caches them (relay/server.mjs). As with token lists, the icons of ALL listed coins are
 * downloaded in list order, never those of the coins an account holds: the relay sees the same
 * requests from every user and learns nothing about a portfolio. Without a relay, or with updates
 * turned off, the icons built into the app are all there is.
 */
const STORE_PREFIX = "hl:";
const STATE_KEY = "tokens:hlIcons";
const INTERVAL_MS = 7 * 86_400_000;
const MAX_ICON_BYTES = 100 * 1024;
const CONCURRENCY = 4;

/** Keys in the shared icon store that belong to this module (see icons.ts, which must leave them alone). */
export const isHlIconKey = (key: string): boolean => key.startsWith(STORE_PREFIX);

const blobs = new Map<string, Blob>();
const urls = new Map<string, string>();
let running: Promise<void> | undefined;

export const initHlIcons = async (): Promise<void> => {
	try {
		for (const [key, blob] of await idbGetAll<Blob>("icons")) {
			if (isHlIconKey(key) && blob instanceof Blob) blobs.set(key.slice(STORE_PREFIX.length), blob);
		}
		if (blobs.size > 0) bumpIconEpoch();
	} catch {
		// Icons are optional.
	}
};

/** Object URL of the downloaded icon for an icon symbol (`iconSymbol(coin, true)`), if there is one. */
export const hlIconUrl = (symbol: string): string | undefined => {
	let url = urls.get(symbol);
	if (!url) {
		const blob = blobs.get(symbol);
		if (!blob) return undefined;
		url = URL.createObjectURL(blob);
		urls.set(symbol, url);
	}
	return url;
};

/** Every coin the exchange lists: perps of all dexes, then spot tokens. */
const listCoins = async (): Promise<string[]> => {
	const dexs = await hlInfo<({ name?: string } | null)[]>("mainnet", { type: "perpDexs" });
	const coins: string[] = [];
	for (const dex of dexs) {
		const name = dex?.name ?? "";
		const meta = await hlInfo<{ universe?: { name?: unknown; isDelisted?: boolean }[] }>("mainnet", {
			type: "meta",
			...(name ? { dex: name } : {}),
		}).catch(() => undefined);
		for (const asset of meta?.universe ?? []) {
			if (typeof asset.name === "string" && !asset.isDelisted) coins.push(asset.name);
		}
	}
	const spot = await hlInfo<{ tokens?: { name?: unknown }[] }>("mainnet", { type: "spotMeta" });
	for (const token of spot.tokens ?? []) if (typeof token.name === "string") coins.push(token.name);
	return coins;
};

const download = async (relay: (path: string) => string): Promise<void> => {
	await loadBuiltinPack();
	// One request per missing symbol; the first coin that carries a symbol decides its icon.
	const wanted = new Map<string, string>();
	for (const coin of await listCoins()) {
		if (!/^[A-Za-z0-9:_-]{1,40}$/.test(coin)) continue;
		const symbol = iconSymbol(coin, true);
		if (wanted.has(symbol) || blobs.has(symbol) || builtinIconUrl(symbol)) continue;
		wanted.set(symbol, coin);
	}
	const queue = [...wanted];
	let added = 0;
	const worker = async (): Promise<void> => {
		for (let job = queue.shift(); job; job = queue.shift()) {
			const [symbol, coin] = job;
			if (document.visibilityState !== "visible" || !navigator.onLine) return;
			try {
				const res = await fetch(relay(`coins/${encodeURIComponent(coin)}.svg`), {
					credentials: "omit",
					referrerPolicy: "no-referrer",
					signal: AbortSignal.timeout(15_000),
				});
				// 404 – the exchange has no icon for this coin; it is asked again with the next weekly pass.
				if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/svg")) continue;
				const blob = await res.blob();
				if (blob.size === 0 || blob.size > MAX_ICON_BYTES) continue;
				blobs.set(symbol, blob);
				await idbSet("icons", STORE_PREFIX + symbol, blob).catch(() => undefined);
				if (++added % 20 === 0) bumpIconEpoch();
			} catch {
				// A network hiccup: next pass.
			}
		}
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	if (added > 0) bumpIconEpoch();
	// Only a pass that ran to the end counts; an interrupted one resumes at the next start.
	if (queue.length === 0) await idbSet("meta", STATE_KEY, { checkedAt: Date.now() }).catch(() => undefined);
};

/**
 * Fetches icons of coins listed since the app was built, at most once a week.
 * `relay` builds a relay URL; `available` tells whether this copy of the app has a relay at all.
 */
export const syncHlIcons = (relay: (path: string) => string, available: () => Promise<boolean>): Promise<void> => {
	running ??= (async () => {
		const state = await idbGet<{ checkedAt?: number }>("meta", STATE_KEY).catch(() => undefined);
		if (state?.checkedAt && Date.now() - state.checkedAt < INTERVAL_MS) return;
		if (!navigator.onLine || !(await available())) return;
		await download(relay);
	})()
		.catch(() => undefined)
		.finally(() => {
			running = undefined;
		});
	return running;
};
