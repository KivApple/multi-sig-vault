import type { Address } from 'viem';
import { getChain } from '@/config/chains';
import { sameAddress } from '@/lib/format';
import type { Account, NetworkEnv, Signer } from '@/types/domain';

/** Where an address is going to be used – decides which accounts are relevant. */
export type AddressScope = { chainId: number } | { hlEnv: NetworkEnv } | Record<string, never>;

export interface KnownAddress {
  address: Address;
  signer?: Signer;
  account?: Account;
}

const accountInScope = (a: Account, scope: AddressScope): boolean => {
  if ('chainId' in scope) return a.kind === 'safe' && a.chainId === scope.chainId;
  if ('hlEnv' in scope) return a.kind === 'hl' && a.env === scope.hlEnv;
  return true;
};

export const resolveKnown = (
  address: string,
  signers: Signer[],
  accounts: Account[],
  scope: AddressScope = {},
): KnownAddress | undefined => {
  const account = accounts.find((a) => sameAddress(a.address, address) && accountInScope(a, scope));
  const signer = signers.find((s) => sameAddress(s.address, address));
  if (!account && !signer) return undefined;
  return { address: (account ?? signer)?.address as Address, signer, account };
};

/** Addresses offered as recipients: signers first, then accounts living where the funds arrive. */
export const knownRecipients = (
  signers: Signer[],
  accounts: Account[],
  scope: AddressScope,
  exclude?: string,
): KnownAddress[] => {
  const out: KnownAddress[] = [];
  for (const account of accounts) {
    if (!accountInScope(account, scope) || sameAddress(account.address, exclude)) continue;
    out.push({ address: account.address, account });
  }
  for (const signer of signers) {
    if (sameAddress(signer.address, exclude) || out.some((k) => sameAddress(k.address, signer.address))) continue;
    out.push({ address: signer.address, signer });
  }
  return out;
};

export const accountTitle = (account: Account, short: (a: string) => string): string =>
  account.name?.trim() || short(account.address);

export const accountNetworkName = (account: Account): string =>
  account.kind === 'hl'
    ? account.env === 'mainnet'
      ? 'Hyperliquid'
      : 'Hyperliquid Testnet'
    : getChain(account.chainId as number).name;
