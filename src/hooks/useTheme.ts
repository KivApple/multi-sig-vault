import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';

const THEME_COLOR = { light: '#f6f8f7', dark: '#0f1513' } as const;

/** Applies the theme setting to `<html data-theme>` and keeps the browser chrome colour in sync. */
export const useTheme = (): void => {
  const theme = useAppStore((s) => s.settings.theme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved]);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
};
