import type { AccountData } from '@/hooks/useAccountData';
import type { TFunc } from '@/i18n';
import type { HlAccountData } from '@/lib/hl/account';
import type { SafeAccountData } from '@/lib/safe/account';
import type { Account } from '@/types/domain';

/** "2 of 3" for multi-sig accounts, "single key" for an ordinary Hyperliquid account. */
export const multiSigLabel = (account: Account, data: AccountData | undefined, t: TFunc): string | undefined => {
  if (!data) return undefined;
  if (account.kind === 'safe') {
    const safe = data as SafeAccountData;
    return t('owners.mOfN', { m: safe.threshold, n: safe.owners.length });
  }
  const hl = data as HlAccountData;
  return hl.multiSig
    ? t('owners.mOfN', { m: hl.multiSig.threshold, n: hl.multiSig.authorizedUsers.length })
    : t('accounts.singleKey');
};
