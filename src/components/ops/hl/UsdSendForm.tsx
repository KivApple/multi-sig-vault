import { useMemo } from 'react';
import { AddressField } from '@/components/common/AddressField';
import { AmountField } from '@/components/common/AmountField';
import { useT } from '@/i18n';
import { knownRecipients } from '@/lib/known';
import type { UsdParams } from '@/lib/ops/hl/transfers';
import type { OpFormProps } from '@/lib/ops/types';
import { useTransferFee } from './useTransferFee';

export const UsdSendForm: React.FC<OpFormProps<UsdParams>> = ({ value, onChange, env, errors }) => {
  const t = useT();
  const known = useMemo(
    () => knownRecipients(env.signers, env.accounts, { hlEnv: env.account.env }, env.account.address),
    [env.signers, env.accounts, env.account],
  );
  const fee = useTransferFee(env.account, value.destination);
  return (
    <div className="flex flex-col gap-4">
      <AddressField
        label={t('ops.recipientHl')}
        value={value.destination}
        onChange={(destination) => onChange({ destination })}
        known={known}
        error={errors.destination}
        hint={fee}
      />
      <AmountField
        label={t('ops.amount')}
        value={value.amount}
        onChange={(amount) => onChange({ amount })}
        symbol="USDC"
        max={env.hl?.withdrawable}
        error={errors.amount}
      />
    </div>
  );
};
