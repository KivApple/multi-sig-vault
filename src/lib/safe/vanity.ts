import { getAddress, isAddress, type Address, type Hex } from "viem";
import { AppError } from "@/lib/errors";
import { sameAddress } from "@/lib/format";
import type { SafeCreation } from "@/types/domain";
import { decodeCreateProxy, predictSafeAddress, validateCreation, type CheckedCreation } from "./deploy";
import { SAFE_141 } from "./deployments";
import { PROXY_CREATION_CODE } from "./proxyCode";

/** Chains the `deadbeef` miner (github.com/nlordell/deadbeef) knows Safe deployments for. */
const DEADBEEF_CHAINS = new Set([
	1, 10, 56, 100, 130, 137, 146, 196, 480, 1101, 5000, 8453, 10200, 42161, 42220, 43114, 57073, 59144, 80094, 81457,
	84532, 534352, 11155111, 1313161554,
]);

/** Whole bytes of hex, at most the full address. */
export const normalizePrefix = (prefix: string): string | undefined => {
	const hex = prefix.trim().replace(/^0x/i, "");
	return /^([0-9a-fA-F]{2}){1,20}$/.test(hex) ? `0x${hex.toLowerCase()}` : undefined;
};

export interface MinerCommandInput {
	owners: Address[];
	threshold: number;
	prefix: string;
	chainId: number;
}

/**
 * Command line that mines a salt nonce for exactly this owner set with the app's default Safe setup.
 * For chains the miner has no built-in addresses for, every contract is passed explicitly.
 */
export const deadbeefCommand = ({ owners, threshold, prefix, chainId }: MinerCommandInput): string => {
	const parts = ["deadbeef", ...owners.map((o) => `--owner ${o}`), `--threshold ${threshold}`, `--prefix ${prefix}`];
	if (DEADBEEF_CHAINS.has(chainId)) {
		parts.push(`--chain ${chainId}`);
	} else {
		parts.push(
			`--proxy-factory ${SAFE_141.proxyFactory}`,
			`--proxy-init-code ${PROXY_CREATION_CODE[SAFE_141.proxyFactory.toLowerCase()]}`,
			`--singleton ${SAFE_141.singleton}`,
			`--l2-singleton ${SAFE_141.singletonL2}`,
			`--safe-to-l2-setup ${SAFE_141.safeToL2Setup}`,
			`--fallback-handler ${SAFE_141.fallbackHandler}`,
		);
	}
	return parts.join(" ");
};

export interface MinerResult {
	creation: SafeCreation;
	checked: CheckedCreation;
	address: Address;
}

const lineValue = (text: string, label: string): string | undefined =>
	new RegExp(`^\\s*${label}\\s*:\\s*(\\S.*?)\\s*$`, "im").exec(text)?.[1];

/** Last 20-byte hex in a string – the factory may be printed as an explorer URL. */
const addressIn = (value: string | undefined): Address | undefined => {
	const hit = value?.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)?.pop();
	return hit && isAddress(hit, { strict: false }) ? getAddress(hit) : undefined;
};

/**
 * Parses the output of a Safe vanity miner: `createProxyWithNonce` calldata anywhere in the text
 * (deadbeef's `calldata:` line or `--quiet` output) or the labelled factory/singleton/initializer/salt lines.
 * The result is validated and its address recomputed; throws `AppError` (`createSafe.error.*`).
 */
export const parseMinerOutput = (text: string): MinerResult => {
	const factory = addressIn(lineValue(text, "factory")) ?? SAFE_141.proxyFactory;
	let creation: SafeCreation | undefined;

	const calldata = /0x1688f0b9[0-9a-fA-F]{128,}/.exec(text)?.[0];
	if (calldata) {
		const decoded = decodeCreateProxy(calldata as Hex);
		if (decoded) creation = { factory, ...decoded };
	}
	if (!creation) {
		const singleton = addressIn(lineValue(text, "singleton"));
		const initializer = /^0x([0-9a-fA-F]{2})+$/.exec(lineValue(text, "initializer") ?? "")?.[0];
		const salt = /^(0x[0-9a-fA-F]{1,64}|\d{1,78})$/.exec(lineValue(text, "salt[ _-]?nonce") ?? "")?.[0];
		if (singleton && initializer && salt) {
			creation = { factory, singleton, initializer: initializer as Hex, saltNonce: BigInt(salt).toString() };
		}
	}
	if (!creation) throw new AppError("createSafe.error.minerOutput");

	const checked = validateCreation(creation);
	const address = predictSafeAddress(creation);
	const claimed = addressIn(lineValue(text, "address"));
	if (claimed && !sameAddress(claimed, address)) {
		throw new AppError("createSafe.error.minerMismatch", { claimed, address });
	}
	return { creation, checked, address };
};
