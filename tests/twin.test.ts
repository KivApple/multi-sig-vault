import "fake-indexeddb/auto";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectTwin, twinFinding } from "@/lib/safe/creation";
import { creationDependencies, defaultCreation, predictSafeAddress, validateCreation } from "@/lib/safe/deploy";
import type { Account } from "@/types/domain";

// The destination network: the addresses that have code, and what the contract at the Safe's address says of itself.
const code = new Set<string>();
let there: { owners: Address[]; threshold: bigint } | undefined;
vi.mock("@/lib/rpc", () => ({
	getPublicClient: () => ({
		getCode: ({ address }: { address: Address }) => Promise.resolve(code.has(address.toLowerCase()) ? "0x60" : "0x"),
		readContract: ({ functionName }: { functionName: string }) =>
			there
				? Promise.resolve(functionName === "getOwners" ? there.owners : there.threshold)
				: Promise.reject(new Error("execution reverted")),
	}),
}));

const owners: Address[] = ["0x52908400098527886E0F7030069857D2E4169EE7", "0x8617E340B3D01FA5F11F306F4090FD50E238070D"];
const creation = defaultCreation(owners, 2, 7n);
const address = predictSafeAddress(creation);
// HyperEVM testnet: no Safe Transaction Service to ask about a creation the app does not hold.
const account: Account = {
	id: `safe:998:${address.toLowerCase()}`,
	kind: "safe",
	env: "testnet",
	chainId: 998,
	address,
	hidden: false,
	hideDust: false,
	creation,
	addedAt: 1,
};
const deps = creationDependencies(creation, validateCreation(creation));
const deploy = (...addresses: string[]): void => {
	for (const a of addresses) code.add(a.toLowerCase());
};

describe("the Safe's own address on another network", () => {
	beforeEach(() => {
		code.clear();
		there = undefined;
	});

	it("takes a contract there for this Safe only when it has this Safe's signers", async () => {
		deploy(address);
		const current = { owners, threshold: 2 };
		there = { owners: [owners[1], owners[0]], threshold: 2n };
		const same = await inspectTwin(account, 421614, current);
		expect(same).toEqual({ deployed: true, safe: true, sameOwners: true });
		expect(twinFinding(same)).toBeUndefined();
		// The same address, another Safe: created by anyone from the original parameters, or changed since.
		there = { owners: [owners[0]], threshold: 1n };
		const foreign = await inspectTwin(account, 421614, current);
		expect(foreign).toEqual({ deployed: true, safe: true, sameOwners: false });
		expect(twinFinding(foreign)).toBe("foreignOwners");
		// Some other contract altogether.
		there = undefined;
		const other = await inspectTwin(account, 421614, current);
		expect(other).toEqual({ deployed: true, safe: false });
		expect(twinFinding(other)).toBe("notSafe");
	});

	it("names what there is to tell about an address with no Safe", () => {
		expect(twinFinding({ deployed: false, recreatable: true, sameOwners: true })).toBe("missing");
		expect(twinFinding({ deployed: false, recreatable: true })).toBe("missing");
		expect(twinFinding({ deployed: false, recreatable: true, sameOwners: false })).toBe("otherOwners");
		expect(twinFinding({ deployed: false, recreatable: false, sameOwners: false })).toBe("cannotCreate");
	});

	it("can be created there when its creation is known and its contracts are on that network", async () => {
		deploy(...deps);
		expect(await inspectTwin(account, 421614, { owners, threshold: 2 })).toEqual({
			deployed: false,
			recreatable: true,
			sameOwners: true,
		});
		// Without the current signers there is nothing to compare the original ones with.
		expect((await inspectTwin(account, 421614)) as { sameOwners?: boolean }).toMatchObject({ sameOwners: undefined });
	});

	it("says when the signers it would start with are not the current ones", async () => {
		deploy(...deps);
		const twin = async (current: { owners: Address[]; threshold: number }) =>
			(await inspectTwin(account, 421614, current)) as { sameOwners?: boolean };
		expect((await twin({ owners: [owners[1], owners[0]], threshold: 2 })).sameOwners).toBe(true);
		expect((await twin({ owners, threshold: 1 })).sameOwners).toBe(false);
		expect((await twin({ owners: [owners[0]], threshold: 1 })).sameOwners).toBe(false);
		expect(
			(await twin({ owners: [owners[0], "0x1111111111111111111111111111111111111111"], threshold: 2 })).sameOwners,
		).toBe(false);
	});

	it("cannot be created where the Safe contracts are missing, or from a creation the app does not know or accept", async () => {
		// Nothing deployed on the destination.
		expect(await inspectTwin(account, 421614, { owners, threshold: 2 })).toMatchObject({
			deployed: false,
			recreatable: false,
		});
		deploy(...deps);
		expect(await inspectTwin({ ...account, creation: undefined }, 421614)).toEqual({
			deployed: false,
			recreatable: false,
		});
		const foreign = { ...creation, factory: "0x1111111111111111111111111111111111111111" as Address };
		// A creation that does not reproduce the address is not this Safe's creation.
		expect(await inspectTwin({ ...account, creation: foreign }, 421614)).toEqual({
			deployed: false,
			recreatable: false,
		});
	});
});
