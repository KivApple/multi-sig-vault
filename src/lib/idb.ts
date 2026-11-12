/** Minimal promise wrapper over IndexedDB with a few object stores used as key-value maps. */
const DB_NAME = "multi-sig-vault";
const DB_VERSION = 1;

export type StoreName = "state" | "cache" | "icons" | "secure" | "meta";
const STORES: StoreName[] = ["state", "cache", "icons", "secure", "meta"];

let dbPromise: Promise<IDBDatabase> | undefined;

const openDb = (): Promise<IDBDatabase> => {
	dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			for (const name of STORES) {
				if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
	});
	return dbPromise;
};

/**
 * Tells the browser the transaction is complete as soon as its requests are done, without waiting for
 * this page to process their results. A phone may freeze a background tab at any moment; a transaction
 * that still needs the page to run would then stay open and lock its store for every other window of
 * the app – the installed app would wait for it forever.
 */
const commitNow = (tx: IDBTransaction): void => {
	try {
		tx.commit?.();
	} catch {
		// Already finished or aborted.
	}
};

const run = async <T>(
	store: StoreName,
	mode: IDBTransactionMode,
	fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
	const db = await openDb();
	return new Promise<T>((resolve, reject) => {
		const tx = db.transaction(store, mode);
		const req = fn(tx.objectStore(store));
		tx.oncomplete = () => resolve(req.result);
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
		commitNow(tx);
	});
};

export const idbGet = <T>(store: StoreName, key: string): Promise<T | undefined> =>
	run<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);

export const idbSet = (store: StoreName, key: string, value: unknown): Promise<unknown> =>
	run(store, "readwrite", (s) => s.put(value, key));

export const idbDel = (store: StoreName, key: string): Promise<unknown> =>
	run(store, "readwrite", (s) => s.delete(key));

export const idbKeys = (store: StoreName): Promise<string[]> =>
	run(store, "readonly", (s) => s.getAllKeys()) as Promise<string[]>;

export const idbClear = (store: StoreName): Promise<unknown> => run(store, "readwrite", (s) => s.clear());

export const idbSetMany = async (store: StoreName, entries: [string, unknown][]): Promise<void> => {
	const db = await openDb();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(store, "readwrite");
		const os = tx.objectStore(store);
		for (const [k, v] of entries) os.put(v, k);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
		commitNow(tx);
	});
};

export const idbGetAll = async <T>(store: StoreName): Promise<Map<string, T>> => {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		// Two bulk requests instead of a cursor: a cursor needs the page for every row and would keep the
		// transaction open across a freeze.
		const tx = db.transaction(store, "readonly");
		const os = tx.objectStore(store);
		const keys = os.getAllKeys();
		const values = os.getAll() as IDBRequest<T[]>;
		tx.oncomplete = () => resolve(new Map(keys.result.map((key, i) => [String(key), values.result[i]])));
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
		commitNow(tx);
	});
};
