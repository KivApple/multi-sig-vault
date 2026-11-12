import type { Account, Operation, Settings, Signer } from "@/types/domain";

/**
 * How the app state is laid out in storage.
 *
 * Every account, signer and operation is its own entry, and the order of each list is one more entry.
 * A window writes only the entries it changed, so two windows of the app never overwrite each other's
 * work wholesale: at worst the later change to the same entry wins. Windows converge by reading – on a
 * message from the window that wrote, and whenever a window comes back to the user.
 *
 *   settings                 the settings object
 *   accounts | signers | operations     ids in display order
 *   account:<id> | signer:<id> | op:<id>     the entries themselves
 *   rev                      changes with every write; lets a window skip a reload when nothing is new
 *   schema                   2
 *   app                      the whole state as versions before 1.7 stored it; read once, then left alone
 */
export interface StoredState {
	accounts: Account[];
	signers: Signer[];
	operations: Operation[];
	settings: Settings;
}

export const SCHEMA = 2;
export const SCHEMA_KEY = "schema";
export const REV_KEY = "rev";
export const SETTINGS_KEY = "settings";
export const LEGACY_KEY = "app";

type ListName = "accounts" | "signers" | "operations";
const PREFIX: Record<ListName, string> = { accounts: "account:", signers: "signer:", operations: "op:" };
const LISTS = Object.keys(PREFIX) as ListName[];

export interface Changes {
	puts: [string, unknown][];
	deletes: string[];
}

const sameOrder = (a: { id: string }[], b: { id: string }[]): boolean =>
	a.length === b.length && a.every((item, i) => item.id === b[i].id);

/** What has to be written to turn stored `prev` into `next`. Unchanged entries (same object) cost nothing. */
export const diffState = (prev: StoredState, next: StoredState): Changes => {
	const puts: [string, unknown][] = [];
	const deletes: string[] = [];
	for (const list of LISTS) {
		const before = prev[list] as { id: string }[];
		const after = next[list] as { id: string }[];
		if (before === after) continue;
		const old = new Map(before.map((item) => [item.id, item]));
		const kept = new Set<string>();
		for (const item of after) {
			kept.add(item.id);
			if (old.get(item.id) !== item) puts.push([PREFIX[list] + item.id, item]);
		}
		for (const item of before) if (!kept.has(item.id)) deletes.push(PREFIX[list] + item.id);
		if (!sameOrder(before, after)) puts.push([list, after.map((item) => item.id)]);
	}
	if (prev.settings !== next.settings) puts.push([SETTINGS_KEY, next.settings]);
	return { puts, deletes };
};

/** Every entry of a state, for the first write in the new layout. */
export const allEntries = (state: StoredState): [string, unknown][] => [
	...diffState({ accounts: [], signers: [], operations: [], settings: {} as Settings }, state).puts,
	[SCHEMA_KEY, SCHEMA],
];

const isEntity = (v: unknown): v is { id: string } =>
	typeof v === "object" && v !== null && typeof (v as { id?: unknown }).id === "string";

const readList = <T extends { id: string }>(entries: Map<string, unknown>, list: ListName): T[] => {
	const prefix = PREFIX[list];
	const found = new Map<string, T>();
	for (const [key, value] of entries) {
		// The key is the identity: an entry stored under another id is not trusted.
		if (key.startsWith(prefix) && isEntity(value) && value.id === key.slice(prefix.length))
			found.set(value.id, value as T);
	}
	const order = entries.get(list);
	const out: T[] = [];
	if (Array.isArray(order)) {
		for (const id of order) {
			const item = typeof id === "string" ? found.get(id) : undefined;
			if (item) {
				out.push(item);
				found.delete(item.id);
			}
		}
	}
	// An entry missing from the order (two windows added at the same moment) is shown, not lost.
	return [...out, ...found.values()];
};

export interface Loaded {
	state: StoredState;
	/** The state came from the old single-entry layout and has to be written out in the new one. */
	migrate: boolean;
}

/**
 * The state as stored, or `undefined` when nothing has ever been stored.
 * `defaults` fills settings added to the app after the state was saved.
 */
export const readState = (entries: Map<string, unknown>, defaults: Settings): Loaded | undefined => {
	if (entries.get(SCHEMA_KEY) === SCHEMA) {
		const settings = entries.get(SETTINGS_KEY);
		return {
			migrate: false,
			state: {
				accounts: readList<Account>(entries, "accounts"),
				signers: readList<Signer>(entries, "signers"),
				operations: readList<Operation>(entries, "operations"),
				settings: { ...defaults, ...(typeof settings === "object" && settings !== null ? (settings as Settings) : {}) },
			},
		};
	}
	const legacy = entries.get(LEGACY_KEY) as Partial<StoredState> | undefined;
	if (!legacy || typeof legacy !== "object") return undefined;
	const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v.filter(isEntity) as T[]) : []);
	return {
		migrate: true,
		state: {
			accounts: list<Account>(legacy.accounts),
			signers: list<Signer>(legacy.signers),
			operations: list<Operation>(legacy.operations),
			settings: { ...defaults, ...(legacy.settings ?? {}) },
		},
	};
};

/**
 * `next` with every entry that did not change replaced by the object already held in `current`.
 * Reading the same data again then changes nothing on screen, and a real change re-renders only what
 * shows the changed entry.
 */
export const keepIdentity = (current: StoredState, next: StoredState): StoredState => {
	const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);
	const out = { ...next };
	for (const list of LISTS) {
		const old = new Map((current[list] as { id: string }[]).map((item) => [item.id, item]));
		const merged = (next[list] as { id: string }[]).map((item) => {
			const held = old.get(item.id);
			return held && same(held, item) ? held : item;
		});
		const unchanged = merged.length === current[list].length && merged.every((item, i) => item === current[list][i]);
		(out[list] as unknown) = unchanged ? current[list] : merged;
	}
	out.settings = same(current.settings, next.settings) ? current.settings : next.settings;
	return out;
};
