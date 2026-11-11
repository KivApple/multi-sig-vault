import { create } from 'zustand';
import { idbDel, idbGetAll, idbSet } from './idb';

export interface CacheEntry<T = unknown> {
  data: T;
  updatedAt: number;
}

interface CacheState {
  entries: Record<string, CacheEntry>;
  errors: Record<string, unknown>;
  loading: Record<string, boolean>;
}

/**
 * Small persistent query cache: last known data survives reloads and works offline,
 * fresh data replaces it when the network is available.
 */
export const useCacheStore = create<CacheState>()(() => ({ entries: {}, errors: {}, loading: {} }));

const inflight = new Map<string, Promise<unknown>>();

export const initDataCache = async (): Promise<void> => {
  try {
    const all = await idbGetAll<CacheEntry>('cache');
    useCacheStore.setState({ entries: Object.fromEntries(all) });
  } catch {
    // Cache is an optimisation only.
  }
};

export const getCached = <T>(key: string): CacheEntry<T> | undefined =>
  useCacheStore.getState().entries[key] as CacheEntry<T> | undefined;

export const setCached = <T>(key: string, data: T): void => {
  const entry: CacheEntry<T> = { data, updatedAt: Date.now() };
  useCacheStore.setState((s) => ({ entries: { ...s.entries, [key]: entry } }));
  void idbSet('cache', key, entry).catch(() => undefined);
};

export const dropCached = (prefix: string): void => {
  const { entries } = useCacheStore.getState();
  const next: Record<string, CacheEntry> = {};
  for (const [k, v] of Object.entries(entries)) {
    if (k.startsWith(prefix)) void idbDel('cache', k).catch(() => undefined);
    else next[k] = v;
  }
  useCacheStore.setState({ entries: next });
};

/** Runs the fetcher (de-duplicated per key) and stores the result. */
export const refreshCached = <T>(key: string, fetcher: () => Promise<T>): Promise<T> => {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  useCacheStore.setState((s) => ({ loading: { ...s.loading, [key]: true } }));
  const p = fetcher()
    .then((data) => {
      setCached(key, data);
      useCacheStore.setState((s) => {
        const { [key]: _, ...errors } = s.errors;
        return { errors };
      });
      return data;
    })
    .catch((e: unknown) => {
      useCacheStore.setState((s) => ({ errors: { ...s.errors, [key]: e } }));
      throw e;
    })
    .finally(() => {
      inflight.delete(key);
      useCacheStore.setState((s) => ({ loading: { ...s.loading, [key]: false } }));
    });
  inflight.set(key, p);
  return p;
};

/** Cached value if younger than `maxAgeMs`, otherwise fetches. Falls back to stale data when offline. */
export const fetchCached = async <T>(key: string, fetcher: () => Promise<T>, maxAgeMs: number): Promise<T> => {
  const hit = getCached<T>(key);
  if (hit && Date.now() - hit.updatedAt < maxAgeMs) return hit.data;
  try {
    return await refreshCached(key, fetcher);
  } catch (e) {
    if (hit) return hit.data;
    throw e;
  }
};

const REFRESH_EVENT = 'msv-refresh';

/** Asks every mounted query whose key starts with `prefix` to refetch now. */
export const requestRefresh = (prefix: string): void => {
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT, { detail: prefix }));
};

export const onRefreshRequest = (handler: (prefix: string) => void): (() => void) => {
  const listener = (e: Event): void => handler((e as CustomEvent<string>).detail);
  window.addEventListener(REFRESH_EVENT, listener);
  return () => window.removeEventListener(REFRESH_EVENT, listener);
};
