import { Folder } from 'lucide-react';
import { useMemo } from 'react';
import { PickerSelect, type PickerOption } from '@/components/common/PickerSelect';
import { Field } from '@/components/ui/Field';
import { useT } from '@/i18n';
import { shortAddress } from '@/lib/format';
import type { HlSubInfo } from '@/lib/hl/account';

export interface SubAccountSelectProps {
  value: string;
  subAccounts: HlSubInfo[];
  onChange: (sub: HlSubInfo) => void;
  error?: string;
}

export const SubAccountSelect: React.FC<SubAccountSelectProps> = ({ value, subAccounts, onChange, error }) => {
  const t = useT();
  const options = useMemo<PickerOption[]>(
    () =>
      subAccounts.map((s) => ({
        value: s.address,
        title: s.name,
        subtitle: shortAddress(s.address),
        icon: <Folder className="text-base-content/60 size-5" />,
      })),
    [subAccounts],
  );
  return (
    <Field label={t('hl.sub.account')} error={error}>
      <PickerSelect
        value={value || undefined}
        options={options}
        onChange={(address) => {
          const sub = subAccounts.find((s) => s.address === address);
          if (sub) onChange(sub);
        }}
        title={t('hl.sub.account')}
        invalid={!!error}
      />
    </Field>
  );
};
