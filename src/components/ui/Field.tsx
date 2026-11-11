import type { ReactNode } from 'react';

export interface FieldProps {
  label?: ReactNode;
  /** Shown under the control; replaced by `error` when present. */
  hint?: ReactNode;
  error?: ReactNode;
  /** Right aligned element in the label row (e.g. "Balance: 12"). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Label + control + hint/error – the one layout for every form control in the app. */
export const Field: React.FC<FieldProps> = ({ label, hint, error, aside, children, className }) => (
  <div className={`flex flex-col ${className ?? ''}`}>
    {(label || aside) && (
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-base-content/60 text-xs font-medium tracking-wide uppercase">{label}</span>
        {aside && <span className="text-base-content/60 text-xs">{aside}</span>}
      </div>
    )}
    {children}
    {error ? (
      <p className="text-error mt-1 text-xs">{error}</p>
    ) : (
      hint && <p className="text-base-content/60 mt-1 text-xs">{hint}</p>
    )}
  </div>
);
