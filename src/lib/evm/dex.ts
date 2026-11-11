import { encodePacked, parseAbi, type Address, type Hex } from 'viem';
import { getChain, type ChainConfig } from '@/config/chains';
import { getPublicClient } from '@/lib/rpc';
import { sameAddress } from '@/lib/format';

export const QUOTER_ABI = parseAbi([
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
]);

export const ROUTER02_ABI = parseAbi([
  'struct ExactInputParams { bytes path; address recipient; uint256 amountIn; uint256 amountOutMinimum; }',
  'function exactInput(ExactInputParams params) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
]);

/** Wrapped native token as the chain's DEX knows it. */
export const dexWeth = (chain: ChainConfig): Address => chain.dex?.weth ?? chain.wrappedNative;

export interface Route {
  /** Token addresses along the path (wrapped native for the native coin). */
  tokens: Address[];
  /** Pool fee for every hop, in hundredths of a bip. */
  fees: number[];
}

export interface Quote extends Route {
  amountOut: bigint;
}

export const encodePath = (route: Route): Hex => {
  const types: string[] = ['address'];
  const values: (Address | number)[] = [route.tokens[0]];
  route.fees.forEach((fee, i) => {
    types.push('uint24', 'address');
    values.push(fee, route.tokens[i + 1]);
  });
  return encodePacked(types, values);
};

/**
 * Candidate routes: direct pools of every fee tier, plus two-hop routes through the wrapped native
 * coin and through USDC. `fee` pins the fee tier of the first hop (user override).
 */
export const candidateRoutes = (chain: ChainConfig, tokenIn: Address, tokenOut: Address, fee?: number): Route[] => {
  const dex = chain.dex;
  if (!dex || sameAddress(tokenIn, tokenOut)) return [];
  const tiers = fee ? [fee] : dex.feeTiers;
  const routes: Route[] = tiers.map((f) => ({ tokens: [tokenIn, tokenOut], fees: [f] }));
  const mids = [dex.weth ?? chain.wrappedNative, chain.usdc].filter(
    (m): m is Address => !!m && !sameAddress(m, tokenIn) && !sameAddress(m, tokenOut),
  );
  const secondTiers = dex.feeTiers.filter((f) => f === 500 || f === 3000);
  for (const mid of mids) {
    for (const a of tiers) {
      for (const b of secondTiers) routes.push({ tokens: [tokenIn, mid, tokenOut], fees: [a, b] });
    }
  }
  return routes;
};

export interface QuoteRequest {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  fee?: number;
}

/** Best on-chain quote per request, straight from the pools (no third-party API). */
export const quoteMany = async (chainId: number, requests: QuoteRequest[]): Promise<(Quote | null)[]> => {
  const chain = getChain(chainId);
  if (!chain.dex) return requests.map(() => null);
  const quoter = chain.dex.quoter;
  const flat: { req: number; route: Route; amountIn: bigint }[] = [];
  requests.forEach((r, req) => {
    if (r.amountIn <= 0n) return;
    for (const route of candidateRoutes(chain, r.tokenIn, r.tokenOut, r.fee)) flat.push({ req, route, amountIn: r.amountIn });
  });
  if (flat.length === 0) return requests.map(() => null);
  const results = await getPublicClient(chainId).multicall({
    contracts: flat.map((f) => ({
      address: quoter,
      abi: QUOTER_ABI,
      functionName: 'quoteExactInput' as const,
      args: [encodePath(f.route), f.amountIn] as const,
    })),
    allowFailure: true,
    batchSize: 2048,
  });
  const best: (Quote | null)[] = requests.map(() => null);
  results.forEach((res, i) => {
    if (res.status !== 'success') return;
    const amountOut = (res.result as readonly [bigint, ...unknown[]])[0];
    const { req, route } = flat[i];
    const current = best[req];
    if (amountOut > 0n && (!current || amountOut > current.amountOut)) best[req] = { ...route, amountOut };
  });
  return best;
};

export const quoteBest = async (chainId: number, request: QuoteRequest): Promise<Quote | null> =>
  (await quoteMany(chainId, [request]))[0];
