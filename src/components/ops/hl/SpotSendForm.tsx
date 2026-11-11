import { useMemo } from 'react';
import { AddressField } from '@/components/common/AddressField';
import { AmountField } from '@/components/common/AmountField';
import { useT } from '@/i18n';
import { knownRecipients } from '@/lib/known';
import type { SpotParams } from '@/lib/ops/hl/transfers';
import type { OpFormProps } from '@/lib/ops/types';
import { SpotTokenSelect, type SpotTokenOption } from './SpotTokenSelect';
import { useTransferFee } from './useTransferFee';

export const SpotSendForm: React.FC<OpFormProps<SpotParams>> = ({ value, onChange, env, errors }) => {
  const t = useT();
  const known = useMemo(
    () => knownRecipients(env.signers, env.accounts, { hlEnv: env.account.env }, env.account.address),
    [env.signers, env.accounts, env.account],
  );
  const options = useMemo<SpotTokenOption[]>(
    () =>
      (env.hl?.spot ?? []).map((s) => ({
        id: String(s.token),
        coin: s.coin,
        tokenRef: `${s.coin}:${s.tokenId}`,
        balance: s.available,
        usd: s.usd,
      })),
    [env.hl],
  );
  const held = env.hl?.spot.find((s) => s.token === value.token);
  const fee = useTransferFee(env.account, value.destination);
  return (
    <div className="flex flex-col gap-4">
      <SpotTokenSelect
        value={value.token === null ? undefined : String(value.token)}
        options={options}
        onChange={(o) => onChange({ token: Number(o.id), tokenRef: o.tokenRef, coin: o.coin, amount: '' })}
        error={errors.token}
      />
      <AddressField
        label={t('ops.recipientHl')}
        value={value.destination}
        onChange={(destination) => onChange({ destination })}
        known={known}
        error={errors.destination}
        hint={fee}
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
    </div>
  );
};
