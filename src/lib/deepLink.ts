import { CHAIN_KEYS, type ChainKey } from "@/config/chains";

/**
 * Deep links: `#/link?action=add|create&…` opens the "add account" or "create Safe" form pre-filled.
 * A link never adds or creates anything by itself – it only fills a form the user still has to confirm.
 * Every value is whitelisted or length-limited here and validated again by the form.
 */

/** Marks a form that was filled from a link, so it can warn the user. */
export const LINK_PARAM = "from";
export const LINK_VALUE = "link";

export const ADD_PATH = "/accounts/new";
export const CREATE_PATH = "/accounts/create-safe";

const MAX_OWNERS = 20;
const MAX_NAME = 40;
const MAX_FIELD = 64;

/** Values for the Create Safe draft that do not live in the URL. */
export interface LinkDraft {
	name?: string;
	owners?: string[];
	threshold?: number;
	saltNonce?: string;
	prefix?: string;
}

export interface LinkTarget {
	/** Internal route with the whitelisted query. */
	to: string;
	draft?: LinkDraft;
}

const text = (params: URLSearchParams, key: string, max: number): string | undefined => {
	const value = params.get(key)?.trim().slice(0, max);
	return value || undefined;
};

const network = (params: URLSearchParams, out: URLSearchParams): void => {
	const chain = params.get("chain") as ChainKey | null;
	if (chain && CHAIN_KEYS.includes(chain)) out.set("chain", chain);
	const env = params.get("env");
	if (env === "testnet" || env === "mainnet") out.set("env", env);
};

/** Translates a deep link query into an internal route; `undefined` – not a link this app understands. */
export const parseDeepLink = (params: URLSearchParams): LinkTarget | undefined => {
	const out = new URLSearchParams();
	const action = params.get("action");
	if (action === "add") {
		const kind = params.get("kind");
		if (kind !== "hl" && kind !== "safe") return undefined;
		out.set("kind", kind);
		network(params, out);
		const address = text(params, "address", MAX_FIELD);
		if (address) out.set("address", address);
		const name = text(params, "name", MAX_NAME);
		if (name) out.set("name", name);
		out.set(LINK_PARAM, LINK_VALUE);
		return { to: `${ADD_PATH}?${out}` };
	}
	if (action === "create") {
		network(params, out);
		const mode = params.get("mode");
		if (mode === "copy" || mode === "vanity") out.set("mode", mode);
		out.set(LINK_PARAM, LINK_VALUE);

		const draft: LinkDraft = {};
		const owners = (params.get("owners") ?? "")
			.split(/[\s,]+/)
			.map((o) => o.trim().slice(0, MAX_FIELD))
			.filter(Boolean)
			.slice(0, MAX_OWNERS);
		if (owners.length > 0) {
			draft.owners = owners;
			const threshold = Number(params.get("threshold"));
			draft.threshold =
				Number.isInteger(threshold) && threshold >= 1 && threshold <= owners.length
					? threshold
					: Math.floor(owners.length / 2) + 1;
		}
		const name = text(params, "name", MAX_NAME);
		if (name) draft.name = name;
		const salt = params.get("salt") ?? "";
		if (/^\d{1,78}$/.test(salt)) draft.saltNonce = salt;
		const prefix = text(params, "prefix", 42);
		if (prefix) draft.prefix = prefix;
		return { to: `${CREATE_PATH}?${out}`, draft };
	}
	return undefined;
};

/**
 * The forms keep their state in the URL, so their own addresses also work as links. When the app is
 * opened on such an address from outside, treat it like a deep link: drop the values when links are
 * turned off, mark the form otherwise. Returns the hash to use instead, or `undefined` to keep it.
 */
export const guardEntryHash = (hash: string, enabled: boolean): string | undefined => {
	const [path, query = ""] = hash.replace(/^#/, "").split("?");
	if ((path !== ADD_PATH && path !== CREATE_PATH) || !query) return undefined;
	if (!enabled) return `#${path}`;
	const params = new URLSearchParams(query);
	if (params.get(LINK_PARAM) === LINK_VALUE) return undefined;
	params.set(LINK_PARAM, LINK_VALUE);
	return `#${path}?${params}`;
};

/** Runs once before the first render. A reload or history navigation is not an entry from outside. */
export const guardEntry = (enabled: boolean): void => {
	const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
	if (nav && nav.type !== "navigate") return;
	const next = guardEntryHash(window.location.hash, enabled);
	if (next !== undefined) window.history.replaceState(window.history.state, "", next);
};
