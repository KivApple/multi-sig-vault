import { ChevronRight } from 'lucide-react';
import { useCallback } from 'react';
import { WalletIcon } from '@/components/icons/WalletIcon';
import type { WalletKind } from '@/types/domain';

export interface WalletTypeButtonProps {
  kind: WalletKind;
  label: string;
  hint: string;
  onSelect: (kind: WalletKind) => void;
}

export const WalletTypeButton: React.FC<WalletTypeButtonProps> = ({ kind, label, hint, onSelect }) => {
  const handleClick = useCallback(() => onSelect(kind), [kind, onSelect]);
  return (
    <button
      type="button"
      className="card-surface hover:border-primary flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      onClick={handleClick}
    >
      <WalletIcon kind={kind} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="text-base-content/60 block text-sm">{hint}</span>
      </span>
      <ChevronRight className="text-base-content/40 size-5 shrink-0" />
    </button>
  );
};
