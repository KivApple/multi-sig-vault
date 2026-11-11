import { useMemo } from 'react';
import { AddressField } from '@/components/common/AddressField';
import { AmountField } from '@/components/common/AmountField';
import { getChain, HL_BRIDGE_CHAIN } from '@/config/chains';
import { useLang, useT } from '@/i18n';
import { formatAmount } from '@/lib/format';
import { HL_WITHDRAW_FEE } from '@/lib/hl/account';
import { knownRecipients } from '@/lib/known';
import type { UsdParams } from '@/lib/ops/hl/transfers';
import type { OpFormProps } from '@/lib/ops/types';

export const WithdrawForm: React.FC<OpFormProps<UsdParams>> = ({ value, onChange, env, errors }) => {
  const t = useT();
  const lang = useLang();
  const chain = getChain(HL_BRIDGE_CHAIN[env.account.env]);
  const known = useMemo(
    () => knownRecipients(env.signers, env.accounts, { chainId: chain.id }),
    [env.signers, env.accounts, chain.id],
  );
  const net = Number(value.amount) - HL_WITHDRAW_FEE;
  return (
    <div className="flex flex-col gap-4">
      <AddressField
        label={t('ops.recipientOn', { network: chain.name })}
        value={value.destination}
        onChange={(destination) => onChange({ destination })}
        known={known}
        error={errors.destination}
      />
      <AmountField
        label={t('ops.amount')}
        value={value.amount}
        onChange={(amount) => onChange({ amount })}
        symbol="USDC"
        max={env.hl?.withdrawable}
        error={errors.amount}
        hint={
          net > 0
            ? t('hl.withdraw.feeNet', { fee: HL_WITHDRAW_FEE, net: formatAmount(net, lang) })
            : t('hl.withdraw.fee', { fee: HL_WITHDRAW_FEE })
        }
      />
    </div>
  );
};
