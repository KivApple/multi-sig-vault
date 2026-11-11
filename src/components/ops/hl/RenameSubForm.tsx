import { TextField } from '@/components/common/TextField';
import { useT } from '@/i18n';
import type { RenameSubParams } from '@/lib/ops/hl/subs';
import type { OpFormProps } from '@/lib/ops/types';
import { SubAccountSelect } from './SubAccountSelect';

export const RenameSubForm: React.FC<OpFormProps<RenameSubParams>> = ({ value, onChange, env, errors }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <SubAccountSelect
        value={value.subAccountUser}
        subAccounts={env.hlExtras?.subAccounts ?? []}
        onChange={(s) => onChange({ subAccountUser: s.address, oldName: s.name })}
        error={errors.subAccountUser}
      />
      <TextField
        label={t('hl.sub.newName')}
        value={value.name}
        onChange={(name) => onChange({ name })}
        maxLength={16}
        error={errors.name}
      />
    </div>
  );
};
