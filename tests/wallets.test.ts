import {
	concat,
	hashTypedData,
	keccak256,
	parseEther,
	parseGwei,
	parseTransaction,
	serializeTransaction,
	type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { WalletError } from "@/lib/errors";
import type { Signer } from "@/types/domain";

vi.mock("@/lib/rpc", () => ({ getPublicClient: vi.fn(), getBroadcastClient: vi.fn() }));

import { signAndVerify } from "@/lib/wallets";
import { assembleSigned, type PreparedTx } from "@/lib/wallets/evmTx";
import { mapLedgerError } from "@/lib/wallets/ledger";
import { mapMetaMaskError, pickInjected, TxOutcomeUnknownError } from "@/lib/wallets/metamask";
import {
	bip44Path,
	LEDGER_SCHEMES,
	ledgerLegacyPath,
	ledgerLivePath,
	resolveScheme,
	stripMasterPrefix,
	TREZOR_SCHEMES,
} from "@/lib/wallets/paths";
import { mapTrezorError } from "@/lib/wallets/trezor";
import {
	domainTypeFor,
	joinSignature,
	normalizeSignature,
	toFullTypedData,
	typedDataHashes,
} from "@/lib/wallets/typedData";
import type { TypedDataPayload, WalletAdapter } from "@/lib/wallets/types";

const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());

const signer: Signer = {
	id: account.address.toLowerCase(),
	address: account.address,
	name: "Test",
	wallet: "ledger",
	path: "m/44'/60'/0'/0/0",
	addedAt: 0,
};

const safeTx: TypedDataPayload = {
	domain: { chainId: 8453, verifyingContract: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762" },
	types: {
		SafeTx: [
			{ name: "to", type: "address" },
			{ name: "value", type: "uint256" },
			{ name: "data", type: "bytes" },
			{ name: "nonce", type: "uint256" },
		],
	},
	primaryType: "SafeTx",
	message: { to: other.address, value: 10n ** 18n, data: "0x", nonce: 7n },
};

const hlAction: TypedDataPayload = {
	domain: {
		name: "HyperliquidSignTransaction",
		version: "1",
		chainId: 42161,
		verifyingContract: "0x0000000000000000000000000000000000000000",
	},
	types: {
		"HyperliquidTransaction:UsdSend": [
			{ name: "hyperliquidChain", type: "string" },
			{ name: "destination", type: "string" },
			{ name: "amount", type: "string" },
			{ name: "time", type: "uint64" },
		],
	},
	primaryType: "HyperliquidTransaction:UsdSend",
	message: {
		hyperliquidChain: "Mainnet",
		destination: other.address.toLowerCase(),
		amount: "1.5",
		time: 1700000000000,
	},
};

const sign = (key: typeof account, data: TypedDataPayload): Promise<Hex> => {
	const full = toFullTypedData(data);
	return key.signTypedData({
		domain: full.domain,
		types: full.types,
		primaryType: full.primaryType,
		message: full.message,
	} as Parameters<typeof key.signTypedData>[0]);
};

const adapterReturning = (fn: (data: TypedDataPayload) => Promise<Hex>): WalletAdapter => ({
	kind: "ledger",
	schemes: [],
	listAccounts: () => Promise.resolve([]),
	signTypedData: (_s, data) => fn(data),
	sendTransaction: () => Promise.reject(new Error("unused")),
});

describe("derivation paths", () => {
	it("match the official apps", () => {
		expect(ledgerLivePath(0)).toBe("m/44'/60'/0'/0/0");
		expect(ledgerLivePath(2)).toBe("m/44'/60'/2'/0/0");
		expect(ledgerLegacyPath(3)).toBe("m/44'/60'/0'/3");
		expect(bip44Path(1)).toBe("m/44'/60'/0'/0/1");
	});

	it("default to Ledger Live for Ledger and Trezor Suite (BIP-44) for Trezor", () => {
		expect(LEDGER_SCHEMES[0].path(1)).toBe("m/44'/60'/1'/0/0");
		expect(TREZOR_SCHEMES[0].path(1)).toBe("m/44'/60'/0'/0/1");
		expect(resolveScheme(LEDGER_SCHEMES, "legacy").path(1)).toBe("m/44'/60'/0'/1");
		expect(resolveScheme(TREZOR_SCHEMES, "nope")).toBe(TREZOR_SCHEMES[0]);
		expect(resolveScheme(TREZOR_SCHEMES).id).toBe("bip44");
	});

	it("strips the master prefix for Ledger", () => {
		expect(stripMasterPrefix("m/44'/60'/0'/0/0")).toBe("44'/60'/0'/0/0");
		expect(stripMasterPrefix("44'/60'/0'/0/0")).toBe("44'/60'/0'/0/0");
	});
});

describe("typed data", () => {
	it("derives EIP712Domain from the fields present", () => {
		expect(domainTypeFor(safeTx.domain)).toEqual([
			{ name: "chainId", type: "uint256" },
			{ name: "verifyingContract", type: "address" },
		]);
		expect(domainTypeFor(hlAction.domain).map((f) => f.name)).toEqual([
			"name",
			"version",
			"chainId",
			"verifyingContract",
		]);
		expect(domainTypeFor({ name: "x", salt: `0x${"00".repeat(32)}` }).map((f) => f.name)).toEqual(["name", "salt"]);
	});

	it("builds a JSON-safe v4 document and never duplicates EIP712Domain", () => {
		const full = toFullTypedData({ ...safeTx, types: { EIP712Domain: [], ...safeTx.types } });
		expect(Object.keys(full.types)).toEqual(["EIP712Domain", "SafeTx"]);
		expect(full.types.EIP712Domain).toHaveLength(2);
		expect(full.message.value).toBe("1000000000000000000");
		expect(() => JSON.stringify(full)).not.toThrow();
	});

	it("hashes agree with viem hashTypedData", () => {
		const { domainSeparator, messageHash } = typedDataHashes(safeTx);
		expect(domainSeparator).toMatch(/^0x[0-9a-f]{64}$/);
		const full = toFullTypedData(safeTx);
		const digest = hashTypedData(full as Parameters<typeof hashTypedData>[0]);
		expect(keccak256(concat(["0x1901", domainSeparator, messageHash]))).toBe(digest);
	});
});

describe("signature normalization", () => {
	const r = `0x${"11".repeat(32)}`;
	const s = `0x${"22".repeat(32)}`;

	it("maps v 0/1 to 27/28 and keeps 27/28", () => {
		expect(normalizeSignature(`${r}${s.slice(2)}00`).slice(-2)).toBe("1b");
		expect(normalizeSignature(`${r}${s.slice(2)}01`).slice(-2)).toBe("1c");
		expect(normalizeSignature(`${r}${s.slice(2)}1b`).slice(-2)).toBe("1b");
		expect(normalizeSignature(`${r.slice(2)}${s.slice(2)}1c`).slice(-2)).toBe("1c");
	});

	it("rejects malformed signatures", () => {
		expect(() => normalizeSignature("0x1234")).toThrow();
		expect(() => normalizeSignature(`${r}${s.slice(2)}05`)).toThrow();
	});

	it("joins r, s, v from devices", () => {
		expect(joinSignature("11".repeat(32), "22".repeat(32), 0)).toBe(`${r}${s.slice(2)}1b`);
		expect(joinSignature(r, s, 28)).toBe(`${r}${s.slice(2)}1c`);
		expect(joinSignature("1", "2", 1)).toBe(`0x${"1".padStart(64, "0")}${"2".padStart(64, "0")}1c`);
		// EIP-155 style v
		expect(joinSignature(r, s, 8453 * 2 + 36).slice(-2)).toBe("1c");
	});
});

describe("signAndVerify", () => {
	it("accepts a signature made by the signer (Safe and Hyperliquid payloads)", async () => {
		for (const data of [safeTx, hlAction]) {
			const sig = await signAndVerify(
				adapterReturning((d) => sign(account, d)),
				signer,
				data,
			);
			expect(sig).toBe((await sign(account, data)).toLowerCase());
		}
	});

	it("normalizes v = 0/1 returned by a wallet", async () => {
		const good = await sign(account, safeTx);
		const v = parseInt(good.slice(-2), 16) - 27;
		const raw = `${good.slice(0, -2)}0${v}` as Hex;
		await expect(
			signAndVerify(
				adapterReturning(() => Promise.resolve(raw)),
				signer,
				safeTx,
			),
		).resolves.toBe(good.toLowerCase());
	});

	it("rejects a signature made by another key", async () => {
		const attempt = signAndVerify(
			adapterReturning((d) => sign(other, d)),
			signer,
			safeTx,
		);
		await expect(attempt).rejects.toMatchObject({ code: "wrong-account" });
	});

	it("rejects a valid signature over a different payload", async () => {
		const tampered: TypedDataPayload = { ...safeTx, message: { ...safeTx.message, nonce: 8n } };
		const attempt = signAndVerify(
			adapterReturning(() => sign(account, tampered)),
			signer,
			safeTx,
		);
		await expect(attempt).rejects.toBeInstanceOf(WalletError);
	});

	it("wraps unexpected adapter failures", async () => {
		const attempt = signAndVerify(
			adapterReturning(() => Promise.reject(new Error("boom"))),
			signer,
			safeTx,
		);
		await expect(attempt).rejects.toMatchObject({ code: "unknown" });
	});
});

describe("assembleSigned", () => {
	const base = {
		chainId: 999,
		nonce: 3,
		gas: 120000n,
		to: other.address,
		data: "0xabcdef" as Hex,
		value: parseEther("0.1"),
	};

	it.each([
		["eip1559", { ...base, type: "eip1559", maxFeePerGas: parseGwei("2"), maxPriorityFeePerGas: parseGwei("1") }],
		["legacy", { ...base, type: "legacy", gasPrice: parseGwei("2") }],
	] as [string, PreparedTx][])("recovers the right parity for %s", async (_name, tx) => {
		const signed = await account.signTransaction(tx);
		const parsed = parseTransaction(signed);
		const rebuilt = await assembleSigned(tx, account.address, parsed.r as Hex, parsed.s as Hex);
		expect(rebuilt).toBe(signed);
		expect(serializeTransaction(tx)).not.toBe(rebuilt);
	});

	it("fails when the signature belongs to another address", async () => {
		const tx: PreparedTx = { ...base, type: "eip1559", maxFeePerGas: 1n, maxPriorityFeePerGas: 1n };
		const parsed = parseTransaction(await other.signTransaction(tx));
		await expect(assembleSigned(tx, account.address, parsed.r as Hex, parsed.s as Hex)).rejects.toMatchObject({
			code: "wrong-device",
		});
	});
});

describe("error mapping", () => {
	it("Ledger status codes", () => {
		expect(mapLedgerError({ statusCode: 0x6985 }).code).toBe("rejected");
		expect(mapLedgerError({ statusCode: 0x6a80 }).code).toBe("blind-signing");
		expect(mapLedgerError({ statusCode: 0x5515 }).code).toBe("locked");
		expect(mapLedgerError({ statusCode: 0x6b0c }).code).toBe("locked");
		expect(mapLedgerError({ statusCode: 0x6d00 }).code).toBe("app-closed");
		expect(mapLedgerError({ statusCode: 0x6e00 }).code).toBe("app-closed");
		expect(mapLedgerError({ statusCode: 0x6511 }).code).toBe("app-closed");
		expect(mapLedgerError({ name: "DisconnectedDeviceDuringOperation", message: "x" }).code).toBe("unavailable");
		expect(mapLedgerError({ name: "InvalidStateError", message: "The device is already open." }).code).toBe("busy");
		expect(mapLedgerError(new Error("weird")).code).toBe("unknown");
	});

	it("MetaMask RPC errors", () => {
		expect(mapMetaMaskError({ code: 4001, message: "User rejected the request." }).code).toBe("rejected");
		expect(
			mapMetaMaskError({ code: -32603, message: "MetaMask Tx Signature: User denied transaction signature." }).code,
		).toBe("rejected");
		expect(mapMetaMaskError({ code: -32002, message: "Request already pending" }).code).toBe("busy");
		expect(mapMetaMaskError({ code: 4100, message: "unauthorized" }).code).toBe("wrong-account");
		expect(mapMetaMaskError({ code: 4900, message: "x" }).code).toBe("unavailable");
		expect(mapMetaMaskError({ code: -32000, message: "insufficient funds" }).code).toBe("unknown");
	});

	it("Trezor Connect errors", () => {
		expect(mapTrezorError({ error: "Cancelled", code: "Method_Cancel" }).code).toBe("rejected");
		expect(mapTrezorError({ error: "Popup closed", code: "Method_Interrupted" }).code).toBe("rejected");
		expect(mapTrezorError({ error: "Action cancelled by user", code: "Failure_ActionCancelled" }).code).toBe(
			"rejected",
		);
		expect(mapTrezorError({ error: "Device call in progress", code: "Device_CallInProgress" }).code).toBe("busy");
		expect(mapTrezorError({ error: "Transport is missing", code: "Transport_Missing" }).code).toBe("unavailable");
		expect(mapTrezorError({ error: "Something else" }).code).toBe("unknown");
	});

	it("unknown transaction outcome has its own message key but stays a timeout", () => {
		const e = new TxOutcomeUnknownError();
		expect(e.code).toBe("timeout");
		expect(e.key).toBe("walletError.txUnknown");
		expect(e).toBeInstanceOf(WalletError);
	});
});

describe("pickInjected", () => {
	const request = (): Promise<unknown> => Promise.resolve(null);

	it("accepts genuine MetaMask and rejects impostors", () => {
		const mm = { request, isMetaMask: true };
		expect(pickInjected(mm)).toBe(mm);
		expect(pickInjected({ request, isMetaMask: true, isBraveWallet: true })).toBeUndefined();
		expect(pickInjected({ request, isMetaMask: true, isRabby: true })).toBeUndefined();
		expect(pickInjected({ request })).toBeUndefined();
		expect(pickInjected(undefined)).toBeUndefined();
	});

	it("finds MetaMask inside a multi-provider array", () => {
		const mm = { request, isMetaMask: true };
		const coinbase = { request, isMetaMask: true, isCoinbaseWallet: true };
		expect(pickInjected({ request, isMetaMask: true, isCoinbaseWallet: true, providers: [coinbase, mm] })).toBe(mm);
	});
});
