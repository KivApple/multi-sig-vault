import { formatUnits, type Address, type ContractFunctionParameters } from "viem";
import { getChain, HL_EVM_CHAIN } from "@/config/chains";
import { MULTICALL3 } from "@/config/constants";
import { dexWeth, quoteMany } from "@/lib/evm/dex";
import { sameAddress } from "@/lib/format";
import { fetchHlMarket } from "@/lib/hl/account";
import { getPublicClient } from "@/lib/rpc";
import { getTokens } from "@/lib/tokens";
import type { AssetRow, TokenInfo } from "@/types/domain";
import { ERC20_ABI, MULTICALL_ABI } from "./abis";
import { fetchSafeInfo, type SafeInfo } from "./info";

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

const STABLE_SYMBOLS = new Set([
	"USDC",
	"USDT",
	"USDT0",
	"USD₮0",
	"DAI",
	"USDS",
	"USDE",
	"USDH",
	"PYUSD",
	"USDC.E",
	"USDBC",
]);

/** USD value of holdings from on-chain sources of the same network (testnets give toy prices – by design). */
const priceHoldings = async (chainId: number, holdings: Holding[]): Promise<void> => {
	const chain = getChain(chainId);
	const priced = (h: Holding, price: number): void => {
		h.usd = Number(formatUnits(BigInt(h.balance), h.decimals)) * price;
	};

	if (chain.key === "hyperevm") {
		// HyperEVM tokens are linked to HyperCore spot tokens – use the exchange's own prices.
		const market = await fetchHlMarket(chain.env).catch(() => undefined);
		if (!market) return;
		const byAddress = new Map<string, number>();
		let hype = 0;
		for (const t of market.tokens) {
			const price = market.prices[t.index];
			if (price === undefined) continue;
			if (t.name === "HYPE") hype = price;
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
	// Two quotes per token: the whole balance (what a sale would really return) and a 1/1000 probe
	// scaled back up (spot price). The larger one is shown, so thin pools do not zero out a holding.
	const PROBE = 1000n;
	const tokenIn = (h: Holding): Address => h.token?.address ?? dexWeth(chain);
	const quotes = await quoteMany(chainId, [
		...pending.map((h) => ({ tokenIn: tokenIn(h), tokenOut: usdc, amountIn: BigInt(h.balance) })),
		...pending.map((h) => ({ tokenIn: tokenIn(h), tokenOut: usdc, amountIn: BigInt(h.balance) / PROBE })),
	]).catch(() => [] as Awaited<ReturnType<typeof quoteMany>>[number][]);
	pending.forEach((h, i) => {
		const full = quotes[i]?.amountOut ?? 0n;
		const spot = (quotes[i + pending.length]?.amountOut ?? 0n) * PROBE;
		const best = full > spot ? full : spot;
		if (best > 0n) h.usd = Number(formatUnits(best, 6));
		else if (STABLE_SYMBOLS.has(h.symbol.toUpperCase())) priced(h, 1);
	});
};

/** Safe configuration plus balances of the native coin and every token of the token list. */
export const fetchSafeAccount = async (chainId: number, address: Address): Promise<SafeAccountData> => {
	const chain = getChain(chainId);
	const client = getPublicClient(chainId);
	const tokens = getTokens(chainId);
	// The native balance is read on its own so that a misbehaving token can never hide it;
	// token balances go in moderate multicall chunks (a single huge call can exceed node gas caps).
	const balanceCalls = (list: TokenInfo[]): ContractFunctionParameters[] =>
		list.map((t) => ({
			address: t.address,
			abi: ERC20_ABI,
			functionName: "balanceOf",
			args: [address],
		})) as ContractFunctionParameters[];
	const [info, nativeBalance, results] = await Promise.all([
		fetchSafeInfo(chainId, address),
		client.getBalance({ address }),
		client.multicall({ contracts: balanceCalls(tokens), allowFailure: true, batchSize: 2048 }),
	]);
	// A whole chunk fails when the node chokes on it – ask again for those tokens in small chunks,
	// so a flaky endpoint does not make balances silently disappear.
	const failed = results.map((r, i) => (r.status === "failure" ? i : -1)).filter((i) => i >= 0);
	if (failed.length > 0) {
		const retry = await client
			.multicall({ contracts: balanceCalls(failed.map((i) => tokens[i])), allowFailure: true, batchSize: 256 })
			.catch(() => []);
		retry.forEach((r, k) => {
			results[failed[k]] = r;
		});
	}

	const holdings: Holding[] = [];
	holdings.push({ symbol: chain.nativeSymbol, decimals: 18, balance: nativeBalance.toString(), usd: 0 });
	tokens.forEach((token, i) => {
		const r = results[i];
		if (r.status === "success" && (r.result as bigint) > 0n) {
			holdings.push({
				token,
				symbol: token.symbol,
				decimals: token.decimals,
				balance: (r.result as bigint).toString(),
				usd: 0,
			});
		}
	});

	await priceHoldings(
		chainId,
		holdings.filter((h) => h.balance !== "0"),
	).catch(() => undefined);

	const assets: AssetRow[] = holdings
		.filter((h) => h.balance !== "0")
		.map((h) => ({
			key: h.token ? h.token.address.toLowerCase() : "native",
			symbol: h.symbol,
			name: h.token?.name ?? chain.nativeName,
			amount: formatUnits(BigInt(h.balance), h.decimals),
			usd: h.usd,
			kind: h.token ? "token" : "native",
			icon: { chainId, address: h.token?.address, symbol: h.symbol },
		}));

	return { ...info, holdings, assets, totalUsd: holdings.reduce((sum, h) => sum + h.usd, 0) };
};

/** Native coin balances of several addresses in one call (signer picker). */
export const fetchNativeBalances = async (chainId: number, addresses: Address[]): Promise<Record<string, string>> => {
	if (addresses.length === 0) return {};
	const results = await getPublicClient(chainId).multicall({
		contracts: addresses.map(
			(a) => ({ address: MULTICALL3, abi: MULTICALL_ABI, functionName: "getEthBalance", args: [a] }) as const,
		),
		allowFailure: true,
	});
	const out: Record<string, string> = {};
	addresses.forEach((a, i) => {
		const r = results[i];
		if (r.status === "success") out[a.toLowerCase()] = (r.result as bigint).toString();
	});
	return out;
};

export const hyperEvmChainOf = (env: "mainnet" | "testnet"): number => HL_EVM_CHAIN[env];
