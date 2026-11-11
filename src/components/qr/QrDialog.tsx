import { Copy } from 'lucide-react';
import { useCallback, useMemo, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { useCopy } from '@/hooks/useCopy';
import { useT } from '@/i18n';
import { QrCode } from './QrCode';

export interface QrDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** QR content. */
  value: string;
  /** Text under the code, e.g. the address. */
  caption?: ReactNode;
  /** What the copy button copies; defaults to `value`. */
  copyValue?: string;
}

export const QrDialog: React.FC<QrDialogProps> = ({ open, onClose, title, value, caption, copyValue }) => {
  const t = useT();
  const copy = useCopy();
  const handleCopy = useCallback(() => void copy(copyValue ?? value), [copy, copyValue, value]);

  const actions = useMemo(
    () => (
      <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={handleCopy}>
        <Copy className="size-4" />
        {t('common.copy')}
      </button>
    ),
    [handleCopy, t],
  );

  return (
    <Dialog open={open} onClose={onClose} title={title} actions={actions} size="sm">
      <div className="flex flex-col items-center gap-3">
        <QrCode value={value} size={260} />
        {caption && <div className="mono text-base-content/80 w-full text-center text-sm break-all">{caption}</div>}
      </div>
    </Dialog>
  );
};
