import { createPublicClient, defineChain, fallback, http, type Chain, type PublicClient } from 'viem';
import { getChain } from '@/config/chains';
import { MULTICALL3 } from '@/config/constants';
import { useAppStore } from '@/store/appStore';

const clients = new Map<string, PublicClient>();

export const viemChain = (chainId: number): Chain => {
  const c = getChain(chainId);
  return defineChain({
    id: c.id,
    name: c.name,
    nativeCurrency: { name: c.nativeName, symbol: c.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: c.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: c.explorer } },
    contracts: { multicall3: { address: MULTICALL3 } },
    testnet: c.env === 'testnet',
  });
};

export const rpcUrlsFor = (chainId: number): string[] => {
  const override = useAppStore.getState().settings.rpcOverrides[String(chainId)]?.trim();
  const defaults = getChain(chainId).rpcUrls;
  return override ? [override, ...defaults] : defaults;
};

/** Read client with endpoint fallback; honours the custom RPC from settings. */
export const getPublicClient = (chainId: number): PublicClient => {
  const urls = rpcUrlsFor(chainId);
  const key = `${chainId}|${urls[0]}`;
  let client = clients.get(key);
  if (!client) {
    client = createPublicClient({
      chain: viemChain(chainId),
      transport: fallback(
        urls.map((url) => http(url, { timeout: 15_000, retryCount: 1 })),
        { rank: false },
      ),
    });
    clients.set(key, client);
  }
  return client;
};

/**
 * Client used to broadcast raw transactions signed by hardware wallets.
 * With MEV protection on, chains that have a private endpoint use only that endpoint.
 */
export const getBroadcastClient = (chainId: number): PublicClient => {
  const { mevProtection } = useAppStore.getState().settings;
  const mev = getChain(chainId).mevRpcUrl;
  if (!mevProtection || !mev) return getPublicClient(chainId);
  const key = `${chainId}|mev`;
  let client = clients.get(key);
  if (!client) {
    client = createPublicClient({ chain: viemChain(chainId), transport: http(mev, { timeout: 20_000 }) });
    clients.set(key, client);
  }
  return client;
};
