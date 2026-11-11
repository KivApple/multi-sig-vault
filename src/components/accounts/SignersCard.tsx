import type { Address } from 'viem';
import { AddressLabel } from '@/components/common/AddressLabel';
import { CopyButton } from '@/components/ui/CopyButton';
import { useT } from '@/i18n';
import type { AddressScope } from '@/lib/known';

export interface SignersCardProps {
  /** "2 of 3" / "single key". */
  mode: string;
  owners: Address[];
  scope: AddressScope;
}

/** Current multi-sig mode and the list of signers (known ones by name, unknown ones dimmed). */
export const SignersCard: React.FC<SignersCardProps> = ({ mode, owners, scope }) => {
  const t = useT();
  return (
    <section className="card-surface">
      <header className="flex items-center justify-between px-4 pt-3 pb-1">
        <h2 className="text-base-content/60 text-xs font-semibold tracking-wide uppercase">{t('accounts.signers')}</h2>
        <span className="badge badge-ghost">{mode}</span>
      </header>
      <ul className="px-4 pb-2">
        {owners.map((owner) => (
          <li key={owner} className="flex items-center justify-between gap-2 py-1.5">
            <AddressLabel address={owner} scope={scope} size={32} />
            <CopyButton value={owner} label={t('common.copyAddress')} />
          </li>
        ))}
      </ul>
    </section>
  );
};
