import { Check, KeyRound, Pencil, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { SortableList } from '@/components/common/SortableList';
import { SortableRow } from '@/components/common/SortableRow';
import { SignerCard } from '@/components/signers/SignerCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { AddSignerDialog } from '@/components/wallets/AddSignerDialog';
import { useT } from '@/i18n';
import { useAppStore } from '@/store/appStore';

/** Keys the app can sign with: MetaMask accounts and hardware wallet addresses. */
export const SignersPage: React.FC = () => {
  const t = useT();
  const signers = useAppStore((s) => s.signers);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const ids = useMemo(() => signers.map((s) => s.id), [signers]);
  const handleReorder = useCallback((next: string[]) => useAppStore.getState().reorderSigners(next), []);
  const openAdd = useCallback(() => setAdding(true), []);

  return (
    <>
      <PageHeader
        title={t('nav.signers')}
        actions={
          <>
            {signers.length > 0 && (
              <IconButton label={t(editing ? 'common.done' : 'signers.editList')} onClick={() => setEditing((v) => !v)} active={editing}>
                {editing ? <Check className="size-5" /> : <Pencil className="size-5" />}
              </IconButton>
            )}
            <button type="button" className="btn btn-primary btn-sm btn-square" onClick={openAdd} aria-label={t('signers.add')} title={t('signers.add')}>
              <Plus className="size-5" />
            </button>
          </>
        }
      />
      {signers.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="size-10" />}
          title={t('signers.empty.title')}
          text={t('signers.empty.text')}
          action={
            <button type="button" className="btn btn-primary" onClick={openAdd}>
              <Plus className="size-4" />
              {t('signers.add')}
            </button>
          }
        />
      ) : (
        <SortableList ids={ids} onReorder={handleReorder}>
          <ul className="flex flex-col gap-2">
            {signers.map((signer) => (
              <SortableRow key={signer.id} id={signer.id} editing={editing}>
                <SignerCard signer={signer} editing={editing} />
              </SortableRow>
            ))}
          </ul>
        </SortableList>
      )}
      <AddSignerDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
};
