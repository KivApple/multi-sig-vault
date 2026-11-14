import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { findChain } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { sameAddress } from "@/lib/format";
import { getPublicClient } from "@/lib/rpc";
import { SAFE_ABI } from "./abis";
import type { Account, SafeCreation } from "@/types/domain";
import {
	CREATE_PROXY_SELECTOR,
	creationDependencies,
	decodeCreateProxy,
	predictSafeAddress,
	validateCreation,
} from "./deploy";
import { PROXY_CREATION_CODE } from "./proxyCode";

const predictOrUndefined = (c: SafeCreation): Address | undefined => {
	try {
		return predictSafeAddress(c);
	} catch {
		return undefined;
	}
};

/**
 * Validates a Safe Transaction Service `/creation/` response. Returns `null` when the service does not
 * know the parameters (e.g. Safes deployed through ERC-4337 report empty `setupData`).
 */
export const parseServiceCreation = (json: unknown): SafeCreation | null => {
	if (typeof json !== "object" || json === null) return null;
	const { factoryAddress, masterCopy, setupData, saltNonce } = json as Record<string, unknown>;
	if (typeof factoryAddress !== "string" || !isAddress(factoryAddress, { strict: false })) return null;
	if (typeof masterCopy !== "string" || !isAddress(masterCopy, { strict: false })) return null;
	if (typeof setupData !== "string" || !isHex(setupData) || setupData.length < 10) return null;
	if (typeof saltNonce !== "string" || !/^\d{1,78}$/.test(saltNonce)) return null;
	return {
		factory: getAddress(factoryAddress),
		singleton: getAddress(masterCopy),
		initializer: setupData,
		saltNonce,
	};
};

/** Creation parameters from the Safe Transaction Service, accepted only if they reproduce `safe`. */
export const fetchServiceCreation = async (chainId: number, safe: Address): Promise<SafeCreation | null> => {
	const base = findChain(chainId)?.safeTxService;
	if (!base) return null;
	const res = await fetch(`${base}/api/v1/safes/${getAddress(safe)}/creation/`, { referrerPolicy: "no-referrer" });
	if (!res.ok) return null;
	const creation = parseServiceCreation(await res.json().catch(() => null));
	return creation && sameAddress(predictOrUndefined(creation), safe) ? creation : null;
};

/**
 * Finds `createProxyWithNonce` calldata anywhere inside transaction input (direct call, batch,
 * ERC-4337 user operation…) that reproduces `safe` with one of the given factories.
 */
export const extractCreation = (input: Hex, safe: Address, factories: string[]): SafeCreation | null => {
	const hex = input.slice(2).toLowerCase();
	for (let i = hex.indexOf(CREATE_PROXY_SELECTOR); i !== -1; i = hex.indexOf(CREATE_PROXY_SELECTOR, i + 2)) {
		if (i % 2 !== 0) continue;
		const decoded = decodeCreateProxy(`0x${hex.slice(i)}`);
		if (!decoded) continue;
		for (const factory of factories) {
			const candidate: SafeCreation = { factory: getAddress(factory), ...decoded };
			if (sameAddress(predictOrUndefined(candidate), safe)) return candidate;
		}
	}
	return null;
};

/** Creation parameters decoded from the transaction that deployed the Safe. */
export const fetchCreationFromTx = async (chainId: number, txHash: Hex, safe: Address): Promise<SafeCreation> => {
	const client = getPublicClient(chainId);
	const tx = await client.getTransaction({ hash: txHash }).catch(() => undefined);
	if (!tx) throw new AppError("createSafe.error.txNotFound");
	// Factories that emitted events in this transaction first, then every factory we know.
	const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => undefined);
	const known = Object.keys(PROXY_CREATION_CODE);
	const emitted = (receipt?.logs ?? []).map((l) => l.address.toLowerCase()).filter((a) => known.includes(a));
	const creation = extractCreation(tx.input, safe, [...new Set([...emitted, ...known])]);
	if (!creation) throw new AppError("createSafe.error.txNoCreation");
	return creation;
};

/** Stored parameters (Safe created by this app) or the transaction service; `null` – ask for the tx hash. */
export const resolveCreation = async (account: Account): Promise<SafeCreation | null> => {
	if (account.creation && sameAddress(predictOrUndefined(account.creation), account.address)) return account.creation;
	if (account.chainId === undefined) return null;
	return fetchServiceCreation(account.chainId, account.address).catch(() => null);
};

export interface TargetState {
	/** Contracts required by the creation that are not deployed on the chain. */
	missing: Address[];
	/** Code already exists at the predicted address. */
	deployed: boolean;
}

/** What the target chain looks like for this creation: prerequisites and whether the Safe already exists. */
export const inspectTarget = async (
	chainId: number,
	creation: SafeCreation,
	address: Address,
): Promise<TargetState> => {
	const client = getPublicClient(chainId);
	const deps = creationDependencies(creation, validateCreation(creation));
	const codes = await Promise.all([address, ...deps].map((a) => client.getCode({ address: a })));
	const has = (code: Hex | undefined): boolean => !!code && code !== "0x";
	return { deployed: has(codes[0]), missing: deps.filter((_, i) => !has(codes[i + 1])) };
};

/** What stands at a Safe's own address on another network. */
export type TwinState =
	| {
			deployed: true;
			/** The contract there answers as a Safe. */
			safe: boolean;
			/** Its signers and threshold are the ones this Safe has now; `undefined` – could not be compared. */
			sameOwners?: boolean;
	  }
	| {
			deployed: false;
			/** The app can create the Safe there: its creation is known, acceptable, and its contracts are on that network. */
			recreatable: boolean;
			/** The signers and threshold it would start with are the current ones; `undefined` – unknown. */
			sameOwners?: boolean;
	  };

/** What there is to tell the user about it; `undefined` – it is this Safe, with these signers. */
export type TwinFinding = "missing" | "otherOwners" | "cannotCreate" | "foreignOwners" | "notSafe";

export const twinFinding = (twin: TwinState): TwinFinding | undefined => {
	if (twin.deployed) return !twin.safe ? "notSafe" : twin.sameOwners === false ? "foreignOwners" : undefined;
	if (!twin.recreatable) return "cannotCreate";
	return twin.sameOwners === false ? "otherOwners" : "missing";
};

const sameSigners = (
	a: { owners: readonly Address[]; threshold: number },
	b: { owners: readonly Address[]; threshold: number },
): boolean =>
	a.threshold === b.threshold &&
	a.owners.length === b.owners.length &&
	a.owners.every((o) => b.owners.some((c) => sameAddress(c, o)));

/**
 * Looks at the address of `account` on `destChainId`.
 *
 * An address is the same on every network, a Safe is not: each network has its own contract there,
 * with its own signers. A Safe created at that address on another network starts with the signers this
 * one was *created* with, and anyone may create it. So neither "there is a contract" nor "there will be
 * a Safe" means "the people who sign here control the funds there" – the signers are compared.
 */
export const inspectTwin = async (
	account: Account,
	destChainId: number,
	current?: { owners: Address[]; threshold: number },
): Promise<TwinState> => {
	const client = getPublicClient(destChainId);
	const code = await client.getCode({ address: account.address });
	if (code && code !== "0x") {
		try {
			const [owners, threshold] = await Promise.all([
				client.readContract({ address: account.address, abi: SAFE_ABI, functionName: "getOwners" }),
				client.readContract({ address: account.address, abi: SAFE_ABI, functionName: "getThreshold" }),
			]);
			const there = { owners, threshold: Number(threshold) };
			return { deployed: true, safe: true, sameOwners: current ? sameSigners(there, current) : undefined };
		} catch {
			return { deployed: true, safe: false };
		}
	}
	const creation = await resolveCreation(account);
	if (!creation) return { deployed: false, recreatable: false };
	try {
		const { setup } = validateCreation(creation);
		const target = await inspectTarget(destChainId, creation, account.address);
		return {
			deployed: false,
			recreatable: target.missing.length === 0,
			sameOwners: current ? sameSigners(setup, current) : undefined,
		};
	} catch (e) {
		// Parameters the app refuses to create a Safe from are an answer; a network failure is not.
		if (e instanceof AppError) return { deployed: false, recreatable: false };
		throw e;
	}
};
