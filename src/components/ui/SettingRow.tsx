import type { ReactNode } from 'react';

export interface SettingRowProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Control on the right (toggle, select, button). */
  control?: ReactNode;
  /** Full-width content under the label. */
  children?: ReactNode;
}

export const SettingRow: React.FC<SettingRowProps> = ({ label, hint, control, children }) => (
  <div className="px-4 py-3">
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-base-content/60 mt-0.5 text-xs">{hint}</div>}
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </div>
    {children && <div className="mt-3">{children}</div>}
  </div>
);
