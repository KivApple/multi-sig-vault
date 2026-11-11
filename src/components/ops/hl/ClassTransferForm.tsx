import { AmountField } from '@/components/common/AmountField';
import { Field } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useT } from '@/i18n';
import type { ClassTransferParams } from '@/lib/ops/hl/transfers';
import type { OpFormProps } from '@/lib/ops/types';

export const ClassTransferForm: React.FC<OpFormProps<ClassTransferParams>> = ({ value, onChange, env, errors }) => {
  const t = useT();
  const max = value.toPerp ? (env.hl?.spot.find((s) => s.token === 0)?.available ?? '0') : env.hl?.withdrawable;
  return (
    <div className="flex flex-col gap-4">
      <Field label={t('ops.direction')}>
        <Segmented
          value={value.toPerp ? 'toPerp' : 'toSpot'}
          options={[
            { value: 'toPerp', label: t('hl.spotToPerp') },
            { value: 'toSpot', label: t('hl.perpToSpot') },
          ]}
          onChange={(v) => onChange({ toPerp: v === 'toPerp', amount: '' })}
          ariaLabel={t('ops.direction')}
        />
      </Field>
      <AmountField
        label={t('ops.amount')}
        value={value.amount}
        onChange={(amount) => onChange({ amount })}
        symbol="USDC"
        max={max}
        error={errors.amount}
      />
    </div>
  );
};
