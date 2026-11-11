import { formatUnits, getAddress, isAddress, type Address } from 'viem';

/** MetaMask style: first and last 5 characters after `0x`. */
export const shortAddress = (address: string): string =>
  address.length > 14 ? `${address.slice(0, 7)}…${address.slice(-5)}` : address;

export const sameAddress = (a?: string | null, b?: string | null): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export const toChecksum = (address: string): Address => getAddress(address);

export const parseAddress = (value: string): Address | undefined => {
  const v = value.trim();
  return isAddress(v, { strict: false }) ? getAddress(v) : undefined;
};

export const formatUsd = (value: number, lang: string, compact = false): string => {
  const abs = Math.abs(value);
  return new Intl.NumberFormat(lang, {
    style: 'currency',
    currency: 'USD',
    notation: compact && abs >= 1e6 ? 'compact' : 'standard',
    minimumFractionDigits: compact && abs >= 1e6 ? 2 : abs >= 1000 ? 0 : 2,
    maximumFractionDigits: compact && abs >= 1e6 ? 2 : abs >= 1000 ? 0 : 2,
  }).format(value);
};

/** Human readable token amount with a sensible number of significant digits. */
export const formatAmount = (value: string | number, lang: string, maxFraction = 6): string => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : maxFraction;
  const out = new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(n);
  return out === '0' && abs > 0 ? `<${(10 ** -digits).toFixed(digits)}` : out;
};

export const formatTokenUnits = (raw: bigint, decimals: number, lang: string): string =>
  formatAmount(formatUnits(raw, decimals), lang);

/** Strips trailing zeros from a decimal string: `1.500` → `1.5`, `2.0` → `2`. */
export const trimDecimal = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;

export const isDecimal = (value: string, maxDecimals: number): boolean => {
  if (!/^\d+(\.\d+)?$/.test(value)) return false;
  const frac = value.split('.')[1];
  return !frac || frac.length <= maxDecimals;
};

export const formatDateTime = (ts: number, lang: string): string =>
  new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(ts);

export const formatRelative = (ts: number, lang: string, now = Date.now()): string => {
  const diff = Math.round((ts - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.trunc(diff), 'second');
  if (abs < 3600) return rtf.format(Math.trunc(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.trunc(diff / 3600), 'hour');
  return rtf.format(Math.trunc(diff / 86400), 'day');
};

export const uuid = (): string => crypto.randomUUID();
