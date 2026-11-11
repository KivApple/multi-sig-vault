import {
	concat,
	decodeFunctionData,
	encodeAbiParameters,
	encodeFunctionData,
	getAddress,
	getContractAddress,
	keccak256,
	pad,
	parseAbi,
	toHex,
	type Address,
	type Hex,
} from "viem";
import { ZERO_ADDRESS } from "@/config/constants";
import { AppError } from "@/lib/errors";
import type { SafeCreation } from "@/types/domain";
import { PROXY_FACTORY_ABI, SAFE_ABI } from "./abis";
import { KNOWN_FACTORIES, KNOWN_SINGLETONS, SAFE_141 } from "./deployments";
import { PROXY_CREATION_CODE } from "./proxyCode";

export interface SafeSetup {
	owners: Address[];
	threshold: number;
	fallbackHandler: Address;
	/** Optional delegatecall executed during setup – only zero or SafeToL2Setup is accepted by this app. */
	to: Address;
	data: Hex;
	paymentToken: Address;
	payment: bigint;
	paymentReceiver: Address;
}

export const SETUP_TO_L2_ABI = parseAbi(["function setupToL2(address l2Singleton)"]);

/**
 * `SafeToL2Setup` contracts and the only L2 singleton each may switch the new Safe to (lowercase).
 * During `setup` the Safe delegatecalls it; on chains other than Ethereum mainnet it replaces the
 * L1 singleton with the L2 one, so the same creation parameters work on every chain.
 */
const SAFE_TO_L2_SETUP: Record<string, string> = {
	"0xbd89a1ce4dde368ffab0ec35506eece0b1ffdc54": "0x29fcb43b46531bca003ddc8fcb67ffe91900c762",
	"0x900c7589200010d6c6ecaae5b06ebe653bc2d82a": "0xedd160febbd92e350d4d398fb636302fccd67c7e",
};

/** CompatibilityFallbackHandler of Safe 1.3.0 (canonical, eip155), 1.4.1 and 1.5.0 (lowercase). */
export const KNOWN_FALLBACK_HANDLERS = new Set([
	"0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4",
	"0x017062a1de2fe6b99be3d9d37841fed19f573804",
	"0xfd0732dc9e303f09fcef3a7388ad10a83459ec99",
	"0x3efcbb83a4a7afcb4f68d501e2c2203a38be77f4",
]);

const setupToL2Data = (l2Singleton: Address): Hex =>
	encodeFunctionData({ abi: SETUP_TO_L2_ABI, functionName: "setupToL2", args: [l2Singleton] });

/**
 * Setup used for Safes created by this app – the same scheme as Safe{Wallet} and the `deadbeef`
 * miner for v1.4.1: no modules, no payment, SafeToL2Setup so the address is reproducible everywhere.
 */
export const encodeSetup = (owners: Address[], threshold: number): Hex =>
	encodeFunctionData({
		abi: SAFE_ABI,
		functionName: "setup",
		args: [
			owners,
			BigInt(threshold),
			SAFE_141.safeToL2Setup,
			setupToL2Data(SAFE_141.singletonL2),
			SAFE_141.fallbackHandler,
			ZERO_ADDRESS,
			0n,
			ZERO_ADDRESS,
		],
	});

export const decodeSetup = (initializer: Hex): SafeSetup => {
	const { functionName, args } = decodeFunctionData({ abi: SAFE_ABI, data: initializer });
	if (functionName !== "setup") throw new Error("Initializer is not a Safe setup call");
	const [owners, threshold, to, data, fallbackHandler, paymentToken, payment, paymentReceiver] = args;
	return {
		owners: owners.map((o) => getAddress(o)),
		threshold: Number(threshold),
		to: getAddress(to),
		data,
		fallbackHandler: getAddress(fallbackHandler),
		paymentToken: getAddress(paymentToken),
		payment,
		paymentReceiver: getAddress(paymentReceiver),
	};
};

/** Default creation parameters: Safe v1.4.1 (L1 singleton + SafeToL2Setup), CompatibilityFallbackHandler. */
export const defaultCreation = (owners: Address[], threshold: number, saltNonce: bigint): SafeCreation => ({
	factory: SAFE_141.proxyFactory,
	singleton: SAFE_141.singleton,
	initializer: encodeSetup(owners, threshold),
	saltNonce: saltNonce.toString(),
});

export interface CheckedCreation {
	setup: SafeSetup;
	/** Singleton the Safe ends up with on L2 chains when SafeToL2Setup is used. */
	l2Singleton?: Address;
	/** No fallback handler: the Safe works, but EIP-1271 signatures and simulations are unavailable. */
	noFallbackHandler: boolean;
}

/**
 * Refuses creation parameters that could give anyone but the listed owners control over the new Safe:
 * unknown factory/singleton, a setup delegatecall other than SafeToL2Setup, payments, odd owner sets.
 * Throws `AppError` with a `createSafe.error.*` key.
 */
export const validateCreation = (c: SafeCreation): CheckedCreation => {
	if (!KNOWN_FACTORIES.has(c.factory.toLowerCase())) {
		throw new AppError("createSafe.error.unknownFactory", { address: c.factory });
	}
	if (!KNOWN_SINGLETONS.has(c.singleton.toLowerCase())) {
		throw new AppError("createSafe.error.unknownSingleton", { address: c.singleton });
	}
	if (!/^\d+$/.test(c.saltNonce) || BigInt(c.saltNonce) >= 1n << 256n) throw new AppError("createSafe.error.badSalt");
	let setup: SafeSetup;
	try {
		setup = decodeSetup(c.initializer);
	} catch {
		throw new AppError("createSafe.error.badInitializer");
	}
	const { owners, threshold } = setup;
	const unique = new Set(owners.map((o) => o.toLowerCase()));
	if (
		owners.length === 0 ||
		unique.size !== owners.length ||
		unique.has(ZERO_ADDRESS) ||
		unique.has("0x0000000000000000000000000000000000000001") ||
		threshold < 1 ||
		threshold > owners.length
	) {
		throw new AppError("createSafe.error.badOwners");
	}
	if (setup.payment !== 0n || setup.paymentToken !== ZERO_ADDRESS || setup.paymentReceiver !== ZERO_ADDRESS) {
		throw new AppError("createSafe.error.payment");
	}
	let l2Singleton: Address | undefined;
	if (setup.to === ZERO_ADDRESS) {
		if (setup.data !== "0x") throw new AppError("createSafe.error.setupCall", { address: setup.to });
	} else {
		const allowedL2 = SAFE_TO_L2_SETUP[setup.to.toLowerCase()];
		if (!allowedL2) throw new AppError("createSafe.error.setupCall", { address: setup.to });
		l2Singleton = getAddress(allowedL2);
		if (setup.data.toLowerCase() !== setupToL2Data(l2Singleton).toLowerCase()) {
			throw new AppError("createSafe.error.setupCall", { address: setup.to });
		}
	}
	const noFallbackHandler = setup.fallbackHandler === ZERO_ADDRESS;
	if (!noFallbackHandler && !KNOWN_FALLBACK_HANDLERS.has(setup.fallbackHandler.toLowerCase())) {
		throw new AppError("createSafe.error.fallbackHandler", { address: setup.fallbackHandler });
	}
	return { setup, l2Singleton, noFallbackHandler };
};

/** Contracts that must exist on the target chain for the creation to produce a working Safe. */
export const creationDependencies = (c: SafeCreation, checked: CheckedCreation): Address[] => {
	const list = [c.factory, c.singleton];
	if (checked.setup.to !== ZERO_ADDRESS) list.push(checked.setup.to);
	if (checked.l2Singleton) list.push(checked.l2Singleton);
	if (!checked.noFallbackHandler) list.push(checked.setup.fallbackHandler);
	return list;
};

export const proxyInitCodeHash = (factory: Address, singleton: Address): Hex | undefined => {
	const code = PROXY_CREATION_CODE[factory.toLowerCase()];
	return code ? keccak256(concat([code, pad(singleton)])) : undefined;
};

/** CREATE2 address of the proxy `createProxyWithNonce` will deploy. */
export const predictSafeAddress = (c: SafeCreation): Address => {
	const initCodeHash = proxyInitCodeHash(c.factory, c.singleton);
	if (!initCodeHash) throw new Error("Unknown proxy factory");
	const salt = keccak256(
		encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [keccak256(c.initializer), BigInt(c.saltNonce)]),
	);
	return getContractAddress({ opcode: "CREATE2", from: c.factory, salt, bytecodeHash: initCodeHash });
};

export const encodeCreateProxy = (c: SafeCreation): Hex =>
	encodeFunctionData({
		abi: PROXY_FACTORY_ABI,
		functionName: "createProxyWithNonce",
		args: [c.singleton, c.initializer, BigInt(c.saltNonce)],
	});

/** Extracts creation parameters from `createProxyWithNonce` calldata (e.g. printed by a vanity miner). */
export const decodeCreateProxy = (data: Hex): Omit<SafeCreation, "factory"> | undefined => {
	try {
		const { functionName, args } = decodeFunctionData({ abi: PROXY_FACTORY_ABI, data });
		if (functionName !== "createProxyWithNonce") return undefined;
		return { singleton: getAddress(args[0]), initializer: args[1], saltNonce: args[2].toString() };
	} catch {
		return undefined;
	}
};

export const CREATE_PROXY_SELECTOR = "1688f0b9";

export const randomSaltNonce = (): bigint => {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	return BigInt(toHex(bytes));
};
