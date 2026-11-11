import type { ReactNode } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { useT } from '@/i18n';
import { ScannerView } from './ScannerView';

export interface ScannerDialogProps {
  open: boolean;
  onClose: () => void;
  /** Receives the scanned (or pasted) text once; the parent then closes the dialog. */
  onResult: (text: string) => void;
  title?: string;
  hint?: ReactNode;
}

/** QR scanner: camera with multi-frame support plus a paste fallback. */
export const ScannerDialog: React.FC<ScannerDialogProps> = ({ open, onClose, onResult, title, hint }) => {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={title ?? t('qr.scanTitle')}>
      {hint && <p className="text-base-content/70 mb-3 text-sm">{hint}</p>}
      <ScannerView onResult={onResult} />
    </Dialog>
  );
};
