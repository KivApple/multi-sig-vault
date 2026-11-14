import { describe, expect, it } from "vitest";
import { flattenItems, groupAccounts } from "@/lib/accountGroups";
import type { Account } from "@/types/domain";

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

const eth = acc("safe", "mainnet", 1, 1);
const hl = acc("hl", "mainnet", 1);
const other = acc("safe", "mainnet", 2, 1);
const base = acc("safe", "mainnet", 1, 8453);
const sepolia = acc("safe", "testnet", 1, 11155111);
const baseSepolia = acc("safe", "testnet", 1, 84532);
const all = [eth, hl, other, base, sepolia, baseSepolia];
const shape = (items: { id: string; accounts: Account[] }[]): string[][] =>
	items.map((item) => item.accounts.map((a) => a.id));

describe("account groups", () => {
	it("leaves every account on its own when grouping is off", () => {
		expect(shape(groupAccounts(all, false))).toEqual(all.map((a) => [a.id]));
	});

	it("joins the Safes of one address per environment, where the first of them is", () => {
		const items = groupAccounts(all, true);
		expect(shape(items)).toEqual([[eth.id, base.id], [hl.id], [other.id], [sepolia.id, baseSepolia.id]]);
		expect(items[0].id).not.toBe(items[3].id);
		// An exchange account at the same address is not a Safe.
		expect(items[1].id).toBe(hl.id);
	});

	it("shows a Safe alone as an ordinary account", () => {
		expect(shape(groupAccounts([eth, sepolia, other], true))).toEqual([[eth.id], [sepolia.id], [other.id]]);
	});

	it("moves a card with all its rows", () => {
		const items = groupAccounts(all, true);
		const order = [items[3].id, items[1].id, items[0].id, items[2].id];
		expect(flattenItems(items, order)).toEqual([sepolia.id, baseSepolia.id, hl.id, eth.id, base.id, other.id]);
	});

	it("reorders rows inside their group only", () => {
		const items = groupAccounts(all, true);
		expect(flattenItems(items, undefined, { groupId: items[0].id, ids: [base.id, eth.id] })).toEqual([
			base.id,
			eth.id,
			hl.id,
			other.id,
			sepolia.id,
			baseSepolia.id,
		]);
	});
});
