import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { ZERO_ADDRESS } from "@/config/constants";
import { SAFE_ABI } from "@/lib/safe/abis";
import { extractCreation, parseServiceCreation } from "@/lib/safe/creation";
import {
	decodeCreateProxy,
	decodeSetup,
	defaultCreation,
	encodeCreateProxy,
	predictSafeAddress,
	proxyInitCodeHash,
	validateCreation,
} from "@/lib/safe/deploy";
import { SAFE_141 } from "@/lib/safe/deployments";
import { PROXY_CREATION_CODE } from "@/lib/safe/proxyCode";
import type { SafeCreation } from "@/types/domain";
import { AA_CREATION_TX_INPUT, AA_SAFE } from "./safe-deploy.fixtures";

const OWNERS: Address[] = [
	"0x1111111111111111111111111111111111111111",
	"0x2222222222222222222222222222222222222222",
	"0x3333333333333333333333333333333333333333",
];

const setup = (over: Partial<Record<"to" | "data" | "handler" | "token" | "receiver", string>> & { payment?: bigint; owners?: Address[]; threshold?: number }): Hex =>
	encodeFunctionData({
		abi: SAFE_ABI,
		functionName: "setup",
		args: [
			over.owners ?? OWNERS,
			BigInt(over.threshold ?? 2),
			(over.to ?? ZERO_ADDRESS) as Address,
			(over.data ?? "0x") as Hex,
			(over.handler ?? SAFE_141.fallbackHandler) as Address,
			(over.token ?? ZERO_ADDRESS) as Address,
			over.payment ?? 0n,
			(over.receiver ?? ZERO_ADDRESS) as Address,
		],
	});

const withInit = (initializer: Hex, over: Partial<SafeCreation> = {}): SafeCreation => ({
	factory: SAFE_141.proxyFactory,
	singleton: SAFE_141.singletonL2,
	initializer,
	saltNonce: "7",
	...over,
});

const errorKey = (fn: () => unknown): string => {
	try {
		fn();
	} catch (e) {
		return (e as { key?: string }).key ?? String(e);
	}
	return "ok";
};

describe("Safe address prediction", () => {
	it("matches the known CREATE2 init-code hashes of the 1.4.1 factory", () => {
		expect(proxyInitCodeHash(SAFE_141.proxyFactory, SAFE_141.singleton)).toBe(
			"0x76733d705f71b79841c0ee960a0ca880f779cde7ef446c989e6d23efc0a4adfb",
		);
		expect(proxyInitCodeHash(SAFE_141.proxyFactory, SAFE_141.singletonL2)).toBe(
			"0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee",
		);
		expect(Object.keys(PROXY_CREATION_CODE)).toHaveLength(4);
	});

	it("reproduces a real on-chain Safe from its creation transaction", () => {
		const creation = extractCreation(AA_CREATION_TX_INPUT as Hex, AA_SAFE, Object.keys(PROXY_CREATION_CODE));
		expect(creation).not.toBeNull();
		expect(creation?.factory).toBe(SAFE_141.proxyFactory);
		expect(creation?.singleton).toBe(SAFE_141.singleton);
		expect(predictSafeAddress(creation as SafeCreation)).toBe(AA_SAFE);
		// Its setup installs a 4337 module through a delegatecall – this app must refuse to replicate it blindly.
		expect(errorKey(() => validateCreation(creation as SafeCreation))).toBe("createSafe.error.setupCall");
	});

	it("does not accept creation data for a different Safe", () => {
		expect(extractCreation(AA_CREATION_TX_INPUT as Hex, OWNERS[0], Object.keys(PROXY_CREATION_CODE))).toBeNull();
	});

	it("depends on owners, threshold and salt", () => {
		const a = predictSafeAddress(defaultCreation(OWNERS, 2, 1n));
		expect(predictSafeAddress(defaultCreation(OWNERS, 2, 1n))).toBe(a);
		expect(predictSafeAddress(defaultCreation(OWNERS, 2, 2n))).not.toBe(a);
		expect(predictSafeAddress(defaultCreation(OWNERS, 3, 1n))).not.toBe(a);
		expect(predictSafeAddress(defaultCreation(OWNERS.slice(0, 2), 2, 1n))).not.toBe(a);
	});
});

describe("default creation", () => {
	it("uses the Safe{Wallet} / deadbeef scheme for v1.4.1", () => {
		const c = defaultCreation(OWNERS, 2, 42n);
		expect(c.factory).toBe(SAFE_141.proxyFactory);
		expect(c.singleton).toBe(SAFE_141.singleton);
		const s = decodeSetup(c.initializer);
		expect(s.owners).toEqual(OWNERS);
		expect(s.threshold).toBe(2);
		expect(s.to).toBe(SAFE_141.safeToL2Setup);
		expect(s.data).toBe("0xfe51f64300000000000000000000000029fcb43b46531bca003ddc8fcb67ffe91900c762");
		expect(s.fallbackHandler).toBe(SAFE_141.fallbackHandler);
		const checked = validateCreation(c);
		expect(checked.l2Singleton).toBe(SAFE_141.singletonL2);
		expect(checked.noFallbackHandler).toBe(false);
	});

	it("round-trips through createProxyWithNonce calldata, also with trailing bytes", () => {
		const c = defaultCreation(OWNERS, 2, 123456789n);
		const { factory: _factory, ...rest } = c;
		expect(decodeCreateProxy(encodeCreateProxy(c))).toEqual(rest);
		expect(decodeCreateProxy(`${encodeCreateProxy(c)}${"00".repeat(64)}`)).toEqual(rest);
		expect(decodeCreateProxy("0xdeadbeef")).toBeUndefined();
	});
});

describe("creation validation", () => {
	it("accepts plain setups", () => {
		expect(validateCreation(withInit(setup({}))).setup.owners).toEqual(OWNERS);
		expect(validateCreation(withInit(setup({ handler: ZERO_ADDRESS }))).noFallbackHandler).toBe(true);
		expect(
			validateCreation(
				withInit(setup({ handler: "0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4" }), {
					factory: "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
					singleton: "0x3E5c63644E683549055b9Be8653de26E0B4CD36E",
				}),
			).setup.threshold,
		).toBe(2);
	});

	it.each([
		["unknown factory", withInit(setup({}), { factory: OWNERS[0] }), "createSafe.error.unknownFactory"],
		["unknown singleton", withInit(setup({}), { singleton: OWNERS[0] }), "createSafe.error.unknownSingleton"],
		["not a setup call", withInit("0x12345678"), "createSafe.error.badInitializer"],
		["setup delegatecall", withInit(setup({ to: OWNERS[2], data: "0x1234" })), "createSafe.error.setupCall"],
		["data without target", withInit(setup({ data: "0x1234" })), "createSafe.error.setupCall"],
		[
			"SafeToL2Setup with a foreign singleton",
			withInit(setup({ to: SAFE_141.safeToL2Setup, data: `0xfe51f643${OWNERS[0].slice(2).padStart(64, "0")}` })),
			"createSafe.error.setupCall",
		],
		["payment", withInit(setup({ payment: 1n, receiver: OWNERS[0] })), "createSafe.error.payment"],
		["payment receiver", withInit(setup({ receiver: OWNERS[0] })), "createSafe.error.payment"],
		["unknown fallback handler", withInit(setup({ handler: OWNERS[1] })), "createSafe.error.fallbackHandler"],
		["threshold above owners", withInit(setup({ threshold: 4 })), "createSafe.error.badOwners"],
		["zero threshold", withInit(setup({ threshold: 0 })), "createSafe.error.badOwners"],
		["duplicate owners", withInit(setup({ owners: [OWNERS[0], OWNERS[0]] })), "createSafe.error.badOwners"],
		["bad salt", withInit(setup({}), { saltNonce: "0x10" }), "createSafe.error.badSalt"],
	])("refuses: %s", (_name, creation, key) => {
		expect(errorKey(() => validateCreation(creation))).toBe(key);
	});
});

describe("transaction service response", () => {
	const good = {
		factoryAddress: "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
		masterCopy: "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552",
		setupData: setup({}),
		saltNonce: "0",
	};

	it("parses a complete response", () => {
		expect(parseServiceCreation(good)).toEqual({
			factory: getAddress(good.factoryAddress),
			singleton: getAddress(good.masterCopy),
			initializer: good.setupData,
			saltNonce: "0",
		});
	});

	it.each([
		["null", null],
		["4337 creation without data", { ...good, setupData: "0x", saltNonce: null }],
		["missing salt", { ...good, saltNonce: null }],
		["hex salt", { ...good, saltNonce: "0x1" }],
		["bad factory", { ...good, factoryAddress: "0x123" }],
		["bad setup data", { ...good, setupData: "zz" }],
	])("rejects: %s", (_name, json) => {
		expect(parseServiceCreation(json)).toBeNull();
	});
});
