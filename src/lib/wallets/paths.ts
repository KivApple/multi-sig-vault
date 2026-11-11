import type { DerivationScheme } from './types';

/** Ledger Live: one hardened account per address. */
export const ledgerLivePath = (index: number): string => `m/44'/60'/${index}'/0/0`;
/** Ledger legacy (MEW / old Ledger Chrome app). */
export const ledgerLegacyPath = (index: number): string => `m/44'/60'/0'/${index}`;
/** BIP-44 standard used by Trezor Suite and MetaMask. */
export const bip44Path = (index: number): string => `m/44'/60'/0'/0/${index}`;

export const LEDGER_SCHEMES: DerivationScheme[] = [
  { id: 'ledger-live', labelKey: 'wallets.scheme.ledgerLive', path: ledgerLivePath },
  { id: 'legacy', labelKey: 'wallets.scheme.ledgerLegacy', path: ledgerLegacyPath },
  { id: 'bip44', labelKey: 'wallets.scheme.bip44', path: bip44Path },
];

export const TREZOR_SCHEMES: DerivationScheme[] = [
  { id: 'bip44', labelKey: 'wallets.scheme.trezorSuite', path: bip44Path },
  { id: 'ledger-live', labelKey: 'wallets.scheme.ledgerLiveStyle', path: ledgerLivePath },
];

export const resolveScheme = (schemes: DerivationScheme[], id?: string): DerivationScheme =>
  schemes.find((s) => s.id === id) ?? schemes[0];

/** `m/44'/60'/0'/0/0` → `44'/60'/0'/0/0` (format expected by Ledger). */
export const stripMasterPrefix = (path: string): string => path.replace(/^m\//, '');

export const DEFAULT_PAGE = 5;
