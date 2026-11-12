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
		req.onsuccess = () => {
			const db = req.result;
			// A newer version of the app wants to change the stores: step aside instead of blocking it.
			db.onversionchange = () => {
				db.close();
				dbPromise = undefined;
			};
			resolve(db);
		};
		req.onerror = () => {
			dbPromise = undefined;
			reject(req.error ?? new Error("IndexedDB unavailable"));
		};
	});
	return dbPromise;
};

/**
 * How this module uses IndexedDB, and why.
 *
 * Several windows of the app share one database, and a phone may freeze any of them at any moment.
 * A transaction that still needs its page to run stays open while the page is frozen and locks its
 * store for everybody else. So:
 *
 *  - every transaction is one batch of requests issued at once and committed explicitly, so the browser
 *    finishes it without the page; nothing reads a result in order to decide what to request next;
 *  - there are no cursors;
 *  - a read is answered by its own request, a write by the completion of its transaction. (With an
 *    explicit commit Chrome may report the transaction complete a few milliseconds BEFORE it delivers
 *    the result of a large value, so a result is never read from the completion handler.)
 */
const commitNow = (tx: IDBTransaction): void => {
	try {
		tx.commit?.();
	} catch {
		// Already finished or aborted.
	}
};

/** One read request; resolves with its result. */
const read = async <T>(store: StoreName, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
	const db = await openDb();
	return new Promise<T>((resolve, reject) => {
		const tx = db.transaction(store, "readonly");
		const req = fn(tx.objectStore(store));
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
		tx.onabort = () => reject(tx.error);
		commitNow(tx);
	});
};

/** A batch of writes in one transaction; resolves when all of them are stored. */
const write = async (store: StoreName, fn: (s: IDBObjectStore) => void): Promise<void> => {
	const db = await openDb();
	return new Promise<void>((resolve, reject) => {
		const tx = db.transaction(store, "readwrite");
		fn(tx.objectStore(store));
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
		commitNow(tx);
	});
};

export const idbGet = <T>(store: StoreName, key: string): Promise<T | undefined> =>
	read<T | undefined>(store, (s) => s.get(key) as IDBRequest<T | undefined>);

export const idbSet = (store: StoreName, key: string, value: unknown): Promise<void> =>
	write(store, (s) => void s.put(value, key));

export const idbDel = (store: StoreName, key: string): Promise<void> => write(store, (s) => void s.delete(key));

export const idbKeys = (store: StoreName): Promise<string[]> => read(store, (s) => s.getAllKeys()) as Promise<string[]>;

export const idbClear = (store: StoreName): Promise<void> => write(store, (s) => void s.clear());

/** Puts and deletes that become visible to other windows together, or not at all. */
export const idbBatch = (store: StoreName, puts: [string, unknown][], deletes: string[] = []): Promise<void> =>
	write(store, (s) => {
		for (const key of deletes) s.delete(key);
		for (const [key, value] of puts) s.put(value, key);
	});

export const idbSetMany = (store: StoreName, entries: [string, unknown][]): Promise<void> => idbBatch(store, entries);

/** Every entry of a store. */
export const idbGetAll = async <T>(store: StoreName): Promise<Map<string, T>> => {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, "readonly");
		const os = tx.objectStore(store);
		const keys = os.getAllKeys();
		const values = os.getAll() as IDBRequest<T[]>;
		let left = 2;
		const done = (): void => {
			if (--left === 0) resolve(new Map(keys.result.map((key, i) => [String(key), values.result[i]])));
		};
		keys.onsuccess = done;
		values.onsuccess = done;
		keys.onerror = () => reject(keys.error);
		values.onerror = () => reject(values.error);
		tx.onabort = () => reject(tx.error);
		commitNow(tx);
	});
};
