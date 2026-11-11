import { useCallback, useEffect, useRef } from 'react';
import { getCached, onRefreshRequest, refreshCached, useCacheStore } from '@/lib/dataCache';

export interface UseCachedResult<T> {
  data: T | undefined;
  updatedAt: number | undefined;
  error: unknown;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Subscribes to a cached query and keeps it fresh: fetches on mount when stale,
 * then every `interval` ms while the page is visible. `key = null` disables the query.
 */
export const useCached = <T>(
  key: string | null,
  fetcher: () => Promise<T>,
  interval = 30_000,
): UseCachedResult<T> => {
  const entry = useCacheStore((s) => (key ? s.entries[key] : undefined));
  const error = useCacheStore((s) => (key ? s.errors[key] : undefined));
  const loading = useCacheStore((s) => (key ? !!s.loading[key] : false));
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async (): Promise<void> => {
    if (!key) return;
    await refreshCached(key, () => fetcherRef.current()).catch(() => undefined);
  }, [key]);

  useEffect(() => {
    if (!key) return undefined;
    const tick = (): void => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      const hit = getCached(key);
      if (!hit || Date.now() - hit.updatedAt >= interval - 500) void refresh();
    };
    tick();
    const timer = setInterval(tick, Math.min(interval, 10_000));
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', tick);
    const off = onRefreshRequest((prefix) => {
      if (key.startsWith(prefix)) void refresh();
    });
    return () => {
      off();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('online', tick);
    };
  }, [key, interval, refresh]);

  return { data: entry?.data as T | undefined, updatedAt: entry?.updatedAt, error, loading, refresh };
};
