import { RefreshCw } from 'lucide-react';
import { useCallback, type ChangeEvent } from 'react';
import { SettingRow } from '@/components/ui/SettingRow';
import { SettingsSection } from '@/components/ui/SettingsSection';
import { Spinner } from '@/components/ui/Spinner';
import { useOnline } from '@/hooks/useOnline';
import { useLang, useT } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { updateTokenLists, useTokenListStatus } from '@/lib/tokens';
import { useAppStore } from '@/store/appStore';

/** Settings block: token list version, weekly auto-update switch and manual update. */
export const TokenListSettingsSection: React.FC = () => {
  const t = useT();
  const lang = useLang();
  const online = useOnline();
  const status = useTokenListStatus();
  const autoUpdate = useAppStore((s) => s.settings.tokenListAutoUpdate);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const handleToggle = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => updateSettings({ tokenListAutoUpdate: e.target.checked }),
    [updateSettings],
  );
  const handleUpdate = useCallback(() => void updateTokenLists(), []);

  const busy = status.updating || !!status.iconProgress;
  const when = status.updatedAt
    ? t('tokens.updated', { date: formatDateTime(status.updatedAt, lang) })
    : t('tokens.builtin');

  return (
    <SettingsSection title={t('tokens.section')}>
      <SettingRow
        label={t('tokens.list')}
        hint={
          <>
            <span className="block">
              {t('tokens.listVersion', { version: status.version })} · {when}
            </span>
            <span className="tabular block">
              {t('tokens.counts', { tokens: status.tokenCount, icons: status.iconCount })}
            </span>
            {status.error && (
              <span className="text-error block">{t('tokens.updateFailed', { error: status.error })}</span>
            )}
          </>
        }
        control={
          <button type="button" className="btn btn-sm" onClick={handleUpdate} disabled={busy || !online}>
            {busy ? <Spinner size="xs" /> : <RefreshCw className="size-4" />}
            {status.updating
              ? t('tokens.updating')
              : status.iconProgress
                ? t('tokens.iconProgress', status.iconProgress)
                : t('tokens.updateNow')}
          </button>
        }
      >
        {status.iconProgress && (
          <progress
            className="progress progress-primary block h-1 w-full"
            value={status.iconProgress.done}
            max={status.iconProgress.total}
          />
        )}
      </SettingRow>
      <SettingRow
        label={t('tokens.autoUpdate')}
        hint={t('tokens.autoUpdateHint')}
        control={
          <input
            type="checkbox"
            className="toggle toggle-primary"
            checked={autoUpdate}
            onChange={handleToggle}
            aria-label={t('tokens.autoUpdate')}
          />
        }
      />
    </SettingsSection>
  );
};
