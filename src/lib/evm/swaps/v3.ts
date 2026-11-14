import { encodeFunctionData, getAddress, type Hex } from "viem";
import type { ChainConfig } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { sameAddress } from "@/lib/format";
import { getPublicClient } from "@/lib/rpc";
import { ERC20_ABI } from "@/lib/safe/abis";
import type { MetaTx } from "@/lib/safe/tx";
import { encodePath, quoteMany, ROUTER02_ABI } from "../dex";
import { mismatch } from "../mismatch";
import type { SwapProvider } from "./types";

/** Signatures may take hours to collect – the swap stays valid this long after preparation. */
export const SWAP_DEADLINE_SECONDS = 48 * 3600;

export const applySlippage = (amountOut: bigint, bps: number): bigint => (amountOut * BigInt(10_000 - bps)) / 10_000n;

const dexOf = (chain: ChainConfig): NonNullable<ChainConfig["dex"]> => {
	if (!chain.dex) throw new AppError("swap.error.noDex");
	return chain.dex;
};

/**
 * A Uniswap-V3 style router (SwapRouter02 and its forks: HyperSwap, PancakeSwap's SmartRouter),
 * quoted straight from the pools through the network's QuoterV2.
 */
export const v3Swap: SwapProvider = {
	id: "v3",
	available: (chain) => !!chain.dex,
	name: (chain) => chain.dex?.name ?? "",
	resolve: async ({ chain, tokenIn, tokenOut, nativeIn, amountIn, safe }, { slippageBps, feeTier }) => {
		const dex = dexOf(chain);
		const probe = amountIn / 1000n;
		const request = { tokenIn, tokenOut, fee: feeTier };
		const [quote, small] = await quoteMany(chain.id, [
			{ ...request, amountIn },
			{ ...request, amountIn: probe },
		]);
		if (!quote) throw new AppError("swap.error.noRoute");
		const minOut = applySlippage(quote.amountOut, slippageBps);
		if (minOut <= 0n) throw new AppError("swap.error.noRoute");
		let impactBps: number | undefined;
		if (small && small.amountOut > 0n && probe > 0n) {
			// Output per unit at a 1000× smaller size approximates the pool price.
			const ideal = small.amountOut * 1000n;
			impactBps = Math.max(0, Number(((ideal - quote.amountOut) * 10_000n) / ideal));
		}
		let resetAllowance = false;
		if (!nativeIn) {
			const allowance = await getPublicClient(chain.id).readContract({
				address: tokenIn,
				abi: ERC20_ABI,
				functionName: "allowance",
				args: [safe, dex.router],
			});
			resetAllowance = allowance > 0n;
		}
		return {
			tokens: quote.tokens.map((t) => getAddress(t)),
			fees: quote.fees,
			quoteOut: quote.amountOut.toString(),
			minOut: minOut.toString(),
			deadline: Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS,
			resetAllowance,
			impactBps,
		};
	},
	build: ({ chain, tokenIn, tokenOut, nativeIn, nativeOut, amountIn, recipient }, leg) => {
		const dex = dexOf(chain);
		if (
			leg.tokens.length < 2 ||
			leg.fees.length !== leg.tokens.length - 1 ||
			!sameAddress(leg.tokens[0], tokenIn) ||
			!sameAddress(leg.tokens[leg.tokens.length - 1], tokenOut) ||
			leg.fees.some((f) => !dex.feeTiers.includes(f))
		) {
			return mismatch();
		}
		const minOut = BigInt(leg.minOut);
		if (minOut <= 0n) return mismatch();
		const calls: MetaTx[] = [];
		if (!nativeIn) {
			const approve = (amount: bigint): MetaTx => ({
				to: tokenIn,
				value: 0n,
				data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [dex.router, amount] }),
			});
			if (leg.resetAllowance) calls.push(approve(0n));
			calls.push(approve(amountIn));
		}
		const inner: Hex[] = [
			encodeFunctionData({
				abi: ROUTER02_ABI,
				functionName: "exactInput",
				args: [
					{
						path: encodePath({ tokens: leg.tokens, fees: leg.fees }),
						// Native out: the router keeps the wrapped coin and unwraps it to the recipient.
						recipient: nativeOut ? dex.router : recipient,
						amountIn,
						amountOutMinimum: minOut,
					},
				],
			}),
		];
		if (nativeOut) {
			inner.push(encodeFunctionData({ abi: ROUTER02_ABI, functionName: "unwrapWETH9", args: [minOut, recipient] }));
		}
		calls.push({
			to: dex.router,
			value: nativeIn ? amountIn : 0n,
			data: encodeFunctionData({ abi: ROUTER02_ABI, functionName: "multicall", args: [BigInt(leg.deadline), inner] }),
		});
		return calls;
	},
};
