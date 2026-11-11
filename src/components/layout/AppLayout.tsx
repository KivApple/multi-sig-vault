import { KeyRound, Settings, Wallet, WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useOnline } from '@/hooks/useOnline';
import { useT } from '@/i18n';
import { UpdateBanner } from '@/components/update/UpdateBanner';
import { AppLogo } from '@/components/icons/AppLogo';
import { NavItem } from './NavItem';

/** App frame: top bar with navigation on wide screens, bottom dock on phones. */
export const AppLayout: React.FC = () => {
  const t = useT();
  const online = useOnline();
  const { pathname } = useLocation();

  const items = useMemo(
    () => [
      { to: '/', label: t('nav.accounts'), icon: <Wallet className="size-5" /> },
      { to: '/signers', label: t('nav.signers'), icon: <KeyRound className="size-5" /> },
      { to: '/settings', label: t('nav.settings'), icon: <Settings className="size-5" /> },
    ],
    [t],
  );
  // Account pages belong to the "Accounts" section.
  const accountsActive = pathname.startsWith('/account');

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="bg-base-100/85 border-base-300 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
          <AppLogo className="size-7 shrink-0" />
          <span className="font-semibold tracking-tight">{t('app.name')}</span>
          {!online && (
            <span className="badge badge-warning badge-sm gap-1">
              <WifiOff className="size-3" />
              {t('common.offline')}
            </span>
          )}
          <nav className={`ml-auto hidden gap-1 sm:flex ${accountsActive ? '[&>a:first-child]:btn-neutral' : ''}`}>
            {items.map((i) => (
              <NavItem key={i.to} {...i} variant="bar" />
            ))}
          </nav>
        </div>
      </div>
      <UpdateBanner />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-5 pb-28 sm:pb-10">
        <Outlet />
      </main>
      <nav
        className={`dock dock-sm border-base-300 bg-base-100 z-20 border-t sm:hidden ${
          accountsActive ? '[&>a:first-child]:text-primary' : ''
        }`}
      >
        {items.map((i) => (
          <NavItem key={i.to} {...i} variant="dock" />
        ))}
      </nav>
    </div>
  );
};
