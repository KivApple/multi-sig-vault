import { useCallback, useMemo } from 'react';
import { REFRESH_INTERVAL_MS } from '@/config/constants';
import { fetchHlAccount, fetchHlExtras, type HlAccountData, type HlAccountExtras } from '@/lib/hl/account';
import { accountCacheKey, extrasCacheKey } from '@/lib/ops/engine';
import type { OpEnv } from '@/lib/ops/types';
import { fetchSafeAccount, type SafeAccountData } from '@/lib/safe/account';
import { useAppStore } from '@/store/appStore';
import type { Account } from '@/types/domain';
import { useCached, type UseCachedResult } from './useCached';

export type AccountData = HlAccountData | SafeAccountData;

/** Balances and multi-sig configuration of an account: cached, refreshed every 30 s while mounted. */
export const useAccountData = (account: Account | undefined): UseCachedResult<AccountData> => {
  const fetcher = useCallback((): Promise<AccountData> => {
    if (!account) return Promise.reject(new Error('No account'));
    return account.kind === 'hl'
      ? fetchHlAccount(account.env, account.address)
      : fetchSafeAccount(account.chainId as number, account.address);
  }, [account]);
  return useCached<AccountData>(account ? accountCacheKey(account) : null, fetcher, REFRESH_INTERVAL_MS);
};

export interface UseOpEnvResult {
  env: OpEnv | undefined;
  data: UseCachedResult<AccountData>;
  refresh: () => Promise<void>;
}

/** Account data plus everything operation forms need (agents, sub-accounts, known addresses). */
export const useOpEnv = (account: Account | undefined): UseOpEnvResult => {
  const data = useAccountData(account);
  const accounts = useAppStore((s) => s.accounts);
  const signers = useAppStore((s) => s.signers);
  const extrasFetcher = useCallback((): Promise<HlAccountExtras> => {
    if (!account) return Promise.reject(new Error('No account'));
    return fetchHlExtras(account.env, account.address);
  }, [account]);
  const extras = useCached<HlAccountExtras>(
    account?.kind === 'hl' ? extrasCacheKey(account) : null,
    extrasFetcher,
    2 * REFRESH_INTERVAL_MS,
  );

  const env = useMemo<OpEnv | undefined>(() => {
    if (!account) return undefined;
    return {
      account,
      hl: account.kind === 'hl' ? (data.data as HlAccountData | undefined) : undefined,
      hlExtras: extras.data,
      safe: account.kind === 'safe' ? (data.data as SafeAccountData | undefined) : undefined,
      accounts,
      signers,
    };
  }, [account, data.data, extras.data, accounts, signers]);

  const refreshData = data.refresh;
  const refreshExtras = extras.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([refreshData(), refreshExtras()]);
  }, [refreshData, refreshExtras]);

  return { env, data, refresh };
};
