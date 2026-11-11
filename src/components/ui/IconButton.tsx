import { useCallback, type MouseEvent, type ReactNode } from 'react';

export interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  active?: boolean;
}

/** Square ghost button with an accessible label; stops propagation so it works inside clickable cards. */
export const IconButton: React.FC<IconButtonProps> = ({ label, onClick, children, className, disabled, active }) => {
  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    },
    [onClick],
  );
  return (
    <button
      type="button"
      className={`btn btn-sm btn-square ${active ? 'btn-primary' : 'btn-ghost'} ${className ?? ''}`}
      onClick={handleClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={active}
    >
      {children}
    </button>
  );
};
