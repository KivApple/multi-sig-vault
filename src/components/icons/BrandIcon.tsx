import hyperliquid from '@/assets/icons/brand/hyperliquid.svg';
import safe from '@/assets/icons/brand/safe.svg';
import { IconChip } from './IconChip';

export type BrandName = 'hyperliquid' | 'safe';

export interface BrandIconProps {
  name: BrandName;
  size?: number;
  className?: string;
}

export const BRAND_SRC: Record<BrandName, string> = { hyperliquid, safe };

export const BrandIcon: React.FC<BrandIconProps> = ({ name, size = 24, className }) => (
  <IconChip src={BRAND_SRC[name]} size={size} shape="squircle" className={className} />
);
