import { create } from "zustand";
import { idbGet, idbSet } from "@/lib/idb";
import type { Account, Operation, Settings, Signer } from "@/types/domain";

export const DEFAULT_SETTINGS: Settings = {
	theme: "system",
	lang: "system",
	mevProtection: true,
	tokenListAutoUpdate: true,
	verifyUpdates: true,
	clearSigning: true,
	deepLinks: true,
	rpcOverrides: {},
};

interface Persisted {
	version: 1;
	accounts: Account[];
	signers: Signer[];
	operations: Operation[];
	settings: Settings;
}

export interface AppState extends Omit<Persisted, "version"> {
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

const STATE_KEY = "app";
const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("msv-state");

const snapshot = (s: AppState): Persisted => ({
	version: 1,
	accounts: s.accounts,
	signers: s.signers,
	operations: s.operations,
	settings: s.settings,
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let applyingRemote = false;

const flush = (): void => {
	if (saveTimer === undefined) return;
	clearTimeout(saveTimer);
	saveTimer = undefined;
	void idbSet("state", STATE_KEY, snapshot(useAppStore.getState())).then(() => channel?.postMessage("changed"));
};

const load = async (): Promise<void> => {
	const saved = await idbGet<Persisted>("state", STATE_KEY).catch(() => undefined);
	applyingRemote = true;
	useAppStore.setState({
		ready: true,
		...(saved
			? {
					accounts: saved.accounts ?? [],
					signers: saved.signers ?? [],
					operations: saved.operations ?? [],
					settings: { ...DEFAULT_SETTINGS, ...saved.settings },
				}
			: {}),
	});
	applyingRemote = false;
};

/** Loads persisted state and starts saving changes (debounced, flushed when the page is hidden). */
export const initAppStore = async (): Promise<void> => {
	await load();
	useAppStore.subscribe((state, prev) => {
		if (applyingRemote) return;
		if (
			state.accounts === prev.accounts &&
			state.signers === prev.signers &&
			state.operations === prev.operations &&
			state.settings === prev.settings
		) {
			return;
		}
		if (saveTimer !== undefined) clearTimeout(saveTimer);
		saveTimer = setTimeout(flush, 150);
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flush();
	});
	window.addEventListener("pagehide", flush);
	// Another tab saved the state – pick it up so tabs never overwrite each other with stale data.
	channel?.addEventListener("message", () => {
		if (saveTimer === undefined) void load();
	});
	void navigator.storage?.persist?.();
};

export const accountId = (kind: "hl" | "safe", scope: string | number, address: string): string =>
	`${kind}:${scope}:${address.toLowerCase()}`;
