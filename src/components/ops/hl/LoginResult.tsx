import { Copy, ExternalLink, QrCode } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Notice } from '@/components/common/Notice';
import { QrDialog } from '@/components/qr/QrDialog';
import { HL_APP } from '@/config/chains';
import { useCopy } from '@/hooks/useCopy';
import { useT } from '@/i18n';
import type { OpResultProps } from '@/lib/ops/types';
import { useAgentKey } from './useAgentKey';

/**
 * Login link in the format of the official front end ("Link mobile device"):
 * `<app>/trade?link=base64(JSON {address, key})`. The key is an approved named agent.
 */
export const LoginResult: React.FC<OpResultProps> = ({ op, account }) => {
  const t = useT();
  const copy = useCopy();
  const key = useAgentKey(op.id);
  const [qr, setQr] = useState(false);
  const link = useMemo(
    () => (key ? `${HL_APP[account.env]}/trade?link=${btoa(JSON.stringify({ address: account.address, key }))}` : ''),
    [key, account],
  );
  if (key === undefined) return null;
  if (key === null) return <Notice tone="warning">{t('hl.agent.keyMissing')}</Notice>;
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="warning">{t('hl.login.secret')}</Notice>
      <div className="flex flex-wrap gap-2">
        <a className="btn btn-primary btn-sm" href={link} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="size-4" />
          {t('hl.login.open')}
        </a>
        <button type="button" className="btn btn-sm" onClick={() => void copy(link, t('hl.login.copied'))}>
          <Copy className="size-4" />
          {t('hl.login.copy')}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setQr(true)}>
          <QrCode className="size-4" />
          QR
        </button>
      </div>
      <QrDialog
        open={qr}
        onClose={() => setQr(false)}
        title={t('hl.login.qrTitle')}
        value={link}
        caption={t('hl.login.qrCaption')}
      />
    </div>
  );
};
