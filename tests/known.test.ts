import { describe, expect, it } from "vitest";
import { knownRecipients } from "@/lib/known";
import type { Account, Signer } from "@/types/domain";

const acc = (kind: "hl" | "safe", env: "mainnet" | "testnet", n: number, chainId?: number): Account => ({
	id: `${kind}:${chainId ?? env}:${n}`,
	kind,
	env,
	chainId,
	address: `0x${String(n).padStart(40, "0")}` as never,
	hidden: false,
	hideDust: false,
	addedAt: n,
});
const signer: Signer = {
	id: "s",
	address: `0x${"9".padStart(40, "0")}` as never,
	name: "Ledger 1",
	wallet: "ledger",
	addedAt: 1,
};

describe("known recipients", () => {
	const accounts = [
		acc("hl", "mainnet", 1),
		acc("hl", "mainnet", 2),
		acc("hl", "testnet", 3),
		acc("safe", "mainnet", 4, 42161),
	];

	it("offers the app's other exchange accounts of the same network, then signers", () => {
		const list = knownRecipients([signer], accounts, { hlEnv: "mainnet" }, accounts[0].address);
		expect(list.map((k) => k.account?.id ?? k.signer?.name)).toEqual(["hl:mainnet:2", "Ledger 1"]);
	});

	it("offers Safes of the destination chain only", () => {
		const list = knownRecipients([signer], accounts, { chainId: 42161 });
		expect(list.map((k) => k.account?.id ?? k.signer?.name)).toEqual(["safe:42161:4", "Ledger 1"]);
	});
});
