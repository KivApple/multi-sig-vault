import { concat, decodeFunctionData, getAddress, numberToHex, pad, parseUnits, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
	addressToBytes32,
	bpsFee,
	bytes32ToAddress,
	FORWARD_HOOK_DATA,
	matchMessage,
	parseCctpFees,
	parseCctpMessages,
	TOKEN_MESSENGER_ABI,
} from "@/lib/evm/cctp";
import { encodePath, ROUTER02_ABI } from "@/lib/evm/dex";
import { applySlippage, buildSwapCalls, NATIVE, slippageBps, swapShape, type SwapParams } from "@/lib/evm/swapBuild";
import { ERC20_ABI } from "@/lib/safe/abis";

const SAFE: Address = "0x1111111111111111111111111111111111111111";
const OTHER: Address = "0x2222222222222222222222222222222222222222";
const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ROUTER: Address = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const MESSENGER: Address = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";

const base: SwapParams = {
	tokenIn: USDC,
	tokenInSymbol: "USDC",
	tokenInDecimals: 6,
	amount: "1000",
	destChainId: 8453,
	tokenOut: "",
	tokenOutSymbol: "",
	tokenOutDecimals: 18,
	recipient: "",
	slippage: "1",
	feeTier: 0,
	speed: "standard",
	forward: true,
	forwardLevel: "med",
};

describe("swap math", () => {
	it("encodes a V3 path", () => {
		expect(encodePath({ tokens: [WETH, USDC], fees: [500] })).toBe(
			`0x${WETH.slice(2)}0001f4${USDC.slice(2)}`.toLowerCase(),
		);
		expect(encodePath({ tokens: [USDC, WETH, OTHER], fees: [100, 3000] })).toBe(
			`0x${USDC.slice(2)}000064${WETH.slice(2)}000bb8${OTHER.slice(2)}`.toLowerCase(),
		);
	});

	it("applies slippage rounding down", () => {
		expect(applySlippage(1_000_000n, 100)).toBe(990_000n);
		expect(applySlippage(999n, 50)).toBe(994n);
		expect(slippageBps("1")).toBe(100);
		expect(slippageBps("0.5")).toBe(50);
		expect(slippageBps("50")).toBe(5000);
		expect(slippageBps("51")).toBeUndefined();
		expect(slippageBps("0")).toBeUndefined();
		expect(slippageBps("abc")).toBeUndefined();
	});

	it("computes percentage fees with fractional bps, rounding up", () => {
		expect(bpsFee(1_000_000n, 1)).toBe(100n);
		expect(bpsFee(1_000_000n, 1.4)).toBe(140n);
		expect(bpsFee(7n, 1)).toBe(1n);
		expect(bpsFee(1_234_567_890n, 1.3)).toBe(160_494n);
		expect(bpsFee(1_000_000n, 0)).toBe(0n);
		expect(() => bpsFee(1n, -1)).toThrow();
	});

	it("converts recipients to bytes32 and back", () => {
		const b = addressToBytes32(USDC);
		expect(b).toBe(`0x000000000000000000000000${USDC.slice(2).toLowerCase()}`);
		expect(bytes32ToAddress(b)).toBe(USDC);
	});
});

describe("CCTP API parsing", () => {
	const real = [
		{ finalityThreshold: 1000, minimumFee: 1.4, forwardFee: { low: 71482, med: 80445, high: 89409 } },
		{ finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 71482, med: 80445, high: 89409 } },
	];

	it("reads fees for the requested finality", () => {
		expect(parseCctpFees(real, 2000)).toEqual({ minimumFeeBps: 0, forwardFee: { low: 71482n, med: 80445n, high: 89409n } });
		expect(parseCctpFees(real, 1000).minimumFeeBps).toBe(1.4);
		expect(parseCctpFees([{ finalityThreshold: 2000, minimumFee: 0 }], 2000).forwardFee).toBeUndefined();
	});

	it("rejects malformed or absurd fee answers", () => {
		expect(() => parseCctpFees({}, 2000)).toThrow();
		expect(() => parseCctpFees([], 2000)).toThrow();
		expect(() => parseCctpFees([{ finalityThreshold: 2000, minimumFee: "0" }], 2000)).toThrow();
		expect(() => parseCctpFees([{ finalityThreshold: 2000, minimumFee: 500 }], 2000)).toThrow();
		expect(() => parseCctpFees([{ finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 1, med: 1.5, high: 2 } }], 2000)).toThrow();
		expect(() => parseCctpFees([{ finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 1, med: 1e12, high: 2 } }], 2000)).toThrow();
	});

	const u32 = (n: number): Hex => numberToHex(n, { size: 4 });
	const word = (n: bigint): Hex => numberToHex(n, { size: 32 });
	const message = (dstDomain: number, recipient: Address, sender: Address, expiration = 0n): Hex =>
		concat([
			u32(1), u32(0), u32(dstDomain), word(77n), pad(MESSENGER), pad(MESSENGER), word(0n), u32(2000), u32(2000),
			u32(1), pad(USDC), pad(recipient), word(5n), pad(sender), word(0n), word(0n), word(expiration),
		]);
	const expected = { srcChainId: 1, dstChainId: 8453, sender: SAFE, recipient: OTHER };

	it("matches only the signed transfer", () => {
		expect(matchMessage(message(6, OTHER, SAFE, 9n), expected)).toEqual({ expirationBlock: 9n });
		expect(matchMessage(message(3, OTHER, SAFE), expected)).toBeUndefined();
		expect(matchMessage(message(6, SAFE, SAFE), expected)).toBeUndefined();
		expect(matchMessage(message(6, OTHER, OTHER), expected)).toBeUndefined();
		expect(matchMessage("0x1234", expected)).toBeUndefined();
	});

	it("parses the messages endpoint defensively", () => {
		const nonce = word(77n);
		const good = { message: message(6, OTHER, SAFE), attestation: "0xabcd", eventNonce: nonce, status: "complete" };
		const parsed = parseCctpMessages({ messages: [{ message: message(6, SAFE, SAFE), attestation: "0xabcd", status: "complete" }, good] }, expected);
		expect(parsed?.complete).toBe(true);
		expect(parsed?.nonce).toBe(nonce);
		expect(parsed?.mintTxHash).toBeUndefined();
		expect(parseCctpMessages({ messages: [{ ...good, destinationMintTxHash: word(1n), forwardState: "COMPLETE" }] }, expected)?.mintTxHash).toBe(word(1n));
		const pending = parseCctpMessages({ messages: [{ message: "0x", attestation: "PENDING", status: "pending_confirmations" }] }, expected);
		expect(pending?.complete).toBe(false);
		expect(pending?.message).toBeUndefined();
		expect(parseCctpMessages({ messages: [{ ...good, message: message(6, SAFE, SAFE) }] }, expected)).toBeUndefined();
		expect(parseCctpMessages("nope", expected)).toBeUndefined();
		expect(parseCctpMessages({ messages: [{ ...good, destinationMintTxHash: "javascript:alert(1)" }] }, expected)?.mintTxHash).toBeUndefined();
	});
});

describe("buildSwapCalls", () => {
	const bridged = (over: Partial<SwapParams> = {}): SwapParams => ({
		...base,
		resolved: {
			amountIn: "1000000000",
			preparedAt: 1,
			bridge: { amount: "1000000000", maxFee: "55636", forwardFee: "55636", percentFee: "0", finality: 2000, forward: true, receive: "999944364" },
		},
		...over,
	});

	it("builds approve + forwarded burn for a pure USDC bridge", () => {
		const calls = buildSwapCalls(bridged(), 1, SAFE);
		expect(calls).toHaveLength(2);
		expect(calls[0].to).toBe(USDC);
		expect(decodeFunctionData({ abi: ERC20_ABI, data: calls[0].data }).args).toEqual([MESSENGER, 1_000_000_000n]);
		expect(calls[1].to).toBe(MESSENGER);
		const burn = decodeFunctionData({ abi: TOKEN_MESSENGER_ABI, data: calls[1].data });
		expect(burn.functionName).toBe("depositForBurnWithHook");
		expect(burn.args).toEqual([1_000_000_000n, 6, addressToBytes32(SAFE), USDC, pad("0x00", { size: 32 }), 55_636n, 2000, FORWARD_HOOK_DATA]);
		expect(calls.every((c) => c.value === 0n && c.operation === undefined)).toBe(true);
	});

	it("uses plain depositForBurn without forwarding and honours a custom recipient", () => {
		const p = bridged({ forward: false, recipient: OTHER });
		p.resolved = { ...p.resolved!, bridge: { ...p.resolved!.bridge!, forward: false, maxFee: "0", forwardFee: "0", receive: "1000000000" } };
		const burn = decodeFunctionData({ abi: TOKEN_MESSENGER_ABI, data: buildSwapCalls(p, 1, SAFE)[1].data });
		expect(burn.functionName).toBe("depositForBurn");
		expect(burn.args?.[2]).toBe(addressToBytes32(OTHER));
		expect(burn.args?.[5]).toBe(0n);
	});

	it("is deterministic", () => {
		expect(buildSwapCalls(bridged(), 1, SAFE)).toEqual(buildSwapCalls(bridged(), 1, SAFE));
	});

	it("refuses resolved data that contradicts the visible parameters", () => {
		const tamper = (fn: (p: SwapParams) => void): SwapParams => {
			const p = structuredClone(bridged());
			fn(p);
			return p;
		};
		expect(() => buildSwapCalls(tamper((p) => { p.amount = "1"; }), 1, SAFE)).toThrow();
		expect(() => buildSwapCalls(tamper((p) => { p.resolved!.bridge!.amount = "2000000000"; }), 1, SAFE)).toThrow();
		expect(() => buildSwapCalls(tamper((p) => { p.resolved!.bridge!.maxFee = "999999999"; }), 1, SAFE)).toThrow();
		expect(() => buildSwapCalls(tamper((p) => { p.resolved!.bridge!.receive = "1"; }), 1, SAFE)).toThrow();
		expect(() => buildSwapCalls(tamper((p) => { p.tokenInDecimals = 18; p.amount = "0.000000001"; }), 1, SAFE)).toThrow();
		expect(() => buildSwapCalls(tamper((p) => { p.destChainId = 1; p.tokenOut = NATIVE; }), 1, SAFE)).toThrow();
		expect(() => buildSwapCalls({ ...base }, 1, SAFE)).toThrow();
	});

	const swapped = (over: Partial<SwapParams> = {}): SwapParams => ({
		...base,
		destChainId: 1,
		tokenIn: NATIVE,
		tokenInSymbol: "ETH",
		tokenInDecimals: 18,
		amount: "2",
		tokenOut: USDC,
		tokenOutSymbol: "USDC",
		tokenOutDecimals: 6,
		resolved: {
			amountIn: parseUnits("2", 18).toString(),
			preparedAt: 1,
			swap: { tokens: [WETH, USDC], fees: [500], quoteOut: "6000000000", minOut: "5940000000", deadline: 1_900_000_000, resetAllowance: false },
		},
		...over,
	});

	it("sends native value to the router inside multicall(deadline)", () => {
		const calls = buildSwapCalls(swapped(), 1, SAFE);
		expect(calls).toHaveLength(1);
		expect(calls[0].to).toBe(ROUTER);
		expect(calls[0].value).toBe(parseUnits("2", 18));
		const outer = decodeFunctionData({ abi: ROUTER02_ABI, data: calls[0].data });
		expect(outer.functionName).toBe("multicall");
		const [deadline, inner] = outer.args as [bigint, Hex[]];
		expect(deadline).toBe(1_900_000_000n);
		const swap = decodeFunctionData({ abi: ROUTER02_ABI, data: inner[0] });
		expect(swap.args).toEqual([{ path: encodePath({ tokens: [WETH, USDC], fees: [500] }), recipient: SAFE, amountIn: parseUnits("2", 18), amountOutMinimum: 5_940_000_000n }]);
	});

	it("approves ERC-20 input (with reset) and unwraps native output to the recipient", () => {
		const p = swapped({ tokenIn: USDC, tokenInSymbol: "USDC", tokenInDecimals: 6, amount: "100", tokenOut: NATIVE, tokenOutSymbol: "ETH", tokenOutDecimals: 18, recipient: OTHER });
		p.resolved = { amountIn: "100000000", preparedAt: 1, swap: { tokens: [USDC, WETH], fees: [500], quoteOut: "30", minOut: "29", deadline: 5, resetAllowance: true } };
		const calls = buildSwapCalls(p, 1, SAFE);
		expect(calls.map((c) => c.to)).toEqual([USDC, USDC, ROUTER]);
		expect(decodeFunctionData({ abi: ERC20_ABI, data: calls[0].data }).args).toEqual([ROUTER, 0n]);
		expect(decodeFunctionData({ abi: ERC20_ABI, data: calls[1].data }).args).toEqual([ROUTER, 100_000_000n]);
		const [, inner] = decodeFunctionData({ abi: ROUTER02_ABI, data: calls[2].data }).args as [bigint, Hex[]];
		expect((decodeFunctionData({ abi: ROUTER02_ABI, data: inner[0] }).args as unknown as [{ recipient: Address }])[0].recipient).toBe(ROUTER);
		expect(decodeFunctionData({ abi: ROUTER02_ABI, data: inner[1] }).args).toEqual([29n, OTHER]);
	});

	it("refuses a route that does not match the chosen tokens", () => {
		const p = swapped();
		p.resolved!.swap!.tokens = [WETH, getAddress(OTHER)];
		expect(() => buildSwapCalls(p, 1, SAFE)).toThrow();
		const q = swapped();
		q.resolved!.swap!.fees = [1234];
		expect(() => buildSwapCalls(q, 1, SAFE)).toThrow();
	});

	it("bridges exactly the guaranteed minimum after a swap", () => {
		const p = swapped({ destChainId: 42161, tokenOut: "" });
		p.resolved!.bridge = { amount: "5940000000", maxFee: "100", forwardFee: "100", percentFee: "0", finality: 2000, forward: true, receive: "5939999900" };
		const calls = buildSwapCalls(p, 1, SAFE);
		expect(calls.map((c) => c.to)).toEqual([ROUTER, USDC, MESSENGER]);
		expect(decodeFunctionData({ abi: TOKEN_MESSENGER_ABI, data: calls[2].data }).args?.[0]).toBe(5_940_000_000n);
		p.resolved!.bridge.amount = "6000000000";
		expect(() => buildSwapCalls(p, 1, SAFE)).toThrow();
	});

	it("classifies operations", () => {
		expect(swapShape(base, 1)).toMatchObject({ cross: true, needSwap: false });
		expect(swapShape({ ...base, tokenIn: NATIVE }, 1)).toMatchObject({ cross: true, needSwap: true, nativeIn: true });
		expect(() => swapShape({ ...base, destChainId: 84532 }, 1)).toThrow();
		expect(() => swapShape({ ...base, destChainId: 1, tokenOut: USDC }, 1)).toThrow();
		expect(() => swapShape({ ...base, destChainId: 1, tokenIn: NATIVE, tokenOut: WETH }, 1)).toThrow();
	});
});
