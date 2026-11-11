import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { WalletIcon } from '@/components/icons/WalletIcon';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { useT } from '@/i18n';
import { describeError } from '@/lib/describeError';
import { toast } from '@/lib/toast';
import { getWallet, type DiscoveredAccount } from '@/lib/wallets';
import { useAppStore } from '@/store/appStore';
import type { Signer, WalletKind } from '@/types/domain';
import { DiscoveredAccountRow } from './DiscoveredAccountRow';
import { WalletTypeButton } from './WalletTypeButton';

export interface AddSignerDialogProps {
  open: boolean;
  onClose: () => void;
}

const KINDS: WalletKind[] = ['metamask', 'trezor', 'ledger'];
const PAGE = 5;

/** Wallet type → addresses from that wallet (multi-select, named) → signers in the store. */
export const AddSignerDialog: React.FC<AddSignerDialogProps> = ({ open, onClose }) => {
  const t = useT();
  const signers = useAppStore((s) => s.signers);
  const [kind, setKind] = useState<WalletKind | null>(null);
  const [scheme, setScheme] = useState<string | undefined>(undefined);
  const [accounts, setAccounts] = useState<DiscoveredAccount[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Guards against answers of a request the user has already navigated away from. */
  const requestId = useRef(0);

  const reset = useCallback(() => {
    requestId.current++;
    setKind(null);
    setScheme(undefined);
    setAccounts([]);
    setSelected({});
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const load = useCallback(
    async (wallet: WalletKind, opts: { scheme?: string; offset: number; reselect?: boolean }) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const found = await getWallet(wallet).listAccounts({ ...opts, count: PAGE });
        if (id !== requestId.current) return;
        setAccounts((prev) => {
          const base = opts.offset === 0 ? [] : prev;
          const known = new Set(base.map((a) => a.address.toLowerCase()));
          return [...base, ...found.filter((a) => !known.has(a.address.toLowerCase()))];
        });
      } catch (e) {
        if (id === requestId.current) setError(describeError(e, t));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [t],
  );

  const handleSelectKind = useCallback(
    (wallet: WalletKind) => {
      const first = getWallet(wallet).schemes[0]?.id;
      setKind(wallet);
      setScheme(first);
      setAccounts([]);
      setSelected({});
      void load(wallet, { scheme: first, offset: 0 });
    },
    [load],
  );

  const handleScheme = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      if (!kind) return;
      setScheme(e.target.value);
      setAccounts([]);
      setSelected({});
      void load(kind, { scheme: e.target.value, offset: 0 });
    },
    [kind, load],
  );

  const handleRetry = useCallback(() => {
    if (kind) void load(kind, { scheme, offset: accounts.length });
  }, [accounts.length, kind, load, scheme]);

  const handleMore = handleRetry;

  const handleReselect = useCallback(() => {
    if (!kind) return;
    setSelected({});
    void load(kind, { offset: 0, reselect: true });
  }, [kind, load]);

  const existing = useMemo(() => new Map(signers.map((s) => [s.id, s.name])), [signers]);

  const handleToggle = useCallback(
    (address: string) => {
      if (!kind) return;
      const id = address.toLowerCase();
      setSelected((prev) => {
        if (id in prev) {
          const { [id]: _removed, ...rest } = prev;
          return rest;
        }
        const taken = new Set([...signers.map((s) => s.name), ...Object.values(prev)]);
        let n = signers.filter((s) => s.wallet === kind).length + 1;
        while (taken.has(`${t(`wallets.${kind}`)} ${n}`)) n++;
        const discovered = accounts.find((a) => a.address.toLowerCase() === id);
        return { ...prev, [id]: discovered?.name ?? `${t(`wallets.${kind}`)} ${n}` };
      });
    },
    [accounts, kind, signers, t],
  );

  const handleRename = useCallback((address: string, name: string) => {
    setSelected((prev) => ({ ...prev, [address.toLowerCase()]: name }));
  }, []);

  const count = Object.keys(selected).length;

  const handleSubmit = useCallback(() => {
    if (!kind) return;
    const now = Date.now();
    const added: Signer[] = accounts
      .filter((a) => a.address.toLowerCase() in selected)
      .map((a, i) => ({
        id: a.address.toLowerCase(),
        address: a.address,
        name: selected[a.address.toLowerCase()].trim() || `${t(`wallets.${kind}`)} ${i + 1}`,
        wallet: kind,
        path: a.path,
        addedAt: now + i,
      }));
    useAppStore.getState().addSigners(added);
    toast.success(t('wallets.add.added', { count: added.length }));
    onClose();
  }, [accounts, kind, onClose, selected, t]);

  const adapter = kind ? getWallet(kind) : null;
  const hardware = !!adapter && adapter.schemes.length > 0;

  const title = useMemo(
    () =>
      kind ? (
        <span className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square -ml-2"
            onClick={reset}
            aria-label={t('wallets.add.otherWallet')}
            title={t('wallets.add.otherWallet')}
          >
            <ArrowLeft className="size-5" />
          </button>
          <WalletIcon kind={kind} size={22} />
          {t(`wallets.${kind}`)}
        </span>
      ) : (
        t('wallets.add.title')
      ),
    [kind, reset, t],
  );

  const actions = useMemo(
    () =>
      kind && accounts.length > 0 ? (
        <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={count === 0} onClick={handleSubmit}>
          {count === 0 ? t('wallets.add.submitEmpty') : t('wallets.add.submit', { count })}
        </button>
      ) : undefined,
    [accounts.length, count, handleSubmit, kind, t],
  );

  return (
    <Dialog open={open} onClose={onClose} title={title} actions={actions}>
      {!kind && (
        <div className="flex flex-col gap-2">
          <p className="text-base-content/60 mb-1 text-sm">{t('wallets.add.chooseWallet')}</p>
          {KINDS.map((k) => (
            <WalletTypeButton
              key={k}
              kind={k}
              label={t(`wallets.${k}`)}
              hint={t(`wallets.add.${k}Hint`)}
              onSelect={handleSelectKind}
            />
          ))}
        </div>
      )}

      {kind && adapter && (
        <div className="flex flex-col gap-3">
          {hardware && accounts.length > 0 && (
            <Field label={t('wallets.add.derivation')}>
              <select className="select w-full" value={scheme} onChange={handleScheme} disabled={loading}>
                {adapter.schemes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t(s.labelKey)} · {s.path(0)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {accounts.length > 0 && (
            <ul className="card-surface divide-base-300 divide-y">
              {accounts.map((a) => (
                <DiscoveredAccountRow
                  key={a.address}
                  account={a}
                  existingName={existing.get(a.address.toLowerCase())}
                  selected={a.address.toLowerCase() in selected}
                  name={selected[a.address.toLowerCase()] ?? ''}
                  onToggle={handleToggle}
                  onRename={handleRename}
                />
              ))}
            </ul>
          )}

          {loading && (
            <div className="text-base-content/70 flex items-center gap-3 py-3 text-sm">
              <Spinner />
              <span>{accounts.length > 0 ? t('wallets.add.reading') : t(`wallets.add.connecting.${kind}`)}</span>
            </div>
          )}

          {error && !loading && (
            <div role="alert" className="alert alert-error alert-soft items-start text-sm">
              <span className="min-w-0 flex-1 break-words">{error}</span>
              <button type="button" className="btn btn-sm" onClick={handleRetry}>
                <RefreshCw className="size-4" />
                {t('common.retry')}
              </button>
            </div>
          )}

          {!loading && !error && accounts.length === 0 && (
            <p className="text-base-content/60 py-2 text-sm">{t('wallets.add.empty')}</p>
          )}

          {!loading && !error && hardware && accounts.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm self-start" onClick={handleMore}>
              {t('wallets.add.loadMore')}
            </button>
          )}

          {!loading && !hardware && (
            <button type="button" className="btn btn-ghost btn-sm self-start" onClick={handleReselect}>
              {t('wallets.add.reselect')}
            </button>
          )}
        </div>
      )}
    </Dialog>
  );
};
