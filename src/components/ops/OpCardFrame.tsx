import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface OpCardFrameProps {
  icon: LucideIcon;
  title: string;
  /** Badges after the title (queue number, status). */
  badges?: ReactNode;
  /** Buttons in the header's right corner. */
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  tone?: 'default' | 'success';
}

/** Shared shell of every operation card. */
export const OpCardFrame: React.FC<OpCardFrameProps> = ({ icon: Icon, title, badges, actions, children, footer, tone }) => (
  <article className={`card-surface ${tone === 'success' ? 'border-success/40' : ''}`}>
    <header className="flex items-center gap-2 px-4 pt-3">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
          tone === 'success' ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary'
        }`}
      >
        <Icon className="size-4" />
      </span>
      <h3 className="min-w-0 flex-1 truncate font-semibold">{title}</h3>
      {badges}
      {actions && <div className="-mr-2 flex items-center">{actions}</div>}
    </header>
    <div className="flex flex-col gap-4 px-4 py-3">{children}</div>
    {footer && <footer className="border-base-300 flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">{footer}</footer>}
  </article>
);
