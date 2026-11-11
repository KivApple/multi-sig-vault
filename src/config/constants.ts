import type { Address } from 'viem';

export const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';
export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** Balances and account info are refreshed at this interval while visible. */
export const REFRESH_INTERVAL_MS = 30_000;
/** Assets below this USD value are "dust". */
export const DUST_USD = 1;
export const TOKEN_LIST_UPDATE_INTERVAL_MS = 7 * 24 * 3600 * 1000;

export const APP_VERSION: string = import.meta.env.PUBLIC_APP_VERSION ?? 'dev';
