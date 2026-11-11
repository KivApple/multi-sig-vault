import { useMemo } from 'react';
import type { Address } from 'viem';
import { AccountIcon } from '@/components/icons/AccountIcon';
import { WalletIcon } from '@/components/icons/WalletIcon';
import { useT } from '@/i18n';
import { shortAddress } from '@/lib/format';
import { resolveKnown, type AddressScope } from '@/lib/known';
import { useAppStore } from '@/store/appStore';

export interface AddressLabelProps {
  address: Address | string;
  scope?: AddressScope;
  /** Icon size; the row is two lines (name + address) when the address is known. */
  size?: number;
  /** Single line: name only for known addresses. */
  compact?: boolean;
  className?: string;
}

/**
 * The one way addresses are shown: wallet/account icon and name when the app knows the address,
 * dimmed short address otherwise.
 */
export const AddressLabel: React.FC<AddressLabelProps> = ({ address, scope, size = 28, compact, className }) => {
  const t = useT();
  const signers = useAppStore((s) => s.signers);
  const accounts = useAppStore((s) => s.accounts);
  const known = useMemo(() => resolveKnown(address, signers, accounts, scope), [address, signers, accounts, scope]);

  if (!known) {
    return (
      <span className={`mono text-base-content/50 inline-flex items-center ${className ?? ''}`} title={address}>
        {shortAddress(address)}
      </span>
    );
  }
  const name = known.account ? known.account.name?.trim() || t('accounts.unnamed') : known.signer?.name;
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className ?? ''}`} title={address}>
      {known.account ? (
        <AccountIcon kind={known.account.kind} env={known.account.env} chainId={known.account.chainId} size={size} />
      ) : (
        known.signer && <WalletIcon kind={known.signer.wallet} size={size} />
      )}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium">{name}</span>
        {!compact && <span className="mono text-base-content/60 text-xs">{shortAddress(address)}</span>}
      </span>
    </span>
  );
};
