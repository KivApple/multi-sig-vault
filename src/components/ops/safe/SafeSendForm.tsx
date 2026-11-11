import { useMemo } from 'react';
import { AddressField } from '@/components/common/AddressField';
import { AmountField } from '@/components/common/AmountField';
import { PickerSelect, type PickerOption } from '@/components/common/PickerSelect';
import { TokenIcon } from '@/components/icons/TokenIcon';
import { Field } from '@/components/ui/Field';
import { useLang, useT } from '@/i18n';
import { formatAmount, formatUsd } from '@/lib/format';
import { knownRecipients } from '@/lib/known';
import { holdingAmount, type SafeSendParams } from '@/lib/ops/safe/send';
import type { OpFormProps } from '@/lib/ops/types';

export const SafeSendForm: React.FC<OpFormProps<SafeSendParams>> = ({ value, onChange, env, errors }) => {
  const t = useT();
  const lang = useLang();
  const chainId = env.account.chainId as number;
  const holdings = useMemo(
    () => (env.safe?.holdings ?? []).filter((h) => h.balance !== '0' || !h.token),
    [env.safe],
  );
  const options = useMemo<PickerOption[]>(
    () =>
      holdings.map((h) => ({
        value: h.token?.address ?? '',
        title: h.symbol,
        subtitle: formatAmount(holdingAmount(h.balance, h.decimals), lang, 8),
        icon: <TokenIcon symbol={h.symbol} chainId={chainId} address={h.token?.address} size={32} />,
        aside: h.usd > 0 ? formatUsd(h.usd, lang) : undefined,
      })),
    [holdings, chainId, lang],
  );
  const known = useMemo(
    () => knownRecipients(env.signers, env.accounts, { chainId }, env.account.address),
    [env.signers, env.accounts, env.account.address, chainId],
  );
  const selected = holdings.find((h) => (h.token?.address ?? '') === value.token);

  return (
    <div className="flex flex-col gap-4">
      <Field label={t('ops.token')}>
        <PickerSelect
          value={value.token}
          options={options}
          onChange={(token) => {
            const h = holdings.find((x) => (x.token?.address ?? '') === token);
            if (h) onChange({ token, symbol: h.symbol, decimals: h.decimals, amount: '' });
          }}
          title={t('ops.token')}
        />
      </Field>
      <AddressField
        label={t('ops.recipient')}
        value={value.recipient}
        onChange={(recipient) => onChange({ recipient })}
        known={known}
        error={errors.recipient}
      />
      <AmountField
        label={t('ops.amount')}
        value={value.amount}
        onChange={(amount) => onChange({ amount })}
        symbol={value.symbol}
        max={selected ? holdingAmount(selected.balance, selected.decimals) : undefined}
        error={errors.amount}
      />
    </div>
  );
};
