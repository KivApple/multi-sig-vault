import { create } from "zustand";
import { idbBatch, idbGetAll } from "@/lib/idb";
import type { Account, Operation, Settings, Signer } from "@/types/domain";
import {
	allEntries,
	diffState,
	keepIdentity,
	readState,
	REV_KEY,
	SCHEMA,
	SCHEMA_KEY,
	type StoredState,
} from "./persist";

export const DEFAULT_SETTINGS: Settings = {
	theme: "system",
	lang: "system",
	mevProtection: true,
	feeSpeed: "fast",
	tokenListAutoUpdate: true,
	verifyUpdates: true,
	clearSigning: true,
	deepLinks: true,
	rpcOverrides: {},
};

export interface AppState extends StoredState {
	/** `false` until the persisted state has been loaded. */
	ready: boolean;
	addAccount: (account: Account) => void;
	updateAccount: (id: string, patch: Partial<Account>) => void;
	removeAccount: (id: string) => void;
	reorderAccounts: (ids: string[]) => void;
	addSigners: (signers: Signer[]) => void;
	updateSigner: (id: string, patch: Partial<Signer>) => void;
	removeSigner: (id: string) => void;
	reorderSigners: (ids: string[]) => void;
	addOperation: (op: Operation) => void;
	updateOperation: (id: string, patch: Partial<Operation> | ((op: Operation) => Partial<Operation>)) => void;
	removeOperation: (id: string) => void;
	updateSettings: (patch: Partial<Settings>) => void;
}

const reorder = <T extends { id: string }>(items: T[], ids: string[]): T[] => {
	const byId = new Map(items.map((i) => [i.id, i]));
	const ordered = ids.map((id) => byId.get(id)).filter((i): i is T => !!i);
	const rest = items.filter((i) => !ids.includes(i.id));
	return [...ordered, ...rest];
};

export const useAppStore = create<AppState>()((set) => ({
	ready: false,
	accounts: [],
	signers: [],
	operations: [],
	settings: DEFAULT_SETTINGS,
	addAccount: (account) =>
		set((s) => (s.accounts.some((a) => a.id === account.id) ? s : { accounts: [...s.accounts, account] })),
	updateAccount: (id, patch) =>
		set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
	removeAccount: (id) =>
		set((s) => ({
			accounts: s.accounts.filter((a) => a.id !== id),
			operations: s.operations.filter((o) => o.accountId !== id),
		})),
	reorderAccounts: (ids) => set((s) => ({ accounts: reorder(s.accounts, ids) })),
	addSigners: (signers) =>
		set((s) => ({
			signers: [...s.signers, ...signers.filter((n) => !s.signers.some((e) => e.id === n.id))],
		})),
	updateSigner: (id, patch) => set((s) => ({ signers: s.signers.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
	removeSigner: (id) => set((s) => ({ signers: s.signers.filter((x) => x.id !== id) })),
	reorderSigners: (ids) => set((s) => ({ signers: reorder(s.signers, ids) })),
	addOperation: (op) => set((s) => ({ operations: [...s.operations, op] })),
	updateOperation: (id, patch) =>
		set((s) => ({
			operations: s.operations.map((o) =>
				o.id === id ? { ...o, ...(typeof patch === "function" ? patch(o) : patch) } : o,
			),
		})),
	removeOperation: (id) => set((s) => ({ operations: s.operations.filter((o) => o.id !== id) })),
	updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
}));

const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("msv-state");

const stored = (s: AppState): StoredState => ({
	accounts: s.accounts,
	signers: s.signers,
	operations: s.operations,
	settings: s.settings,
});

/** Revision of the stored state this window last wrote or read (see persist.ts). */
let seenRev: string | undefined;
/** Changes made here and not written yet: key → value, or `DELETE`. */
const DELETE = Symbol("delete");
const unsaved = new Map<string, unknown>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | undefined;
/** Another window wrote while this one had unsaved changes: read as soon as they are stored. */
let reloadWanted = false;
let applyingRemote = false;

const newRev = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const flush = (): void => {
	if (saveTimer !== undefined) clearTimeout(saveTimer);
	saveTimer = undefined;
	if (unsaved.size === 0) return;
	const puts: [string, unknown][] = [];
	const deletes: string[] = [];
	for (const [key, value] of unsaved) {
		if (value === DELETE) deletes.push(key);
		else puts.push([key, value]);
	}
	unsaved.clear();
	const rev = newRev();
	seenRev = rev;
	const write = idbBatch("state", [...puts, [REV_KEY, rev], [SCHEMA_KEY, SCHEMA]], deletes)
		.then(() => channel?.postMessage("changed"))
		.catch(() => {
			// Not stored (quota, private mode): keep the changes for the next attempt.
			for (const [key, value] of puts) if (!unsaved.has(key)) unsaved.set(key, value);
			for (const key of deletes) if (!unsaved.has(key)) unsaved.set(key, DELETE);
		})
		.finally(() => {
			if (saving === write) saving = undefined;
			if (reloadWanted && unsaved.size === 0) void load();
		});
	saving = write;
};

const load = async (): Promise<void> => {
	// Changes made here go out first; what other windows wrote is read right after (see flush).
	if (unsaved.size > 0 || saving) {
		reloadWanted = true;
		return;
	}
	reloadWanted = false;
	const first = !useAppStore.getState().ready;
	const entries = await idbGetAll<unknown>("state").catch(() => undefined);
	if (!entries) {
		// Unreadable storage: start empty. Nothing is written until something is changed, and then only that.
		if (first) useAppStore.setState({ ready: true });
		return;
	}
	const rev = entries.get(REV_KEY);
	// Nothing new since this window last looked: leave the state and everything rendered from it alone.
	if (!first && typeof rev === "string" && rev === seenRev) return;
	// Something was changed here while the read was on its way: it is newer, and gets written next.
	if (unsaved.size > 0) {
		reloadWanted = true;
		return;
	}
	const loaded = readState(entries, DEFAULT_SETTINGS);
	if (loaded?.migrate) {
		// Versions before 1.7 kept everything in one entry. Write it out once in the new layout; the old
		// entry stays where it is, untouched.
		const migratedRev = newRev();
		await idbBatch("state", [...allEntries(loaded.state), [REV_KEY, migratedRev]]).catch(() => undefined);
		seenRev = migratedRev;
	} else {
		seenRev = typeof rev === "string" ? rev : undefined;
	}
	applyingRemote = true;
	const current = useAppStore.getState();
	useAppStore.setState({ ready: true, ...(loaded ? keepIdentity(stored(current), loaded.state) : {}) });
	applyingRemote = false;
};

/** Loads the stored state, saves changes (debounced, flushed when the page is hidden) and follows other windows. */
export const initAppStore = async (): Promise<void> => {
	await load();
	useAppStore.subscribe((state, prev) => {
		if (applyingRemote) return;
		const { puts, deletes } = diffState(stored(prev), stored(state));
		if (puts.length === 0 && deletes.length === 0) return;
		for (const [key, value] of puts) unsaved.set(key, value);
		for (const key of deletes) unsaved.set(key, DELETE);
		if (saveTimer !== undefined) clearTimeout(saveTimer);
		saveTimer = setTimeout(flush, 150);
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flush();
	});
	window.addEventListener("pagehide", flush);

	// Another window saved something: read it.
	const refresh = (): void => void load();
	channel?.addEventListener("message", refresh);
	// A window in the background may have been frozen and missed the message: whenever it comes back
	// to the user it reads the stored state before anything can be changed in it.
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") refresh();
	});
	window.addEventListener("pageshow", refresh);
	window.addEventListener("focus", refresh);
	document.addEventListener("resume", refresh);
	void navigator.storage?.persist?.();
};

export const accountId = (kind: "hl" | "safe", scope: string | number, address: string): string =>
	`${kind}:${scope}:${address.toLowerCase()}`;
