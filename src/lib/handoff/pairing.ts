import { secureGet, secureSet } from "@/lib/secureStore";
import { parseKey, toBase64Url } from "./crypto";

/**
 * Pair keys at rest (see ./crypto.ts). The requesting app keeps the one key it shares with the user's
 * MetaMask browser; the signing page keeps the keys of the app instances it was paired with.
 */
type Bytes = Uint8Array<ArrayBuffer>;

const APP_KEY = "handoff:pair";
const PAGE_KEYS = "handoff:paired";
const MAX_PAIRED = 8;

export const loadAppPairKey = async (): Promise<Bytes | undefined> => {
	const stored = await secureGet(APP_KEY).catch(() => undefined);
	return stored ? parseKey(stored) : undefined;
};

export const saveAppPairKey = (key: Bytes): Promise<void> => secureSet(APP_KEY, toBase64Url(key));

export const loadPagePairKeys = async (): Promise<Bytes[]> => {
	const stored = await secureGet(PAGE_KEYS).catch(() => undefined);
	if (!stored) return [];
	try {
		const list = JSON.parse(stored) as unknown;
		if (!Array.isArray(list)) return [];
		return list.flatMap((item) => {
			const key = typeof item === "string" ? parseKey(item) : undefined;
			return key ? [key] : [];
		});
	} catch {
		return [];
	}
};

/** Remembers an app instance; the most recently paired come first, old ones fall off the end. */
export const addPagePairKey = async (key: Bytes): Promise<void> => {
	const text = toBase64Url(key);
	const others = (await loadPagePairKeys()).map(toBase64Url).filter((k) => k !== text);
	await secureSet(PAGE_KEYS, JSON.stringify([text, ...others].slice(0, MAX_PAIRED)));
};
