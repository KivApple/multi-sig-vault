import { shortAddress } from '@/lib/format';

export interface AddressTextProps {
  address: string;
  /** Show the whole address (wraps on small screens). */
  full?: boolean;
  className?: string;
}

export const AddressText: React.FC<AddressTextProps> = ({ address, full, className }) => (
  <span className={`mono ${full ? 'break-all' : 'whitespace-nowrap'} ${className ?? ''}`} title={address}>
    {full ? address : shortAddress(address)}
  </span>
);
