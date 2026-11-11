import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  ariaLabel?: string;
}

/** Compact single-choice control for 2–4 options. */
export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  disabled,
  ariaLabel,
}: SegmentedProps<T>): React.ReactElement => (
  <div className="join w-full" role="radiogroup" aria-label={ariaLabel}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={o.value === value}
        disabled={disabled}
        className={`btn join-item min-w-0 flex-1 ${size === 'sm' ? 'btn-sm' : ''} ${
          o.value === value ? 'btn-primary' : 'btn-outline border-base-300'
        }`}
        onClick={() => onChange(o.value)}
      >
        {o.label}
      </button>
    ))}
  </div>
);
