import { useEffect } from 'react';
import { Notice } from '@/components/common/Notice';
import { TextField } from '@/components/common/TextField';
import { useT } from '@/i18n';
import type { LoginParams } from '@/lib/ops/hl/agents';
import { ensureAgentKey } from '@/lib/ops/hl/common';
import type { OpFormProps } from '@/lib/ops/types';

export const LoginForm: React.FC<OpFormProps<LoginParams>> = ({ opId, value, onChange, env, errors }) => {
  const t = useT();
  useEffect(() => {
    if (value.agentAddress) return;
    let stale = false;
    void ensureAgentKey(opId).then((agentAddress) => {
      if (!stale) onChange({ agentAddress });
    });
    return () => {
      stale = true;
    };
  }, [value.agentAddress, opId, onChange]);

  const agents = env.hlExtras?.agents ?? [];
  const replaces = agents.some((a) => a.name === value.name.trim());
  return (
    <div className="flex flex-col gap-4">
      <Notice>{t('hl.login.note')}</Notice>
      <TextField
        label={t('hl.login.agentName')}
        value={value.name}
        onChange={(name) => onChange({ name })}
        maxLength={16}
        error={errors.name ?? errors.agentAddress}
        hint={replaces ? t('hl.agent.replaces') : agents.length >= 3 ? t('hl.agent.limit') : undefined}
      />
    </div>
  );
};
