import { AddressLabel } from '@/components/common/AddressLabel';
import { Notice } from '@/components/common/Notice';
import { useT } from '@/i18n';
import type { OpFormProps } from '@/lib/ops/types';

export const DisableMultiSigForm: React.FC<OpFormProps<Record<string, never>>> = ({ env }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="warning">{t('hl.disable.note')}</Notice>
      <div className="bg-base-200 rounded-field px-3 py-2">
        <AddressLabel address={env.account.address} scope={{ hlEnv: env.account.env }} />
      </div>
    </div>
  );
};
