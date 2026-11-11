import { Globe } from 'lucide-react';
import arbitrum from '@/assets/icons/network/arbitrum.svg';
import base from '@/assets/icons/network/base.svg';
import ethereum from '@/assets/icons/network/ethereum.svg';
import hyperevm from '@/assets/icons/network/hyperevm.svg';
import { findChain, type ChainKey } from '@/config/chains';
import { IconChip } from './IconChip';

export interface NetworkIconProps {
  chainId: number;
  size?: number;
  className?: string;
}

const SRC: Record<ChainKey, string> = { ethereum, arbitrum, base, hyperevm };

/** Network mark; a testnet uses the mark of its mainnet. */
export const NetworkIcon: React.FC<NetworkIconProps> = ({ chainId, size = 24, className }) => {
  const chain = findChain(chainId);
  if (!chain) {
    return (
      <span
        className={`bg-base-300 text-base-content/60 inline-flex shrink-0 items-center justify-center rounded-full align-middle ${className ?? ''}`}
        style={{ width: size, height: size }}
      >
        <Globe style={{ width: size * 0.62, height: size * 0.62 }} />
      </span>
    );
  }
  return <IconChip src={SRC[chain.key]} size={size} shape="circle" className={className} />;
};
