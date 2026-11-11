import "fake-indexeddb/auto";
import { getTypesForEIP712Domain, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";
import { buildPayload, signerTypedData, verifyOperation, verifySignatures } from "@/lib/ops/engine";
import { planOwnerChanges } from "@/lib/ops/safe/owners";
import { exportOperation, parseImport } from "@/lib/ops/transfer";
import { packTransfer, unpackTransfer } from "@/lib/qr/transfer";
import { accountId, useAppStore } from "@/store/appStore";
import type { Account, Operation } from "@/types/domain";

const keys = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()];
const owners = keys.map((k) => privateKeyToAccount(k).address);
const user = privateKeyToAccount(generatePrivateKey()).address;
const recipient = privateKeyToAccount(generatePrivateKey()).address;

const hlAccount: Account = { id: accountId("hl", "testnet", user), kind: "hl", env: "testnet", address: user, hidden: false, hideDust: false, addedAt: 1 };
const safeAccount: Account = { id: accountId("safe", 8453, user), kind: "safe", env: "mainnet", chainId: 8453, address: user, hidden: false, hideDust: false, addedAt: 1 };

const sign = async (key: Hex, op: Operation, account: Account): Promise<Hex> => {
	const data = signerTypedData(op.payload as never, account);
	return privateKeyToAccount(key).signTypedData({ ...data, types: { EIP712Domain: getTypesForEIP712Domain({ domain: data.domain }), ...data.types } } as never);
};

const makeOp = async (account: Account, type: string, params: Record<string, unknown>, signers: number[]): Promise<Operation> => {
	const op: Operation = { id: crypto.randomUUID(), accountId: account.id, type, params, status: "signing", createdAt: 1, frozenAt: 2, signatures: [], owners, threshold: 2 };
	op.payload = buildPayload(op, account, { multiSig: true, leader: owners[signers[0]], nonce: account.kind === "hl" ? 1_762_900_000_000 : 7 });
	for (const i of signers) op.signatures.push({ signer: owners[i], signature: await sign(keys[i], op, account) });
	return op;
};

beforeEach(() => useAppStore.setState({ accounts: [], operations: [], signers: [] }));

describe("operation integrity", () => {
	it("rebuilds the payload from parameters and detects tampering (Hyperliquid)", async () => {
		const op = await makeOp(hlAccount, "hl.usdSend", { destination: recipient, amount: "12.50" }, [0, 1]);
		expect(() => verifyOperation(op, hlAccount)).not.toThrow();
		await expect(verifySignatures(op, hlAccount)).resolves.toBeUndefined();
		// Shown parameters no longer match what was signed.
		expect(() => verifyOperation({ ...op, params: { ...op.params, amount: "1250" } }, hlAccount)).toThrow();
		expect(() => verifyOperation({ ...op, params: { ...op.params, destination: owners[2] } }, hlAccount)).toThrow();
		// Signed payload swapped under the same parameters.
		const forged = { ...op, payload: { ...op.payload, action: { ...(op.payload as { action: object }).action, amount: "9999" } } } as Operation;
		expect(() => verifyOperation(forged, hlAccount)).toThrow();
	});

	it("rebuilds the payload from parameters and detects tampering (Safe)", async () => {
		const params = { token: "", symbol: "ETH", decimals: 18, recipient, amount: "1.5" };
		const op = await makeOp(safeAccount, "safe.send", params, [0]);
		expect(() => verifyOperation(op, safeAccount)).not.toThrow();
		expect(() => verifyOperation({ ...op, params: { ...params, recipient: owners[1] } }, safeAccount)).toThrow();
		expect(() => verifyOperation({ ...op, params: { ...params, amount: "15" } }, safeAccount)).toThrow();
		// A signature made for another Safe (other chain) does not verify here.
		const other = { ...safeAccount, chainId: 1, id: accountId("safe", 1, user) };
		await expect(verifySignatures({ ...op, accountId: other.id }, other)).rejects.toThrow();
	});

	it("rejects signatures that do not belong to their signer", async () => {
		const op = await makeOp(hlAccount, "hl.usdSend", { destination: recipient, amount: "1" }, [0, 1]);
		const swapped = { ...op, signatures: [op.signatures[0], { signer: owners[2], signature: op.signatures[1].signature }] };
		await expect(verifySignatures(swapped, hlAccount)).rejects.toThrow();
		const duplicated = { ...op, signatures: [op.signatures[0], op.signatures[0]] };
		await expect(verifySignatures(duplicated, hlAccount)).rejects.toThrow();
	});
});

describe("transfer between devices", () => {
	it("round-trips, adds the unknown account and merges signatures", async () => {
		const op = await makeOp(hlAccount, "hl.usdSend", { destination: recipient, amount: "3" }, [0, 1]);
		const text = await exportOperation(op, hlAccount);
		const fresh = await parseImport(text);
		expect(fresh.action).toBe("new");
		expect(fresh.accountIsNew).toBe(true);
		expect(fresh.op.signatures).toHaveLength(2);

		// Device already has the operation with the first signature only.
		useAppStore.setState({ accounts: [hlAccount], operations: [{ ...op, signatures: [op.signatures[0]] }] });
		const merge = await parseImport(text);
		expect(merge.action).toBe("merge");
		expect(merge.newSignatures.map((s) => s.signer)).toEqual([owners[1]]);
		useAppStore.setState({ operations: [op] });
		expect((await parseImport(text)).action).toBe("upToDate");
	});

	it("refuses bundles whose parameters do not match the signed payload", async () => {
		const op = await makeOp(hlAccount, "hl.usdSend", { destination: recipient, amount: "3" }, [0]);
		const bundle = (await unpackTransfer(await exportOperation(op, hlAccount))) as { op: { params: Record<string, unknown>; signatures: { signature: string }[] } };
		bundle.op.params.amount = "3000";
		await expect(parseImport(await packTransfer(bundle))).rejects.toThrow();
		bundle.op.params.amount = "3";
		bundle.op.signatures[0].signature = `0x${"11".repeat(65)}`;
		await expect(parseImport(await packTransfer(bundle))).rejects.toThrow();
		await expect(parseImport("msv1:garbage")).rejects.toThrow();
	});
});

describe("Safe owner changes", () => {
	const [a, b, c] = owners;
	const d = recipient;
	it("plans swap / add / remove / threshold calls against the linked list", () => {
		expect(planOwnerChanges(user, { current: [a, b, c], currentThreshold: 2, owners: [a, b, d], threshold: 2 })).toHaveLength(1); // swapOwner
		expect(planOwnerChanges(user, { current: [a, b], currentThreshold: 2, owners: [a, b, c], threshold: 3 })).toHaveLength(2); // add + changeThreshold
		expect(planOwnerChanges(user, { current: [a, b, c], currentThreshold: 3, owners: [a], threshold: 1 })).toHaveLength(2); // two removals carry the threshold
		expect(planOwnerChanges(user, { current: [a, b, c], currentThreshold: 2, owners: [a, b, c], threshold: 3 })).toHaveLength(1); // changeThreshold only
	});
});
