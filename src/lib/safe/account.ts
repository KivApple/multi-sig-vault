import { formatUnits, type Address, type ContractFunctionParameters } from 'viem';
import { getChain, HL_EVM_CHAIN } from '@/config/chains';
import { MULTICALL3 } from '@/config/constants';
import { dexWeth, quoteMany } from '@/lib/evm/dex';
import { sameAddress } from '@/lib/format';
import { fetchHlMarket } from '@/lib/hl/account';
import { getPublicClient } from '@/lib/rpc';
import { getTokens } from '@/lib/tokens';
import type { AssetRow, TokenInfo } from '@/types/domain';
import { ERC20_ABI, MULTICALL_ABI } from './abis';
import { fetchSafeInfo, type SafeInfo } from './info';

export interface Holding {
  /** `undefined` – native coin. */
  token?: TokenInfo;
  symbol: string;
  decimals: number;
  /** Raw units, decimal string. */
  balance: string;
  usd: number;
}

export interface SafeAccountData extends SafeInfo {
  totalUsd: number;
  holdings: Holding[];
  assets: AssetRow[];
}

const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'USDT0', 'USD₮0', 'DAI', 'USDS', 'USDE', 'USDH', 'PYUSD', 'USDC.E', 'USDBC']);

/** USD value of holdings from on-chain sources of the same network (testnets give toy prices – by design). */
const priceHoldings = async (chainId: number, holdings: Holding[]): Promise<void> => {
  const chain = getChain(chainId);
  const priced = (h: Holding, price: number): void => {
    h.usd = Number(formatUnits(BigInt(h.balance), h.decimals)) * price;
  };

  if (chain.key === 'hyperevm') {
    // HyperEVM tokens are linked to HyperCore spot tokens – use the exchange's own prices.
    const market = await fetchHlMarket(chain.env).catch(() => undefined);
    if (!market) return;
    const byAddress = new Map<string, number>();
    let hype = 0;
    for (const t of market.tokens) {
      const price = market.prices[t.index];
      if (price === undefined) continue;
      if (t.name === 'HYPE') hype = price;
      if (t.evmContract) byAddress.set(t.evmContract.address.toLowerCase(), price);
    }
    for (const h of holdings) {
      if (!h.token || sameAddress(h.token.address, chain.wrappedNative)) priced(h, hype);
      else if (sameAddress(h.token.address, chain.usdc)) priced(h, 1);
      else priced(h, byAddress.get(h.token.address.toLowerCase()) ?? 0);
    }
    return;
  }

  const usdc = chain.usdc;
  const pending: Holding[] = [];
  for (const h of holdings) {
    if (h.token && usdc && sameAddress(h.token.address, usdc)) priced(h, 1);
    else if (chain.dex && usdc) pending.push(h);
    else if (STABLE_SYMBOLS.has(h.symbol.toUpperCase())) priced(h, 1);
  }
  if (pending.length === 0 || !usdc) return;
  const quotes = await quoteMany(
    chainId,
    pending.map((h) => ({ tokenIn: h.token?.address ?? dexWeth(chain), tokenOut: usdc, amountIn: BigInt(h.balance) })),
  ).catch(() => pending.map(() => null));
  pending.forEach((h, i) => {
    const q = quotes[i];
    if (q) h.usd = Number(formatUnits(q.amountOut, 6));
    else if (STABLE_SYMBOLS.has(h.symbol.toUpperCase())) priced(h, 1);
  });
};

/** Safe configuration plus balances of the native coin and every token of the token list. */
export const fetchSafeAccount = async (chainId: number, address: Address): Promise<SafeAccountData> => {
  const chain = getChain(chainId);
  const client = getPublicClient(chainId);
  const tokens = getTokens(chainId);
  const [info, results] = await Promise.all([
    fetchSafeInfo(chainId, address),
    client.multicall({
      contracts: [
        { address: MULTICALL3, abi: MULTICALL_ABI, functionName: 'getEthBalance', args: [address] },
        ...tokens.map((t) => ({ address: t.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] })),
      ] as ContractFunctionParameters[],
      allowFailure: true,
      batchSize: 16_384,
    }),
  ]);

  const holdings: Holding[] = [];
  const native = results[0];
  holdings.push({
    symbol: chain.nativeSymbol,
    decimals: 18,
    balance: (native.status === 'success' ? (native.result as bigint) : 0n).toString(),
    usd: 0,
  });
  tokens.forEach((token, i) => {
    const r = results[i + 1];
    if (r.status === 'success' && (r.result as bigint) > 0n) {
      holdings.push({ token, symbol: token.symbol, decimals: token.decimals, balance: (r.result as bigint).toString(), usd: 0 });
    }
  });

  await priceHoldings(chainId, holdings.filter((h) => h.balance !== '0')).catch(() => undefined);

  const assets: AssetRow[] = holdings
    .filter((h) => h.balance !== '0')
    .map((h) => ({
      key: h.token ? h.token.address.toLowerCase() : 'native',
      symbol: h.symbol,
      name: h.token?.name ?? chain.nativeName,
      amount: formatUnits(BigInt(h.balance), h.decimals),
      usd: h.usd,
      kind: h.token ? 'token' : 'native',
      icon: { chainId, address: h.token?.address, symbol: h.symbol },
    }));

  return { ...info, holdings, assets, totalUsd: holdings.reduce((sum, h) => sum + h.usd, 0) };
};

/** Native coin balances of several addresses in one call (signer picker). */
export const fetchNativeBalances = async (chainId: number, addresses: Address[]): Promise<Record<string, string>> => {
  if (addresses.length === 0) return {};
  const results = await getPublicClient(chainId).multicall({
    contracts: addresses.map(
      (a) => ({ address: MULTICALL3, abi: MULTICALL_ABI, functionName: 'getEthBalance', args: [a] }) as const,
    ),
    allowFailure: true,
  });
  const out: Record<string, string> = {};
  addresses.forEach((a, i) => {
    const r = results[i];
    if (r.status === 'success') out[a.toLowerCase()] = (r.result as bigint).toString();
  });
  return out;
};

export const hyperEvmChainOf = (env: 'mainnet' | 'testnet'): number => HL_EVM_CHAIN[env];
