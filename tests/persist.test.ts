import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/store/appStore";
import { allEntries, diffState, keepIdentity, readState, type StoredState } from "@/store/persist";
import type { Account, Operation, Signer } from "@/types/domain";

const account = (id: string, name = id): Account =>
	({
		id,
		kind: "hl",
		env: "mainnet",
		address: `0x${"1".repeat(40)}`,
		name,
		hidden: false,
		hideDust: false,
		addedAt: 1,
	}) as Account;
const signer = (id: string): Signer =>
	({ id, address: `0x${"2".repeat(40)}`, name: id, wallet: "ledger", addedAt: 1 }) as Signer;
const op = (id: string, accountId: string): Operation =>
	({ id, accountId, type: "hl.usdSend", status: "draft" }) as unknown as Operation;

const state = (over: Partial<StoredState> = {}): StoredState => ({
	accounts: [account("a"), account("b")],
	signers: [signer("s1")],
	operations: [op("o1", "a")],
	settings: DEFAULT_SETTINGS,
	...over,
});
const store = (entries: [string, unknown][]): Map<string, unknown> => new Map(entries);

describe("stored state", () => {
	it("survives a round trip through its entries, in order", () => {
		const s = state();
		expect(readState(store(allEntries(s)), DEFAULT_SETTINGS)).toEqual({ migrate: false, state: s });
	});

	it("writes only what changed", () => {
		const prev = state();
		const renamed = { ...prev, accounts: [prev.accounts[0], { ...prev.accounts[1], name: "B" }] };
		expect(diffState(prev, renamed)).toEqual({ puts: [["account:b", renamed.accounts[1]]], deletes: [] });

		const reordered = { ...prev, accounts: [prev.accounts[1], prev.accounts[0]] };
		expect(diffState(prev, reordered)).toEqual({ puts: [["accounts", ["b", "a"]]], deletes: [] });

		const removed = { ...prev, accounts: [prev.accounts[1]], operations: [] };
		expect(diffState(prev, removed)).toEqual({
			puts: [
				["accounts", ["b"]],
				["operations", []],
			],
			deletes: ["account:a", "op:o1"],
		});

		const added = { ...prev, signers: [...prev.signers, signer("s2")] };
		expect(diffState(prev, added).puts.map(([k]) => k)).toEqual(["signer:s2", "signers"]);
		expect(diffState(prev, { ...prev, settings: { ...prev.settings, theme: "dark" } }).puts.map(([k]) => k)).toEqual([
			"settings",
		]);
		expect(diffState(prev, { ...prev })).toEqual({ puts: [], deletes: [] });
	});

	it("keeps both entries when two windows add at the same moment", () => {
		// Each window wrote its own entry; the order list is the one written last and misses the other.
		const entries = store([...allEntries(state()), ["account:c", account("c")], ["accounts", ["a", "b"]]]);
		expect(readState(entries, DEFAULT_SETTINGS)?.state.accounts.map((a) => a.id)).toEqual(["a", "b", "c"]);
	});

	it("skips an order id whose entry was deleted elsewhere, and junk entries", () => {
		const entries = store([
			...allEntries(state()),
			["accounts", ["gone", "b", "a"]],
			["account:x", { id: "y" }],
			["account:z", "junk"],
		]);
		expect(readState(entries, DEFAULT_SETTINGS)?.state.accounts.map((a) => a.id)).toEqual(["b", "a"]);
	});

	it("reads the layout of earlier versions once and asks for it to be written out", () => {
		const s = state();
		const loaded = readState(
			store([["app", { version: 1, ...s, settings: { theme: "dark" }, rev: "old" }]]),
			DEFAULT_SETTINGS,
		);
		expect(loaded?.migrate).toBe(true);
		expect(loaded?.state.accounts).toEqual(s.accounts);
		expect(loaded?.state.operations).toEqual(s.operations);
		// Settings added since then get their defaults.
		expect(loaded?.state.settings).toEqual({ ...DEFAULT_SETTINGS, theme: "dark" });
		// After that the new entries win, whatever an old window still writes into the old one.
		const both = store([...allEntries({ ...s, accounts: [account("new")] }), ["app", { version: 1, ...s }]]);
		expect(readState(both, DEFAULT_SETTINGS)?.state.accounts.map((a) => a.id)).toEqual(["new"]);
	});

	it("is nothing when nothing was ever stored", () => {
		expect(readState(store([]), DEFAULT_SETTINGS)).toBeUndefined();
		expect(readState(store([["rev", "x"]]), DEFAULT_SETTINGS)).toBeUndefined();
	});

	it("keeps the objects of unchanged entries when the same data is read again", () => {
		const current = state();
		const again = readState(store(JSON.parse(JSON.stringify(allEntries(current)))), DEFAULT_SETTINGS)
			?.state as StoredState;
		const kept = keepIdentity(current, again);
		expect(kept.accounts).toBe(current.accounts);
		expect(kept.operations).toBe(current.operations);
		expect(kept.settings).toBe(current.settings);

		const changed = keepIdentity(current, {
			...again,
			accounts: [again.accounts[0], { ...again.accounts[1], name: "B" }],
		});
		expect(changed.accounts).not.toBe(current.accounts);
		expect(changed.accounts[0]).toBe(current.accounts[0]);
		expect(changed.accounts[1].name).toBe("B");
		expect(changed.signers).toBe(current.signers);
	});
});
