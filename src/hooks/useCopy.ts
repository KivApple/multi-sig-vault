import { useCallback } from 'react';
import { useT } from '@/i18n';
import { toast } from '@/lib/toast';

/** Copies text to the clipboard and confirms with a toast. */
export const useCopy = (): ((text: string, message?: string) => Promise<void>) => {
  const t = useT();
  return useCallback(
    async (text: string, message?: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(message ?? t('common.copied'));
      } catch {
        toast.error(t('common.copyFailed'));
      }
    },
    [t],
  );
};
