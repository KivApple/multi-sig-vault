import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { useT } from '@/i18n';
import { allOperations, opDescKey, opTitleKey } from '@/lib/ops/registry';
import type { OpDefinition, OpEnv } from '@/lib/ops/types';

export interface NewOperationDialogProps {
  open: boolean;
  onClose: () => void;
  env: OpEnv;
  onPick: (def: OpDefinition) => void;
}

/** Lists only the operations that make sense for the account right now. */
export const NewOperationDialog: React.FC<NewOperationDialogProps> = ({ open, onClose, env, onPick }) => {
  const t = useT();
  const defs = useMemo(
    () => allOperations().filter((d) => d.kind === env.account.kind && d.available(env)),
    [env],
  );
  return (
    <Dialog open={open} onClose={onClose} title={t('ops.new')}>
      <ul className="-mx-2 flex flex-col">
        {defs.map((def) => (
          <li key={def.type}>
            <button
              type="button"
              className="hover:bg-base-200 flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left"
              onClick={() => onPick(def)}
            >
              <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <def.icon className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="font-medium">{t(opTitleKey(def.type))}</span>
                <span className="text-base-content/60 text-xs">{t(opDescKey(def.type))}</span>
              </span>
              <ChevronRight className="text-base-content/40 size-4 shrink-0" />
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
};
