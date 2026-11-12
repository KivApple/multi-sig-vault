import { idbDel, idbGet, idbGetAll, idbSet } from "@/lib/idb";
import type { TokenInfo } from "@/types/domain";
import { isHlIconKey } from "./hlIcons";
import { mirrorLogoUrl } from "./sanitize";
import { bumpIconEpoch, useTokenStore } from "./store";

/**
 * Bulk icon cache. Icons of the WHOLE token list are downloaded in list order, never on demand
 * for a token the user holds, so image hosts learn nothing about the user's portfolio.
 * Blobs are stored in IndexedDB keyed by URL (shared across chains); `index` maps token → URL.
 */
const STATE_KEY = "tokens:icons";
const MAX_ICON_BYTES = 100 * 1024;
const CONCURRENCY = 4;
const TIMEOUT_MS = 12_000;

interface IconState {
	index: Record<string, string>;
	/** Tokens whose icon could not be fetched since the last list update. */
	failed: string[];
}

const blobs = new Map<string, Blob>();
const objectUrls = new Map<string, string>();
let index: Record<string, string> = {};
let failed = new Set<string>();
let running: Promise<void> | undefined;
let rerun = false;

export const tokenKey = (chainId: number, address: string): string => `${chainId}:${address.toLowerCase()}`;

const persist = (): Promise<unknown> =>
	idbSet("meta", STATE_KEY, { index, failed: [...failed] } satisfies IconState).catch(() => undefined);

export const initIcons = async (): Promise<void> => {
	try {
		const [stored, state] = await Promise.all([idbGetAll<Blob>("icons"), idbGet<IconState>("meta", STATE_KEY)]);
		// Exchange coin icons share the store and are managed by hlIcons.ts.
		for (const [url, blob] of stored) if (blob instanceof Blob && !isHlIconKey(url)) blobs.set(url, blob);
		index = state?.index ?? {};
		failed = new Set(state?.failed ?? []);
		useTokenStore.setState({ iconCount: blobs.size });
		bumpIconEpoch();
	} catch {
		// Icons are optional.
	}
};

/** Object URL of the downloaded icon for a token, if there is one. */
export const downloadedIconUrl = (chainId: number, address: string): string | undefined => {
	const url = index[tokenKey(chainId, address)];
	if (!url) return undefined;
	let objectUrl = objectUrls.get(url);
	if (!objectUrl) {
		const blob = blobs.get(url);
		if (!blob) return undefined;
		objectUrl = URL.createObjectURL(blob);
		objectUrls.set(url, objectUrl);
	}
	return objectUrl;
};

/** Called after a list update: failed downloads get one more chance. */
export const resetIconFailures = (): void => {
	failed = new Set();
};

const fetchIcon = async (url: string): Promise<Blob | undefined> => {
	try {
		const res = await fetch(url, {
			mode: "cors",
			credentials: "omit",
			referrerPolicy: "no-referrer",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) return undefined;
		const type = res.headers.get("content-type") ?? "";
		if (!type.startsWith("image/")) return undefined;
		if (Number(res.headers.get("content-length") ?? 0) > MAX_ICON_BYTES) return undefined;
		const blob = await res.blob();
		return blob.size > 0 && blob.size <= MAX_ICON_BYTES ? blob : undefined;
	} catch {
		return undefined;
	}
};

/** Resolves when the app is in the foreground and online – downloads pause otherwise. */
const whenActive = (): Promise<void> =>
	new Promise((resolve) => {
		const check = (): void => {
			if (document.visibilityState === "visible" && navigator.onLine) {
				document.removeEventListener("visibilitychange", check);
				window.removeEventListener("online", check);
				resolve();
			}
		};
		document.addEventListener("visibilitychange", check);
		window.addEventListener("online", check);
		check();
	});

const idle = (): Promise<void> =>
	new Promise((resolve) => {
		if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 2000 });
		else setTimeout(resolve, 200);
	});

const allTokens = (): TokenInfo[] => Object.values(useTokenStore.getState().lists).flat();

const downloadAll = async (): Promise<void> => {
	const tokens = allTokens();
	const pending = tokens.filter((t) => {
		const key = tokenKey(t.chainId, t.address);
		return !index[key] && !failed.has(key) && (t.logoURI || mirrorLogoUrl(t.chainId, t.address));
	});
	if (pending.length > 0) {
		let done = 0;
		let dirty = 0;
		let next = 0;
		useTokenStore.setState({ iconProgress: { done, total: pending.length } });
		const worker = async (): Promise<void> => {
			while (next < pending.length) {
				const token = pending[next++];
				const key = tokenKey(token.chainId, token.address);
				await whenActive();
				const candidates = [token.logoURI, mirrorLogoUrl(token.chainId, token.address)].filter((u): u is string => !!u);
				let found: string | undefined;
				for (const url of candidates) {
					if (!blobs.has(url)) {
						const blob = await fetchIcon(url);
						if (!blob) continue;
						blobs.set(url, blob);
						await idbSet("icons", url, blob).catch(() => undefined);
					}
					found = url;
					break;
				}
				if (found) index[key] = found;
				else if (navigator.onLine) failed.add(key);
				done++;
				if (++dirty >= 25 || done === pending.length) {
					dirty = 0;
					await persist();
					useTokenStore.setState({ iconCount: blobs.size, iconProgress: { done, total: pending.length } });
					bumpIconEpoch();
					await idle();
				}
			}
		};
		await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	}

	// Drop icons of tokens that left the list.
	const live = new Set(tokens.map((t) => tokenKey(t.chainId, t.address)));
	for (const key of Object.keys(index)) if (!live.has(key)) delete index[key];
	const used = new Set(Object.values(index));
	for (const url of [...blobs.keys()]) {
		if (used.has(url)) continue;
		blobs.delete(url);
		const objectUrl = objectUrls.get(url);
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		objectUrls.delete(url);
		await idbDel("icons", url).catch(() => undefined);
	}
	await persist();
	useTokenStore.setState({ iconCount: blobs.size, iconProgress: undefined });
};

/** Starts (or restarts after the current pass) the background download of missing icons. */
export const syncIcons = (): Promise<void> => {
	if (running) {
		rerun = true;
		return running;
	}
	running = idle()
		.then(downloadAll)
		.catch(() => useTokenStore.setState({ iconProgress: undefined }))
		.finally(() => {
			running = undefined;
			if (rerun) {
				rerun = false;
				void syncIcons();
			}
		});
	return running;
};
