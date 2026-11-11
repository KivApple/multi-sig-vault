import { useCallback, useState } from 'react';
import { NetworkIcon } from '@/components/icons/NetworkIcon';
import { CHAINS } from '@/config/chains';
import { useT } from '@/i18n';
import { useAppStore } from '@/store/appStore';

/** Optional custom RPC endpoint per network (the built-in public endpoints stay as fallback). */
export const RpcSettings: React.FC = () => {
  const t = useT();
  const overrides = useAppStore((s) => s.settings.rpcOverrides);
  const [drafts, setDrafts] = useState<Record<string, string>>(overrides);

  const commit = useCallback((chainId: number, raw: string) => {
    const value = raw.trim();
    const current = useAppStore.getState().settings.rpcOverrides;
    const next = { ...current };
    if (value && /^https:\/\/[^\s]+$/i.test(value)) next[String(chainId)] = value;
    else delete next[String(chainId)];
    useAppStore.getState().updateSettings({ rpcOverrides: next });
    setDrafts((d) => ({ ...d, [String(chainId)]: next[String(chainId)] ?? '' }));
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {CHAINS.map((chain) => (
        <label key={chain.id} className="input input-sm flex w-full items-center gap-2">
          <NetworkIcon chainId={chain.id} size={18} />
          <span className="text-base-content/60 w-28 shrink-0 truncate text-xs">{chain.name}</span>
          <input
            type="url"
            className="mono grow text-xs"
            value={drafts[String(chain.id)] ?? ''}
            onChange={(e) => setDrafts((d) => ({ ...d, [String(chain.id)]: e.target.value }))}
            onBlur={(e) => commit(chain.id, e.target.value)}
            placeholder={new URL(chain.rpcUrls[0]).host}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('settings.rpcFor', { network: chain.name })}
          />
        </label>
      ))}
      <p className="text-base-content/60 text-xs">{t('settings.rpcHint')}</p>
    </div>
  );
};
