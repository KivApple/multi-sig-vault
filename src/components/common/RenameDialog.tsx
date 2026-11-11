import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { useT } from '@/i18n';

export interface RenameDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  initial: string;
  /** Empty name allowed (falls back to the address). */
  allowEmpty?: boolean;
  onSave: (name: string) => void;
}

export const RenameDialog: React.FC<RenameDialogProps> = ({ open, onClose, title, initial, allowEmpty, onSave }) => {
  const t = useT();
  const [name, setName] = useState(initial);
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);
  const valid = allowEmpty || name.trim().length > 0;
  const handleSave = useCallback(() => {
    if (!valid) return;
    onSave(name.trim());
    onClose();
  }, [valid, name, onSave, onClose]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!valid}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <input
        type="text"
        className="input w-full"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
        }}
        maxLength={40}
        placeholder={t('common.name')}
        aria-label={t('common.name')}
        // biome-ignore lint/a11y/noAutofocus: the dialog exists only to edit this field
        autoFocus
      />
    </Dialog>
  );
};
