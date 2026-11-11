import { Copy, Share2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { useCopy } from '@/hooks/useCopy';
import { useT } from '@/i18n';
import { splitFrames } from '@/lib/qr/frames';
import { QrCode } from './QrCode';

export interface TransferQrDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Packed transfer text (`msv1:…`). */
  text: string;
  /** What is being exported, shown above the code. */
  summary?: ReactNode;
}

/** A single code stays comfortably scannable up to this many characters. */
const SINGLE_MAX = 900;
/** Per-frame payload of an animated code: small enough for quick reads from a phone screen. */
const FRAME_CHUNK = 360;
const FRAME_MS = 250;

const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export const TransferQrDialog: React.FC<TransferQrDialogProps> = ({ open, onClose, title, text, summary }) => {
  const t = useT();
  const copy = useCopy();
  const frames = useMemo(() => splitFrames(text, text.length <= SINGLE_MAX ? SINGLE_MAX : FRAME_CHUNK), [text]);
  const [index, setIndex] = useState(0);
  const animated = frames.length > 1;

  useEffect(() => {
    setIndex(0);
    if (!open || !animated) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % frames.length), FRAME_MS);
    return () => clearInterval(timer);
  }, [open, animated, frames]);

  const handleCopy = useCallback(() => void copy(text), [copy, text]);
  const handleShare = useCallback(() => {
    // Rejection = the user dismissed the share sheet.
    void navigator.share({ text }).catch(() => undefined);
  }, [text]);

  const actions = useMemo(
    () => (
      <>
        {canShare && (
          <button type="button" className="btn btn-ghost" onClick={handleShare}>
            <Share2 className="size-4" />
            {t('qr.share')}
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={handleCopy}>
          <Copy className="size-4" />
          {t('qr.copyText')}
        </button>
      </>
    ),
    [handleCopy, handleShare, t],
  );

  const current = frames[Math.min(index, frames.length - 1)];

  return (
    <Dialog open={open} onClose={onClose} title={title} actions={actions}>
      <div className="flex flex-col items-center gap-3">
        {summary && <div className="w-full text-sm">{summary}</div>}
        <QrCode value={current} size={320} />
        {animated && (
          <div className="w-full text-center">
            <progress className="progress progress-primary h-1 w-full" value={index + 1} max={frames.length} />
            <p className="text-base-content/60 tabular mt-1 text-xs">
              {t('qr.frame', { index: index + 1, total: frames.length })} · {t('qr.framesHint')}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
};
