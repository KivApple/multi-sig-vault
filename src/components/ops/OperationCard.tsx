import { Trash2 } from 'lucide-react';
import { Notice } from '@/components/common/Notice';
import { useT } from '@/i18n';
import { deleteOperation } from '@/lib/ops/engine';
import { getOpDefinition } from '@/lib/ops/registry';
import type { OpEnv } from '@/lib/ops/types';
import type { Operation } from '@/types/domain';
import { DraftOperation } from './DraftOperation';
import { SentOperation } from './SentOperation';
import { SigningOperation } from './SigningOperation';

export interface OperationCardProps {
  op: Operation;
  env: OpEnv;
  queueLabel?: string;
}

export const OperationCard: React.FC<OperationCardProps> = ({ op, env, queueLabel }) => {
  const t = useT();
  const def = getOpDefinition(op.type);
  if (!def) {
    return (
      <Notice tone="warning">
        {t('ops.error.unknownType', { type: op.type })}
        <button type="button" className="btn btn-xs ml-2" onClick={() => deleteOperation(op.id)}>
          <Trash2 className="size-3" />
          {t('common.delete')}
        </button>
      </Notice>
    );
  }
  if (op.status === 'draft') return <DraftOperation op={op} def={def} env={env} />;
  if (op.status === 'signing') return <SigningOperation op={op} def={def} env={env} queueLabel={queueLabel} />;
  return <SentOperation op={op} def={def} account={env.account} />;
};
