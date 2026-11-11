import { TextField } from '@/components/common/TextField';
import { useT } from '@/i18n';
import type { CreateSubParams } from '@/lib/ops/hl/subs';
import type { OpFormProps } from '@/lib/ops/types';

export const CreateSubForm: React.FC<OpFormProps<CreateSubParams>> = ({ value, onChange, errors }) => {
  const t = useT();
  return (
    <TextField
      label={t('hl.sub.name')}
      value={value.name}
      onChange={(name) => onChange({ name })}
      maxLength={16}
      error={errors.name}
    />
  );
};
