import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha2";
import { base58, bech32, bech32m, createBase58check } from "@scure/base";
import { getAddress, hexToBytes, isAddress, type Address } from "viem";
import { AppError } from "@/lib/errors";
import type { NetworkEnv } from "@/types/domain";

/**
 * Unit (hyperunit.xyz) – the bridge that brings native BTC, ETH, SOL… to Hyperliquid spot.
 * Withdrawing = a spot transfer to a Unit-derived Hyperliquid address tied to the destination
 * address on the native chain. Guardians sign that binding; the app verifies the signatures itself
 * (2 of 3) every time the operation is built, so a forged address cannot be signed or imported.
 */
export const UNIT_API: Record<NetworkEnv, string> = {
	mainnet: "https://api.hyperunit.xyz",
	testnet: "https://api.hyperunit-testnet.xyz",
};

/** Guardian public keys (uncompressed P-256), from Unit's documentation. */
const GUARDIANS: Record<NetworkEnv, Record<string, string>> = {
	mainnet: {
		"unit-node":
			"04dc6f89f921dc816aa69b687be1fcc3cc1d48912629abc2c9964e807422e1047e0435cb5ba0fa53cb9a57a9c610b4e872a0a2caedda78c4f85ebafcca93524061",
		"hl-node":
			"048633ea6ab7e40cdacf37d1340057e84bb9810de0687af78d031e9b07b65ad4ab379180ab55075f5c2ebb96dab30d2c2fab49d5635845327b6a3c27d20ba4755b",
		"field-node":
			"04ae2ab20787f816ea5d13f36c4c4f7e196e29e867086f3ce818abb73077a237f841b33ada5be71b83f4af29f333dedc5411ca4016bd52ab657db2896ef374ce99",
	},
	testnet: {
		"node-1":
			"04bab844e8620c4a1ec304df6284cd6fdffcde79b3330a7bffb1e4cecfee72d02a7c1f3a4415b253dc8d6ca2146db170e1617605cc8a4160f539890b8a24712152",
		"hl-node-testnet":
			"04502d20a0d8d8aaea9395eb46d50ad2d8278c1b3a3bcdc200d531253612be23f5f2e9709bf3a3a50d1447281fa81aca0bf2ac2a6a3cb8a12978381d73c24bb2d9",
		"field-node":
			"04e674a796ff01d6b74f4ee4079640729797538cdb4926ec333ce1bd18414ef7f22c1a142fd76dca120614045273f30338cd07d79bc99872c76151756aaec0f8e8",
	},
};

const GUARDIAN_THRESHOLD = 2;

export type UnitChain = "bitcoin" | "ethereum" | "solana" | "plasma" | "zcash" | "avalanche" | "base";

export interface UnitAsset {
	/** Asset id in the Unit API. */
	asset: string;
	chain: UnitChain;
	/** Symbol on the native chain. */
	symbol: string;
	/** Smallest withdrawal Unit processes (token units). */
	min: number;
	/** Key of the fee estimate for this asset in `/v2/estimate-fees`. */
	feeKey: string;
	/** The fee estimate is in units of this asset (native coins only). */
	feeInAsset: boolean;
}

export const UNIT_CHAIN_NAME: Record<UnitChain, Record<NetworkEnv, string>> = {
	bitcoin: { mainnet: "Bitcoin", testnet: "Bitcoin Signet" },
	ethereum: { mainnet: "Ethereum", testnet: "Sepolia" },
	solana: { mainnet: "Solana", testnet: "Solana Devnet" },
	plasma: { mainnet: "Plasma", testnet: "Plasma Testnet" },
	zcash: { mainnet: "Zcash", testnet: "Zcash Testnet" },
	avalanche: { mainnet: "Avalanche", testnet: "Avalanche Fuji" },
	base: { mainnet: "Base", testnet: "Base Sepolia" },
};

/** Chain ids of Unit chains the app also knows as Safe networks (to offer known recipients). */
export const UNIT_EVM_CHAIN_ID: Partial<Record<UnitChain, Record<NetworkEnv, number>>> = {
	ethereum: { mainnet: 1, testnet: 11155111 },
	base: { mainnet: 8453, testnet: 84532 },
};

const asset = (
	id: string,
	chain: UnitChain,
	symbol: string,
	min: number,
	feeKey: string,
	feeInAsset: boolean,
): UnitAsset => ({
	asset: id,
	chain,
	symbol,
	min,
	feeKey,
	feeInAsset,
});

const BY_ASSET = {
	btc: asset("btc", "bitcoin", "BTC", 0.0003, "bitcoin", true),
	eth: asset("eth", "ethereum", "ETH", 0.007, "ethereum", true),
	sol: asset("sol", "solana", "SOL", 0.12, "solana", true),
	pump: asset("pump", "solana", "PUMP", 5500, "spl", false),
	fart: asset("fart", "solana", "FARTCOIN", 55, "spl", false),
	spxs: asset("spxs", "solana", "SPX", 32, "spl", false),
	bonk: asset("bonk", "solana", "BONK", 1_800_000, "spl", false),
	xpl: asset("xpl", "plasma", "XPL", 60, "plasma", true),
	zec: asset("zec", "zcash", "ZEC", 0.07, "zcash", true),
	avax: asset("avax", "avalanche", "AVAX", 1.5, "avalanche", true),
	virtual: asset("virtual", "base", "VIRTUAL", 25, "base-erc20", false),
};

/** Hyperliquid spot token name → Unit asset, per environment (Unit's token metadata tables). */
const UNIT_TOKENS: Record<NetworkEnv, Record<string, UnitAsset>> = {
	mainnet: {
		UBTC: BY_ASSET.btc,
		UETH: BY_ASSET.eth,
		USOL: BY_ASSET.sol,
		UPUMP: BY_ASSET.pump,
		UFART: BY_ASSET.fart,
		UUUSPX: BY_ASSET.spxs,
		UBONK: BY_ASSET.bonk,
		XPL: BY_ASSET.xpl,
		UZEC: BY_ASSET.zec,
		UAVAX: BY_ASSET.avax,
		UVIRT: BY_ASSET.virtual,
	},
	testnet: {
		UNIT: BY_ASSET.btc,
		UETH: BY_ASSET.eth,
		USOL: BY_ASSET.sol,
		UPUMP: BY_ASSET.pump,
		UFART: BY_ASSET.fart,
		USPXS: BY_ASSET.spxs,
		UBONK: BY_ASSET.bonk,
		UXPL: BY_ASSET.xpl,
		XZEC: BY_ASSET.zec,
		UAVAX: BY_ASSET.avax,
		UUVIRT: BY_ASSET.virtual,
	},
};

export const unitAssetOf = (env: NetworkEnv, coin: string): UnitAsset | undefined => UNIT_TOKENS[env][coin];

const EVM_CHAINS: UnitChain[] = ["ethereum", "plasma", "avalanche", "base"];
export const isEvmUnitChain = (chain: UnitChain): boolean => EVM_CHAINS.includes(chain);

const base58check = createBase58check(sha256);

const tryDecode = <T>(fn: () => T): T | undefined => {
	try {
		return fn();
	} catch {
		return undefined;
	}
};

const isBitcoinAddress = (value: string, env: NetworkEnv): boolean => {
	const hrp = env === "mainnet" ? "bc" : "tb";
	const lower = value.toLowerCase();
	if (lower.startsWith(`${hrp}1`)) {
		if (value !== lower && value !== value.toUpperCase()) return false;
		// Witness v0 uses bech32, v1+ (taproot) bech32m; a wrong checksum fails to decode.
		const v0 = tryDecode(() => bech32.decode(lower as `${string}1${string}`, 90));
		if (v0 && v0.prefix === hrp && v0.words[0] === 0) return true;
		const v1 = tryDecode(() => bech32m.decode(lower as `${string}1${string}`, 90));
		return !!v1 && v1.prefix === hrp && v1.words[0] >= 1 && v1.words[0] <= 16;
	}
	const raw = tryDecode(() => base58check.decode(value));
	const versions = env === "mainnet" ? [0x00, 0x05] : [0x6f, 0xc4];
	return !!raw && raw.length === 21 && versions.includes(raw[0]);
};

const isZcashAddress = (value: string, env: NetworkEnv): boolean => {
	// Transparent addresses only (t1/t3, testnet tm/t2): 2 version bytes + 20-byte hash.
	const raw = tryDecode(() => base58check.decode(value));
	if (!raw || raw.length !== 22) return false;
	const version = (raw[0] << 8) | raw[1];
	return (env === "mainnet" ? [0x1cb8, 0x1cbd] : [0x1d25, 0x1cba]).includes(version);
};

const isSolanaAddress = (value: string): boolean => tryDecode(() => base58.decode(value))?.length === 32;

/** Checks a destination address for the chain, including its checksum. */
export const isUnitDestination = (chain: UnitChain, value: string, env: NetworkEnv): boolean => {
	if (isEvmUnitChain(chain)) return isAddress(value);
	if (chain === "bitcoin") return isBitcoinAddress(value, env);
	if (chain === "solana") return isSolanaAddress(value);
	return isZcashAddress(value, env);
};

/** EVM destinations are sent to Unit checksummed; other chains keep their own encoding. */
export const normalizeUnitDestination = (chain: UnitChain, value: string): string =>
	isEvmUnitChain(chain) && isAddress(value, { strict: false }) ? getAddress(value) : value.trim();

const b64 = (value: string): Uint8Array | undefined =>
	tryDecode(() => Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));

/**
 * `true` when at least two guardians signed "withdrawals of `unit` to `destination` go through the
 * Hyperliquid address `protocolAddress`". Synchronous and offline.
 * Guardians use one of two payload layouts depending on the chain (Bitcoin still uses the older one).
 */
export const verifyUnitAddress = (
	env: NetworkEnv,
	unit: Pick<UnitAsset, "chain" | "asset">,
	destination: string,
	protocolAddress: string,
	signatures: Record<string, string>,
): boolean => {
	let valid = 0;
	for (const [nodeId, publicKey] of Object.entries(GUARDIANS[env])) {
		const signature = typeof signatures[nodeId] === "string" ? b64(signatures[nodeId]) : undefined;
		if (!signature || signature.length !== 64) continue;
		const payloads = [
			// The generated address is a Hyperliquid (EVM-style) account, hence the "ethereum" key type.
			`${nodeId}:user-ethereum-${unit.chain}-${destination}-${protocolAddress}`,
			`${nodeId}:${destination}-${unit.chain}-${unit.asset}-${protocolAddress}-hyperliquid-deposit`,
		];
		const key = hexToBytes(`0x${publicKey}`);
		const ok = payloads.some((payload) =>
			tryDecode(() => p256.verify(signature, sha256(new TextEncoder().encode(payload)), key, { lowS: false })),
		);
		if (ok) valid += 1;
	}
	return valid >= GUARDIAN_THRESHOLD;
};

export interface UnitAddress {
	address: Address;
	signatures: Record<string, string>;
}

/** Asks Unit for the withdrawal address of a destination and verifies the guardians' signatures. */
export const fetchUnitAddress = async (env: NetworkEnv, unit: UnitAsset, destination: string): Promise<UnitAddress> => {
	const url = `${UNIT_API[env]}/gen/hyperliquid/${unit.chain}/${unit.asset}/${encodeURIComponent(destination)}`;
	const res = await fetch(url, { referrerPolicy: "no-referrer" });
	const body = (await res.json().catch(() => undefined)) as
		| { address?: unknown; signatures?: unknown; error?: unknown }
		| undefined;
	if (!res.ok || !body || typeof body.address !== "string") {
		const detail = typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
		throw new AppError("hl.unit.error.api", { detail });
	}
	if (!isAddress(body.address) || typeof body.signatures !== "object" || body.signatures === null) {
		throw new AppError("hl.unit.error.unverified");
	}
	const signatures: Record<string, string> = {};
	for (const [node, sig] of Object.entries(body.signatures as Record<string, unknown>)) {
		if (typeof sig === "string" && sig.length < 200) signatures[node] = sig;
	}
	if (!verifyUnitAddress(env, unit, destination, body.address, signatures)) {
		throw new AppError("hl.unit.error.unverified");
	}
	return { address: getAddress(body.address), signatures };
};

export interface UnitFee {
	/** Estimated network fee, in units of the withdrawn asset; `undefined` when quoted in another coin. */
	fee?: number;
	eta?: string;
}

/** Current withdrawal fee and processing time for the asset's chain. */
export const fetchUnitFee = async (env: NetworkEnv, unit: UnitAsset): Promise<UnitFee> => {
	const res = await fetch(`${UNIT_API[env]}/v2/estimate-fees`, { referrerPolicy: "no-referrer" });
	if (!res.ok) throw new AppError("hl.unit.error.api", { detail: `HTTP ${res.status}` });
	const all = (await res.json()) as Record<string, Record<string, unknown> | undefined>;
	const entry = all[unit.feeKey] ?? {};
	const fee = entry["withdrawal-fee-in-units"];
	const eta = entry.withdrawalEta ?? entry["erc20-withdrawal-eta"];
	return {
		fee: unit.feeInAsset && typeof fee === "number" && Number.isFinite(fee) ? fee : undefined,
		eta: typeof eta === "string" && /^[\dhms ]{1,12}$/.test(eta) ? eta : undefined,
	};
};
