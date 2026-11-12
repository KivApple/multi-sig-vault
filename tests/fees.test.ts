import { describe, expect, it } from "vitest";
import { pickTips } from "@/lib/evm/fees";

const gwei = (n: number): bigint => BigInt(Math.round(n * 1e9));

describe("pickTips", () => {
	// Ethereum on a quiet day: the node suggests a tip nothing gets included with.
	const rewards = [
		[gwei(0.00106), gwei(0.02644)],
		[gwei(0.001), gwei(0.08654)],
		[gwei(0.00561), gwei(0.05)],
		[gwei(0.001), gwei(0.002)],
		[gwei(0.00001), gwei(0.1)],
	];

	it("ignores a node suggestion below what blocks accept", () => {
		const tips = pickTips(rewards, gwei(0.000016), gwei(0.1));
		expect(tips.slow).toBe(gwei(0.001));
		expect(tips.fast).toBe(gwei(0.05));
	});

	it("never goes below a share of the base fee", () => {
		const tips = pickTips(rewards, 0n, gwei(20));
		expect(tips.slow).toBe(gwei(0.2));
		expect(tips.fast).toBe(gwei(2));
	});

	it("keeps a higher node suggestion", () => {
		const tips = pickTips(rewards, gwei(3), gwei(0.1));
		expect(tips).toEqual({ slow: gwei(3), fast: gwei(3) });
	});

	it("adds nothing on a chain without a tip market", () => {
		const none = [
			[0n, 0n],
			[0n, 0n],
			[0n, 0n],
		];
		expect(pickTips(none, 0n, gwei(0.02))).toEqual({ slow: 0n, fast: 0n });
		expect(pickTips([], gwei(0.001), gwei(0.02))).toEqual({ slow: gwei(0.001), fast: gwei(0.001) });
	});
});
