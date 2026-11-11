import { useMemo } from 'react';
import { AddressLabel } from '@/components/common/AddressLabel';
import { AmountField } from '@/components/common/AmountField';
import { Notice } from '@/components/common/Notice';
import { Field } from '@/components/ui/Field';
import { getChain, HL_EVM_CHAIN } from '@/config/chains';
import { useT } from '@/i18n';
import type { SpotParams } from '@/lib/ops/hl/transfers';
import type { OpFormProps } from '@/lib/ops/types';
import { SpotTokenSelect, type SpotTokenOption } from './SpotTokenSelect';

export const SpotWithdrawForm: React.FC<OpFormProps<SpotParams>> = ({ value, onChange, env, errors }) => {
  const t = useT();
  const chain = getChain(HL_EVM_CHAIN[env.account.env]);
  const options = useMemo<SpotTokenOption[]>(
    () =>
      (env.hl?.spot ?? [])
        .filter((s) => s.evm && s.token !== 0)
        .map((s) => ({
          id: String(s.token),
          coin: s.coin,
          tokenRef: `${s.coin}:${s.tokenId}`,
          balance: s.available,
          usd: s.usd,
        })),
    [env.hl],
  );
  const held = env.hl?.spot.find((s) => s.token === value.token);
  return (
    <div className="flex flex-col gap-4">
      <SpotTokenSelect
        value={value.token === null ? undefined : String(value.token)}
        options={options}
        onChange={(o) => onChange({ token: Number(o.id), tokenRef: o.tokenRef, coin: o.coin, amount: '' })}
        error={errors.token}
      />
      {value.token !== null && (
        <AmountField
          label={t('ops.amount')}
          value={value.amount}
          onChange={(amount) => onChange({ amount })}
          symbol={value.coin}
          max={held?.available}
          error={errors.amount}
        />
      )}
      <Field label={t('ops.recipientOn', { network: chain.name })} hint={t('hl.spotWithdraw.sameAddress')}>
        <div className="bg-base-200 rounded-field px-3 py-2">
          <AddressLabel address={env.account.address} scope={{ hlEnv: env.account.env }} />
        </div>
      </Field>
      {env.hl?.multiSig && <Notice tone="warning">{t('hl.evmKeyNote')}</Notice>}
    </div>
  );
};
