import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Field } from '@/components/ui/Field';
import { useT } from '@/i18n';
import { parseAddress, sameAddress } from '@/lib/format';
import type { KnownAddress } from '@/lib/known';
import { useAppStore } from '@/store/appStore';
import { AddressField } from './AddressField';

export interface OwnersEditorProps {
  owners: string[];
  threshold: number;
  onChange: (owners: string[], threshold: number) => void;
  /** Upper bound of the owner count (Hyperliquid: 10). */
  maxOwners?: number;
  errors?: Record<string, string>;
  disabled?: boolean;
}

/** Editable set of multi-sig signers plus the threshold ("m of n"). */
export const OwnersEditor: React.FC<OwnersEditorProps> = ({ owners, threshold, onChange, maxOwners = 50, errors, disabled }) => {
  const t = useT();
  const signers = useAppStore((s) => s.signers);
  const validCount = useMemo(() => owners.filter((o) => parseAddress(o)).length, [owners]);

  const knownFor = useCallback(
    (index: number): KnownAddress[] =>
      signers
        .filter((s) => !owners.some((o, i) => i !== index && sameAddress(o, s.address)))
        .map((s) => ({ address: s.address, signer: s })),
    [signers, owners],
  );

  const setOwner = useCallback(
    (index: number, address: string) => {
      onChange(owners.map((o, i) => (i === index ? address : o)), threshold);
    },
    [owners, threshold, onChange],
  );
  const removeOwner = useCallback(
    (index: number) => {
      const next = owners.filter((_, i) => i !== index);
      onChange(next, Math.max(1, Math.min(threshold, next.length)));
    },
    [owners, threshold, onChange],
  );
  const addOwner = useCallback(() => onChange([...owners, ''], threshold), [owners, threshold, onChange]);
  const setThreshold = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => onChange(owners, Number(e.target.value)),
    [owners, onChange],
  );

  return (
    <div className="flex flex-col gap-3">
      {owners.map((owner, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, addresses may repeat while editing
        <div key={i} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <AddressField
              label={t('owners.signerN', { n: i + 1 })}
              value={owner}
              onChange={(a) => setOwner(i, a)}
              known={knownFor(i)}
              error={errors?.[`owner${i}`]}
              disabled={disabled}
            />
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-square mt-5"
            onClick={() => removeOwner(i)}
            disabled={disabled || owners.length <= 1}
            aria-label={t('owners.remove')}
            title={t('owners.remove')}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      {errors?.owners && <p className="text-error text-xs">{errors.owners}</p>}
      {owners.length < maxOwners && (
        <button type="button" className="btn btn-outline btn-sm self-start" onClick={addOwner} disabled={disabled}>
          <Plus className="size-4" />
          {t('owners.add')}
        </button>
      )}
      <Field label={t('owners.threshold')} error={errors?.threshold} hint={t('owners.thresholdHint')}>
        <div className="flex items-center gap-2">
          <select
            className="select w-24"
            value={Math.min(threshold, Math.max(validCount, 1))}
            onChange={setThreshold}
            disabled={disabled}
            aria-label={t('owners.threshold')}
          >
            {Array.from({ length: Math.max(validCount, 1) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="text-base-content/70 text-sm">{t('owners.outOf', { total: Math.max(validCount, 1) })}</span>
        </div>
      </Field>
    </div>
  );
};
