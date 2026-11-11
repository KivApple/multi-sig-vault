import { ArrowUpCircle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useT } from '@/i18n';
import { applyUpdate, useUpdate } from '@/lib/update';

/**
 * Slim strip under the top bar. Appears only when there is something to decide or to know:
 * a downloaded release waiting for consent, a release rejected by signature verification,
 * or a pending service-worker replacement.
 */
export const UpdateBanner: React.FC = () => {
  const t = useT();
  const status = useUpdate((s) => s.status);
  const newVersion = useUpdate((s) => s.newVersion);
  const verification = useUpdate((s) => s.verification);
  const swUpdatePending = useUpdate((s) => s.swUpdatePending);
  const [applying, setApplying] = useState(false);

  const handleApply = useCallback(() => {
    setApplying(true);
    void applyUpdate().finally(() => setApplying(false));
  }, []);

  if (status === 'ready' && newVersion) {
    return (
      <div className="bg-primary/10 border-primary/20 border-b" role="status">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-2">
          <ArrowUpCircle className="text-primary size-5 shrink-0" />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{t('update.available', { version: newVersion })}</span>
            {verification === 'verified' && (
              <span className="text-success ml-2 inline-flex items-center gap-1 align-middle text-xs">
                <ShieldCheck className="size-3.5" />
                {t('update.verifiedMark')}
              </span>
            )}
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleApply} disabled={applying}>
            {applying ? t('update.installing') : t('update.install')}
          </button>
        </div>
      </div>
    );
  }

  if (status === 'unverified' && newVersion) {
    return (
      <div className="bg-warning/15 border-warning/30 border-b" role="alert">
        <div className="mx-auto flex w-full max-w-3xl items-start gap-3 px-4 py-2">
          <ShieldAlert className="text-warning mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">{t('update.unverifiedTitle', { version: newVersion })}</p>
            <p className="text-base-content/70 text-xs">{t('update.unverifiedText')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (swUpdatePending) {
    return (
      <div className="bg-warning/15 border-warning/30 border-b" role="alert">
        <div className="mx-auto flex w-full max-w-3xl items-start gap-3 px-4 py-2">
          <ShieldAlert className="text-warning mt-0.5 size-5 shrink-0" />
          <p className="min-w-0 flex-1 text-xs">{t('update.swPending')}</p>
        </div>
      </div>
    );
  }

  return null;
};
