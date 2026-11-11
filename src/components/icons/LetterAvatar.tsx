import type { CSSProperties } from 'react';
import { symbolHue } from '@/lib/tokens/symbols';

export interface LetterAvatarProps {
  symbol: string;
  size: number;
  className?: string;
}

/** Fallback token icon: first letters on a colour derived from the symbol (fixed colours – readable on any theme). */
export const LetterAvatar: React.FC<LetterAvatarProps> = ({ symbol, size, className }) => {
  const letters = symbol.replace(/[^\p{L}\p{N}]/gu, '').slice(0, size >= 32 ? 3 : 2) || '?';
  const style: CSSProperties = {
    width: size,
    height: size,
    background: `hsl(${symbolHue(symbol)} 45% 42%)`,
    fontSize: size * (letters.length > 2 ? 0.3 : 0.38),
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full align-middle leading-none font-semibold text-white uppercase select-none ${className ?? ''}`}
      style={style}
      aria-hidden="true"
    >
      {letters}
    </span>
  );
};
