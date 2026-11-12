import { findChain } from "@/config/chains";
import { getPublicClient } from "@/lib/rpc";

/** How much the sender is ready to pay for a place in a block. */
export type FeeSpeed = "slow" | "fast";
export const FEE_SPEEDS: FeeSpeed[] = ["slow", "fast"];

export type FeeQuote =
	| { type: "eip1559"; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; baseFee: bigint }
	| { type: "legacy"; gasPrice: bigint };

/** Blocks looked at, and the share of each block's gas that paid no more than the tip we take. */
const HISTORY_BLOCKS = 10;
const PERCENTILES: Record<FeeSpeed, number> = { slow: 30, fast: 60 };

const median = (values: bigint[]): bigint => {
	if (values.length === 0) return 0n;
	const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	return sorted[Math.floor(sorted.length / 2)];
};

const max = (...values: bigint[]): bigint => values.reduce((a, b) => (b > a ? b : a), 0n);

/**
 * Tips for both speeds from what recent blocks really accepted.
 *
 * A node's own suggestion (`eth_maxPriorityFeePerGas`) can sit at the very bottom of the market, where
 * a transaction is included only by luck and a private relay ignores it. So the tip is the median, over
 * recent blocks, of what the cheaper 30% (slow) or 60% (fast) of the gas paid, never below the node's
 * suggestion and never below a small share of the base fee.
 *
 * `rewards[block] = [tip at the slow percentile, tip at the fast percentile]`.
 * A chain where nobody pays a tip (the fast median is zero) has no tip market: the node's value stands.
 */
export const pickTips = (rewards: bigint[][], nodeTip: bigint, baseFee: bigint): Record<FeeSpeed, bigint> => {
	const slowSeen = median(rewards.map((r) => r[0] ?? 0n));
	const fastSeen = median(rewards.map((r) => r[1] ?? 0n));
	if (fastSeen === 0n) return { slow: nodeTip, fast: nodeTip };
	const slow = max(nodeTip, slowSeen, baseFee / 100n);
	const fast = max(slow, fastSeen, baseFee / 10n);
	return { slow, fast };
};

/**
 * The cap leaves room for the base fee to double while the request waits for a signature;
 * only base fee + tip is ever charged, so a higher cap costs nothing.
 */
const eip1559 = (baseFee: bigint, tip: bigint): FeeQuote => ({
	type: "eip1559",
	maxFeePerGas: baseFee * 2n + tip,
	maxPriorityFeePerGas: tip,
	baseFee,
});

/** Fees for both speeds on a chain. Throws when the node answers nothing usable. */
export const quoteFees = async (chainId: number): Promise<Record<FeeSpeed, FeeQuote>> => {
	const client = getPublicClient(chainId);
	const legacy = async (): Promise<Record<FeeSpeed, FeeQuote>> => {
		const quote: FeeQuote = { type: "legacy", gasPrice: ((await client.getGasPrice()) * 110n) / 100n };
		return { slow: quote, fast: quote };
	};
	if (findChain(chainId)?.legacyTx) return legacy();
	try {
		const [history, nodeTip] = await Promise.all([
			client.getFeeHistory({
				blockCount: HISTORY_BLOCKS,
				rewardPercentiles: [PERCENTILES.slow, PERCENTILES.fast],
			}),
			client.estimateMaxPriorityFeePerGas().catch(() => 0n),
		]);
		// The last entry is the base fee of the block being built.
		const baseFee = history.baseFeePerGas.at(-1);
		if (baseFee === undefined || baseFee === null) return legacy();
		const tips = pickTips(history.reward ?? [], nodeTip, baseFee);
		return { slow: eip1559(baseFee, tips.slow), fast: eip1559(baseFee, tips.fast) };
	} catch {
		// No fee history: take the node's own estimate for both speeds.
		try {
			const fees = await client.estimateFeesPerGas({ type: "eip1559" });
			const quote: FeeQuote = {
				type: "eip1559",
				maxFeePerGas: fees.maxFeePerGas,
				maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
				baseFee: fees.maxFeePerGas - fees.maxPriorityFeePerGas,
			};
			return { slow: quote, fast: quote };
		} catch {
			return legacy();
		}
	}
};

/** What one unit of gas is expected to cost with this quote (not the cap). */
export const expectedGasPrice = (quote: FeeQuote): bigint =>
	quote.type === "legacy" ? quote.gasPrice : quote.baseFee + quote.maxPriorityFeePerGas;
