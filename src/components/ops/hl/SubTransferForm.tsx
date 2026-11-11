import { useMemo } from 'react';
import { AmountField } from '@/components/common/AmountField';
import { Field } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useT } from '@/i18n';
import type { SubTransferParams } from '@/lib/ops/hl/subs';
import type { OpFormProps } from '@/lib/ops/types';
import { SpotTokenSelect, type SpotTokenOption } from './SpotTokenSelect';
import { SubAccountSelect } from './SubAccountSelect';

export const SubTransferForm: React.FC<OpFormProps<SubTransferParams>> = ({ value, onChange, env, errors }) => {
  const t = useT();
  const subs = env.hlExtras?.subAccounts ?? [];
  const sub = subs.find((s) => s.address === value.subAccountUser);

  // Balances of the side the funds leave from.
  const options = useMemo<SpotTokenOption[]>(() => {
    const out: SpotTokenOption[] = [];
    if (!env.hl?.unified) {
      out.push({
        id: 'perp',
        coin: 'USDC',
        tokenRef: env.hl?.usdcToken ?? '',
        balance: (value.deposit ? env.hl?.withdrawable : sub?.withdrawable) ?? '0',
        caption: t('hl.perps'),
      });
    }
    const spot = value.deposit
      ? (env.hl?.spot ?? []).map((s) => ({ coin: s.coin, token: s.token, tokenId: s.tokenId, balance: s.available }))
      : (sub?.spot ?? []).map((s) => ({ coin: s.coin, token: s.token, tokenId: s.tokenId, balance: s.total }));
    for (const s of spot) {
      out.push({ id: String(s.token), coin: s.coin, tokenRef: `${s.coin}:${s.tokenId}`, balance: s.balance, caption: t('hl.spot') });
    }
    return out;
  }, [env.hl, sub, value.deposit, t]);
  const selected = options.find((o) => o.id === value.asset);

  return (
    <div className="flex flex-col gap-4">
      <SubAccountSelect
        value={value.subAccountUser}
        subAccounts={subs}
        onChange={(s) => onChange({ subAccountUser: s.address, subName: s.name, amount: '' })}
        error={errors.subAccountUser}
      />
      <Field label={t('ops.direction')}>
        <Segmented
          value={value.deposit ? 'in' : 'out'}
          options={[
            { value: 'in', label: t('hl.sub.deposit') },
            { value: 'out', label: t('hl.sub.withdraw') },
          ]}
          onChange={(v) => onChange({ deposit: v === 'in', amount: '' })}
          ariaLabel={t('ops.direction')}
        />
      </Field>
      <SpotTokenSelect
        value={selected?.id}
        options={options}
        onChange={(o) => onChange({ asset: o.id, tokenRef: o.tokenRef, coin: o.coin, amount: '' })}
        error={errors.asset}
      />
      <AmountField
        label={t('ops.amount')}
        value={value.amount}
        onChange={(amount) => onChange({ amount })}
        symbol={value.coin}
        max={selected?.balance}
        error={errors.amount}
      />
    </div>
  );
};
