import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useToastStore, type ToastKind } from '@/lib/toast';

const STYLE: Record<ToastKind, string> = {
  success: 'alert-success',
  error: 'alert-error',
  info: 'alert-info',
};

const ICON: Record<ToastKind, React.FC<{ className?: string }>> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
};

/** Toasts live in a manual popover so they stay above modal dialogs (top layer). */
export const Toaster: React.FC = () => {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el?.showPopover) return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      if (items.length > 0) el.showPopover();
    } catch {
      // Popover API unavailable – toasts still render in normal flow.
    }
  }, [items]);

  return (
    <div
      ref={ref}
      popover="manual"
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 bottom-auto m-0 w-full max-w-none border-0 bg-transparent p-3"
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-2">
        {items.map((item) => {
          const Icon = ICON[item.kind];
          return (
            <button
              type="button"
              key={item.id}
              className={`alert ${STYLE[item.kind]} pointer-events-auto w-full cursor-pointer text-left shadow-lg`}
              onClick={() => dismiss(item.id)}
            >
              <Icon className="size-5 shrink-0" />
              <span className="min-w-0 break-words">{item.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
