import { getAddress, isAddress, type Address } from "viem";

/**
 * Pure helpers shared by the runtime and by `scripts/tokens/*.mjs` (keep this file free of
 * app imports so Node can load it directly). Everything that comes from the network is untrusted.
 */
export interface RawToken {
	chainId: number;
	address: Address;
	symbol: string;
	name: string;
	decimals: number;
	logoURI?: string;
}

/** `[address, symbol, name, decimals, logoURI?]` – compact form used by the built-in snapshot and storage. */
export type PackedToken = [string, string, string, number, string?];

export interface PackedList {
	version: string;
	generatedAt: number;
	chains: Record<string, PackedToken[]>;
}

export interface ChainEssentials {
	id: number;
	nativeSymbol: string;
	nativeName: string;
	wrappedNative: Address;
	usdc?: Address;
}

export const MAX_TOKENS_PER_CHAIN = 800;
const MAX_SYMBOL = 16;
const MAX_NAME = 48;
const MAX_URL = 300;

/** Removes control/format characters and collapses whitespace. */
export const cleanText = (value: unknown, max: number): string =>
	typeof value === "string"
		? value
				.normalize("NFC")
				.replace(/\s+/g, " ")
				.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/gu, "")
				.trim()
				.slice(0, max)
		: "";

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

/**
 * Makes a logo URL fetchable from the browser: https only, IPFS through a gateway,
 * CoinGecko through its CORS-enabled host and in a small size.
 */
export const normalizeLogoUrl = (value: unknown): string | undefined => {
	if (typeof value !== "string" || value.length > MAX_URL) return undefined;
	let raw = value.trim();
	if (raw.startsWith("ipfs://")) raw = IPFS_GATEWAY + raw.slice(7).replace(/^ipfs\//, "");
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:" || url.username || url.password) return undefined;
	if (url.hostname === "assets.coingecko.com" || url.hostname === "coin-images.coingecko.com") {
		url.hostname = "coin-images.coingecko.com";
		url.pathname = url.pathname.replace(/\/(thumb|large)\//, "/small/");
		url.search = "";
	}
	return url.toString();
};

const MIRROR_FOLDER: Record<number, string> = { 1: "ethereum", 42161: "arbitrum", 8453: "base", 137: "polygon" };

/** Second source for a logo: Trust Wallet assets (CORS-enabled, keyed by checksummed address). */
export const mirrorLogoUrl = (chainId: number, address: string): string | undefined => {
	const folder = MIRROR_FOLDER[chainId];
	return folder && isAddress(address, { strict: false })
		? `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/assets/${getAddress(address)}/logo.png`
		: undefined;
};

export const sanitizeToken = (raw: unknown, chainId?: number): RawToken | undefined => {
	if (typeof raw !== "object" || raw === null) return undefined;
	const r = raw as Record<string, unknown>;
	const id = chainId ?? r.chainId;
	if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return undefined;
	if (typeof r.address !== "string" || !isAddress(r.address, { strict: false })) return undefined;
	if (/^0x0{40}$/i.test(r.address)) return undefined;
	const decimals = r.decimals;
	if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return undefined;
	const symbol = cleanText(r.symbol, MAX_SYMBOL);
	if (!symbol) return undefined;
	const logoURI = normalizeLogoUrl(r.logoURI);
	return {
		chainId: id,
		address: getAddress(r.address),
		symbol,
		name: cleanText(r.name, MAX_NAME) || symbol,
		decimals,
		...(logoURI ? { logoURI } : {}),
	};
};

/** De-duplicates by address (first wins) and caps the list. */
export const dedupeTokens = (tokens: RawToken[]): RawToken[] => {
	const seen = new Set<string>();
	const out: RawToken[] = [];
	for (const t of tokens) {
		const key = t.address.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(t);
		if (out.length >= MAX_TOKENS_PER_CHAIN) break;
	}
	return out;
};

export interface ParsedList {
	version: string;
	byChain: Map<number, RawToken[]>;
}

/** Validates a tokenlists.org document and keeps tokens of the requested chains. */
export const parseTokenList = (json: unknown, chainIds: number[]): ParsedList => {
	if (typeof json !== "object" || json === null) throw new Error("Token list is not an object");
	const doc = json as { tokens?: unknown; version?: { major?: unknown; minor?: unknown; patch?: unknown } };
	if (!Array.isArray(doc.tokens)) throw new Error("Token list has no tokens");
	if (doc.tokens.length > 20_000) throw new Error("Token list is too large");
	const v = doc.version;
	const num = (x: unknown): number => (typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : 0);
	const version = `${num(v?.major)}.${num(v?.minor)}.${num(v?.patch)}`;
	const wanted = new Set(chainIds);
	const byChain = new Map<number, RawToken[]>();
	for (const raw of doc.tokens) {
		const token = sanitizeToken(raw);
		if (!token || !wanted.has(token.chainId)) continue;
		const list = byChain.get(token.chainId) ?? [];
		list.push(token);
		byChain.set(token.chainId, list);
	}
	for (const [id, list] of byChain) byChain.set(id, dedupeTokens(list));
	return { version, byChain };
};

/**
 * HyperEVM tokens are the Hyperliquid spot tokens linked to an EVM contract:
 * decimals = weiDecimals + evm_extra_wei_decimals. USDC is skipped – its `evmContract`
 * is the Core deposit wallet, not the ERC-20 (the real USDC comes from the chain config).
 */
export const deriveHyperEvmTokens = (spotMeta: unknown, chainId: number): RawToken[] => {
	const tokens = (spotMeta as { tokens?: unknown } | null)?.tokens;
	if (!Array.isArray(tokens)) throw new Error("Unexpected spotMeta response");
	const out: RawToken[] = [];
	for (const raw of tokens) {
		if (typeof raw !== "object" || raw === null) continue;
		const t = raw as Record<string, unknown>;
		const evm = t.evmContract as { address?: unknown; evm_extra_wei_decimals?: unknown } | null | undefined;
		if (!evm || t.name === "USDC") continue;
		const extra = evm.evm_extra_wei_decimals;
		if (typeof t.weiDecimals !== "number" || typeof extra !== "number") continue;
		const token = sanitizeToken(
			{ address: evm.address, symbol: t.name, name: t.fullName ?? t.name, decimals: t.weiDecimals + extra },
			chainId,
		);
		if (token) out.push(token);
	}
	return dedupeTokens(out);
};

/** Puts the chain's USDC and wrapped native token first; they must always be present. */
export const withEssentials = (tokens: RawToken[], chain: ChainEssentials): RawToken[] => {
	const find = (address: Address): RawToken | undefined =>
		tokens.find((t) => t.address.toLowerCase() === address.toLowerCase());
	const head: RawToken[] = [];
	if (chain.usdc) {
		head.push({
			...(find(chain.usdc) ?? { name: "USD Coin" }),
			chainId: chain.id,
			address: getAddress(chain.usdc),
			symbol: "USDC",
			decimals: 6,
		} as RawToken);
	}
	head.push(
		find(chain.wrappedNative) ?? {
			chainId: chain.id,
			address: getAddress(chain.wrappedNative),
			symbol: `W${chain.nativeSymbol}`,
			name: `Wrapped ${chain.nativeName}`,
			decimals: 18,
		},
	);
	return dedupeTokens([...head, ...tokens]);
};

export const packTokens = (tokens: RawToken[]): PackedToken[] =>
	tokens.map((t) =>
		t.logoURI ? [t.address, t.symbol, t.name, t.decimals, t.logoURI] : [t.address, t.symbol, t.name, t.decimals],
	);

/** Unpacks (and re-validates) a stored list. */
export const unpackTokens = (chainId: number, packed: unknown): RawToken[] => {
	if (!Array.isArray(packed)) return [];
	const out: RawToken[] = [];
	for (const p of packed) {
		if (!Array.isArray(p)) continue;
		const token = sanitizeToken({ address: p[0], symbol: p[1], name: p[2], decimals: p[3], logoURI: p[4] }, chainId);
		if (token) out.push(token);
	}
	return dedupeTokens(out);
};
