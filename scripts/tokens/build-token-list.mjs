// Generates the built-in token snapshot (src/lib/tokens/builtin.json) and the list of
// Hyperliquid coin symbols used to pick built-in icons (scripts/tokens/hl-symbols.json).
// Usage: npm run tokens:list   (needs network; Node >= 23.6 for TypeScript imports)
import { writeFileSync } from 'node:fs';
import { CHAINS } from '../../src/config/chains.ts';
import { deriveHyperEvmTokens, packTokens, parseTokenList, withEssentials } from '../../src/lib/tokens/sanitize.ts';

const LIST_URLS = ['https://tokens.uniswap.org', 'https://ipfs.io/ipns/tokens.uniswap.org'];
const HL_API = { mainnet: 'https://api.hyperliquid.xyz/info', testnet: 'https://api.hyperliquid-testnet.xyz/info' };

const getJson = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};
const hlInfo = (env, type) =>
  getJson(HL_API[env], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type }) });

let listJson;
for (const url of LIST_URLS) {
  try {
    listJson = await getJson(url);
    break;
  } catch (e) {
    console.warn(String(e));
  }
}
if (!listJson) throw new Error('Token list is unreachable');

const evmChains = CHAINS.filter((c) => c.key !== 'hyperevm');
const parsed = parseTokenList(listJson, evmChains.map((c) => c.id));
const chains = {};
for (const chain of CHAINS) {
  const base =
    chain.key === 'hyperevm'
      ? deriveHyperEvmTokens(await hlInfo(chain.env, 'spotMeta'), chain.id)
      : (parsed.byChain.get(chain.id) ?? []);
  chains[chain.id] = packTokens(withEssentials(base, chain));
  console.log(`${chain.name}: ${chains[chain.id].length} tokens`);
}

const out = { version: parsed.version, generatedAt: Date.parse(listJson.timestamp) || Date.now(), chains };
writeFileSync(new URL('../../src/lib/tokens/builtin.json', import.meta.url), `${JSON.stringify(out)}\n`);

const [spot, perps] = await Promise.all([hlInfo('mainnet', 'spotMeta'), hlInfo('mainnet', 'meta')]);
const symbols = [...new Set([...spot.tokens.map((t) => t.name), ...perps.universe.map((u) => u.name)])].sort();
writeFileSync(new URL('./hl-symbols.json', import.meta.url), `${JSON.stringify(symbols)}\n`);
console.log(`Hyperliquid symbols: ${symbols.length}`);
