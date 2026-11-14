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
import { getChain } from "@/config/chains";
import { bridgeRoute, bridgeRoutes } from "@/lib/evm/bridges";
import {
	acrossFee,
	acrossFeeCap,
	acrossToken,
	parseAcrossQuote,
	parseAcrossStatus,
	scaleUnits,
	SPOKE_POOL_ABI,
	spokePoolOf,
} from "@/lib/evm/across";
import { candidateRoutes, encodePath, ROUTER02_ABI } from "@/lib/evm/dex";
import {
	applySlippage,
	buildSwapCalls,
	NATIVE,
	slippageBps,
	swapShape,
	viaOf,
	type SwapParams,
} from "@/lib/evm/swapBuild";
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
		expect(parseCctpFees(real, 2000)).toEqual({
			minimumFeeBps: 0,
			forwardFee: { low: 71482n, med: 80445n, high: 89409n },
		});
		expect(parseCctpFees(real, 1000).minimumFeeBps).toBe(1.4);
		expect(parseCctpFees([{ finalityThreshold: 2000, minimumFee: 0 }], 2000).forwardFee).toBeUndefined();
	});

	it("rejects malformed or absurd fee answers", () => {
		expect(() => parseCctpFees({}, 2000)).toThrow();
		expect(() => parseCctpFees([], 2000)).toThrow();
		expect(() => parseCctpFees([{ finalityThreshold: 2000, minimumFee: "0" }], 2000)).toThrow();
		expect(() => parseCctpFees([{ finalityThreshold: 2000, minimumFee: 500 }], 2000)).toThrow();
		expect(() =>
			parseCctpFees([{ finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 1, med: 1.5, high: 2 } }], 2000),
		).toThrow();
		expect(() =>
			parseCctpFees([{ finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 1, med: 1e12, high: 2 } }], 2000),
		).toThrow();
	});

	const u32 = (n: number): Hex => numberToHex(n, { size: 4 });
	const word = (n: bigint): Hex => numberToHex(n, { size: 32 });
	const message = (dstDomain: number, recipient: Address, sender: Address, expiration = 0n): Hex =>
		concat([
			u32(1),
			u32(0),
			u32(dstDomain),
			word(77n),
			pad(MESSENGER),
			pad(MESSENGER),
			word(0n),
			u32(2000),
			u32(2000),
			u32(1),
			pad(USDC),
			pad(recipient),
			word(5n),
			pad(sender),
			word(0n),
			word(0n),
			word(expiration),
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
		const parsed = parseCctpMessages(
			{ messages: [{ message: message(6, SAFE, SAFE), attestation: "0xabcd", status: "complete" }, good] },
			expected,
		);
		expect(parsed?.complete).toBe(true);
		expect(parsed?.nonce).toBe(nonce);
		expect(parsed?.mintTxHash).toBeUndefined();
		expect(
			parseCctpMessages(
				{ messages: [{ ...good, destinationMintTxHash: word(1n), forwardState: "COMPLETE" }] },
				expected,
			)?.mintTxHash,
		).toBe(word(1n));
		const pending = parseCctpMessages(
			{ messages: [{ message: "0x", attestation: "PENDING", status: "pending_confirmations" }] },
			expected,
		);
		expect(pending?.complete).toBe(false);
		expect(pending?.message).toBeUndefined();
		expect(parseCctpMessages({ messages: [{ ...good, message: message(6, SAFE, SAFE) }] }, expected)).toBeUndefined();
		expect(parseCctpMessages("nope", expected)).toBeUndefined();
		expect(
			parseCctpMessages({ messages: [{ ...good, destinationMintTxHash: "javascript:alert(1)" }] }, expected)
				?.mintTxHash,
		).toBeUndefined();
	});
});

describe("buildSwapCalls", () => {
	const bridged = (over: Partial<SwapParams> = {}): SwapParams => ({
		...base,
		resolved: {
			amountIn: "1000000000",
			preparedAt: 1,
			bridge: {
				amount: "1000000000",
				maxFee: "55636",
				forwardFee: "55636",
				percentFee: "0",
				finality: 2000,
				forward: true,
				receive: "999944364",
			},
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
		expect(burn.args).toEqual([
			1_000_000_000n,
			6,
			addressToBytes32(SAFE),
			USDC,
			pad("0x00", { size: 32 }),
			55_636n,
			2000,
			FORWARD_HOOK_DATA,
		]);
		expect(calls.every((c) => c.value === 0n && c.operation === undefined)).toBe(true);
	});

	it("uses plain depositForBurn without forwarding and honours a custom recipient", () => {
		const p = bridged({ forward: false, recipient: OTHER });
		p.resolved = {
			...p.resolved!,
			bridge: { ...p.resolved!.bridge!, forward: false, maxFee: "0", forwardFee: "0", receive: "1000000000" },
		};
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
		expect(() =>
			buildSwapCalls(
				tamper((p) => {
					p.amount = "1";
				}),
				1,
				SAFE,
			),
		).toThrow();
		expect(() =>
			buildSwapCalls(
				tamper((p) => {
					p.resolved!.bridge!.amount = "2000000000";
				}),
				1,
				SAFE,
			),
		).toThrow();
		expect(() =>
			buildSwapCalls(
				tamper((p) => {
					p.resolved!.bridge!.maxFee = "999999999";
				}),
				1,
				SAFE,
			),
		).toThrow();
		expect(() =>
			buildSwapCalls(
				tamper((p) => {
					p.resolved!.bridge!.receive = "1";
				}),
				1,
				SAFE,
			),
		).toThrow();
		expect(() =>
			buildSwapCalls(
				tamper((p) => {
					p.tokenInDecimals = 18;
					p.amount = "0.000000001";
				}),
				1,
				SAFE,
			),
		).toThrow();
		expect(() =>
			buildSwapCalls(
				tamper((p) => {
					p.destChainId = 1;
					p.tokenOut = NATIVE;
				}),
				1,
				SAFE,
			),
		).toThrow();
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
			swap: {
				tokens: [WETH, USDC],
				fees: [500],
				quoteOut: "6000000000",
				minOut: "5940000000",
				deadline: 1_900_000_000,
				resetAllowance: false,
			},
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
		expect(swap.args).toEqual([
			{
				path: encodePath({ tokens: [WETH, USDC], fees: [500] }),
				recipient: SAFE,
				amountIn: parseUnits("2", 18),
				amountOutMinimum: 5_940_000_000n,
			},
		]);
	});

	it("approves ERC-20 input (with reset) and unwraps native output to the recipient", () => {
		const p = swapped({
			tokenIn: USDC,
			tokenInSymbol: "USDC",
			tokenInDecimals: 6,
			amount: "100",
			tokenOut: NATIVE,
			tokenOutSymbol: "ETH",
			tokenOutDecimals: 18,
			recipient: OTHER,
		});
		p.resolved = {
			amountIn: "100000000",
			preparedAt: 1,
			swap: { tokens: [USDC, WETH], fees: [500], quoteOut: "30", minOut: "29", deadline: 5, resetAllowance: true },
		};
		const calls = buildSwapCalls(p, 1, SAFE);
		expect(calls.map((c) => c.to)).toEqual([USDC, USDC, ROUTER]);
		expect(decodeFunctionData({ abi: ERC20_ABI, data: calls[0].data }).args).toEqual([ROUTER, 0n]);
		expect(decodeFunctionData({ abi: ERC20_ABI, data: calls[1].data }).args).toEqual([ROUTER, 100_000_000n]);
		const [, inner] = decodeFunctionData({ abi: ROUTER02_ABI, data: calls[2].data }).args as [bigint, Hex[]];
		expect(
			(decodeFunctionData({ abi: ROUTER02_ABI, data: inner[0] }).args as unknown as [{ recipient: Address }])[0]
				.recipient,
		).toBe(ROUTER);
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
		p.resolved!.bridge = {
			amount: "5940000000",
			maxFee: "100",
			forwardFee: "100",
			percentFee: "0",
			finality: 2000,
			forward: true,
			receive: "5939999900",
		};
		const calls = buildSwapCalls(p, 1, SAFE);
		expect(calls.map((c) => c.to)).toEqual([ROUTER, USDC, MESSENGER]);
		expect(decodeFunctionData({ abi: TOKEN_MESSENGER_ABI, data: calls[2].data }).args?.[0]).toBe(5_940_000_000n);
		p.resolved!.bridge.amount = "6000000000";
		expect(() => buildSwapCalls(p, 1, SAFE)).toThrow();
	});

	it("classifies operations", () => {
		expect(swapShape(base, 1)).toMatchObject({ cross: true, needSwap: false });
		// HyperEVM has no ETH of its own: there the coin is sold for USDC first.
		expect(swapShape({ ...base, tokenIn: NATIVE, destChainId: 999 }, 1)).toMatchObject({
			cross: true,
			needSwap: true,
			nativeIn: true,
		});
		expect(() => swapShape({ ...base, destChainId: 84532 }, 1)).toThrow();
		expect(() => swapShape({ ...base, destChainId: 1, tokenOut: USDC }, 1)).toThrow();
		expect(() => swapShape({ ...base, destChainId: 1, tokenIn: NATIVE, tokenOut: WETH }, 1)).toThrow();
	});
});

describe("USDT through Across (BNB Chain routes)", () => {
	const USDT: Address = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
	const USDT_BNB: Address = "0x55d398326f99059fF775485246999027B3197955";
	const USDT_ARB: Address = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
	const SPOKE = spokePoolOf(1);
	const usdt = (chainId: number) => acrossToken(chainId, "USDT");
	const eth = getChain(1);
	const bnb = getChain(56);
	const E12 = 10n ** 12n;

	const toBnb = (over: Partial<SwapParams> = {}): SwapParams => ({
		...base,
		tokenIn: USDT,
		tokenInSymbol: "USDT",
		destChainId: 56,
		resolved: {
			amountIn: "1000000000",
			preparedAt: 1,
			across: {
				asset: "USDT",
				amount: "1000000000",
				output: (999_896_436n * E12).toString(),
				fee: "103564",
				fillDeadlineOffset: 7200,
				resetAllowance: false,
			},
		},
		...over,
	});

	const WBTC: Address = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
	const WETH_BASE: Address = "0x4200000000000000000000000000000000000006";

	it("sends a token Across carries as itself, everything else as USDC, and USDT where there is no USDC", () => {
		// 1. The same asset on both networks: nothing is sold.
		expect(swapShape({ ...base, tokenIn: USDT }, 1)).toMatchObject({
			bridge: "across",
			asset: "USDT",
			needSwap: false,
			outAddress: USDT,
		});
		expect(swapShape({ ...base, tokenIn: USDT.toLowerCase(), destChainId: 999 }, 1)).toMatchObject({ asset: "USDT" });
		expect(swapShape({ ...base, tokenIn: USDT, destChainId: 56 }, 1)).toMatchObject({ asset: "USDT", needSwap: false });
		expect(swapShape({ ...base, tokenIn: USDT_BNB, destChainId: 42161 }, 56)).toMatchObject({ asset: "USDT" });
		// The coin crosses as its wrapped token, and so does the token itself.
		expect(swapShape({ ...base, tokenIn: NATIVE }, 1)).toMatchObject({
			bridge: "across",
			asset: "WETH",
			needSwap: false,
			nativeIn: true,
			outAddress: WETH,
		});
		expect(swapShape({ ...base, tokenIn: WETH, destChainId: 56 }, 1)).toMatchObject({ asset: "WETH", needSwap: false });
		expect(swapShape({ ...base, tokenIn: WBTC, destChainId: 42161 }, 1)).toMatchObject({
			asset: "WBTC",
			needSwap: false,
		});
		// 2. USDC itself, and what Across does not carry between the two networks, goes as USDC.
		expect(swapShape(base, 1)).toMatchObject({ bridge: "cctp", needSwap: false });
		expect(swapShape({ ...base, tokenIn: OTHER }, 1)).toMatchObject({ bridge: "cctp", needSwap: true });
		// WBTC is not on Base, ETH is not on HyperEVM, POL is nowhere else.
		expect(swapShape({ ...base, tokenIn: WBTC }, 1)).toMatchObject({ bridge: "cctp", needSwap: true });
		expect(swapShape({ ...base, tokenIn: WETH, destChainId: 999 }, 1)).toMatchObject({
			bridge: "cctp",
			needSwap: true,
		});
		expect(swapShape({ ...base, tokenIn: NATIVE, destChainId: 1 }, 137)).toMatchObject({
			bridge: "cctp",
			needSwap: true,
		});
		// A testnet has no Across: there USDT is sold for USDC as before.
		expect(swapShape({ ...base, tokenIn: USDT, destChainId: 84532 }, 11155111)).toMatchObject({ bridge: "cctp" });
		// 3. No CCTP to or from BNB Chain: what Across does not carry there is sold for USDT.
		expect(swapShape({ ...base, destChainId: 56 }, 1)).toMatchObject({
			bridge: "across",
			asset: "USDT",
			needSwap: true,
		});
		expect(swapShape({ ...base, tokenIn: NATIVE, destChainId: 1 }, 56)).toMatchObject({
			asset: "USDT",
			needSwap: true,
		});
		// No route to a testnet, and none from the BNB testnet.
		expect(() => swapShape({ ...base, destChainId: 97 }, 1)).toThrow();
		expect(() => swapShape({ ...base, destChainId: 11155111 }, 97)).toThrow();
	});

	it("lists what can arrive on the other network, the default first", () => {
		const arb = getChain(42161);
		const base8453 = getChain(8453);
		const hyper = getChain(999);
		const list = (src: typeof eth, dst: typeof eth, token?: string): string[] =>
			bridgeRoutes(src, dst, token).map((r) => r.receive);
		// The token itself, then USDC, then the rest Across carries between the two.
		expect(list(eth, arb, USDT)).toEqual(["USDT", "USDC", "WETH", "WBTC"]);
		expect(list(eth, arb, WETH)).toEqual(["WETH", "USDC", "USDT", "WBTC"]);
		expect(list(eth, arb, WBTC)).toEqual(["WBTC", "USDC", "USDT", "WETH"]);
		// USDC always goes through Circle's bridge where there is one; a token nobody carries goes as USDC.
		expect(list(eth, arb, USDC)[0]).toBe("USDC");
		expect(list(eth, arb, OTHER)).toEqual(["USDC", "USDT", "WETH", "WBTC"]);
		// Only what both networks have: no WBTC on Base, only USDT on HyperEVM.
		expect(list(eth, base8453, WBTC)).toEqual(["USDC", "USDT", "WETH"]);
		expect(list(hyper, eth, OTHER)).toEqual(["USDC", "USDT"]);
		// No USDC to or from BNB Chain: USDT is the default there.
		expect(list(eth, bnb, USDC)).toEqual(["USDT", "WETH"]);
		expect(list(bnb, eth, USDT_BNB)).toEqual(["USDT", "WETH"]);
		expect(list(eth, bnb, WETH)).toEqual(["WETH", "USDT"]);
		expect(list(eth, getChain(11155111))).toEqual([]);
		// The token that crosses is the one of the route, as it is on the source network.
		expect(bridgeRoute(eth, arb, USDT, "WETH")).toMatchObject({ kind: "across", receive: "WETH", token: WETH });
		expect(bridgeRoute(eth, arb, USDT, "USDC")).toMatchObject({ kind: "cctp", token: USDC });
		// What no bridge carries there is not a choice: the default stands.
		expect(bridgeRoute(eth, base8453, USDT, "WBTC")).toMatchObject({ receive: "USDT" });
	});

	it("delivers what was asked for, selling the token here when it is something else", () => {
		const usdt: SwapParams = { ...base, tokenIn: USDT, receive: "USDC" };
		expect(swapShape(usdt, 1)).toMatchObject({ bridge: "cctp", receive: "USDC", needSwap: true, outAddress: USDC });
		expect(swapShape({ ...usdt, receive: "WETH" }, 1)).toMatchObject({
			bridge: "across",
			asset: "WETH",
			needSwap: true,
			outAddress: WETH,
		});
		expect(swapShape({ ...usdt, receive: "USDT" }, 1)).toMatchObject({ asset: "USDT", needSwap: false });
		expect(swapShape({ ...usdt, receive: undefined }, 1)).toMatchObject({ asset: "USDT", needSwap: false });
		// The coin for USDC, as before there was a choice.
		expect(swapShape({ ...base, tokenIn: NATIVE, receive: "USDC" }, 1)).toMatchObject({
			bridge: "cctp",
			needSwap: true,
		});
		// BNB Chain has no USDC to receive: the wish changes nothing there.
		expect(swapShape({ ...usdt, destChainId: 56 }, 1)).toMatchObject({ asset: "USDT", needSwap: false });
		expect(viaOf(usdt)).toBe("USDC");
		expect(viaOf({ ...base, tokenIn: USDT })).toBeUndefined();
		// An operation that fell back to CCTP stays a CCTP transfer for every build of the app.
		const fellBack: SwapParams = {
			...base,
			tokenIn: USDT,
			forward: false,
			resolved: {
				amountIn: "1000000000",
				preparedAt: 1,
				fallback: true,
				swap: {
					tokens: [USDT, USDC],
					fees: [100],
					quoteOut: "999900000",
					minOut: "990000000",
					deadline: 2_000_000_000,
					resetAllowance: false,
				},
				bridge: {
					amount: "990000000",
					maxFee: "0",
					forwardFee: "0",
					percentFee: "0",
					finality: 2000,
					forward: false,
					receive: "990000000",
				},
			},
		};
		expect(viaOf(fellBack)).toBe("USDC");
		expect(buildSwapCalls(fellBack, 1, SAFE).map((c) => c.to)).toEqual([USDT, ROUTER, USDC, MESSENGER]);
		// Asked for explicitly it is the same transaction, without the flag…
		const asked = structuredClone(fellBack);
		asked.receive = "USDC";
		asked.resolved!.fallback = undefined;
		expect(buildSwapCalls(asked, 1, SAFE)).toEqual(buildSwapCalls(fellBack, 1, SAFE));
		// …but USDC delivered where ETH was asked for, with no word of a fallback, is refused,
		asked.receive = "WETH";
		expect(() => buildSwapCalls(asked, 1, SAFE)).toThrow();
		// and so is a "fallback" for a token that never had Across to fall back from.
		const fake = structuredClone(fellBack);
		fake.tokenIn = OTHER;
		fake.resolved!.swap!.tokens = [OTHER, USDC];
		expect(() => buildSwapCalls(fake, 1, SAFE)).toThrow();
		// An operation made before there was a choice asks for nothing and is built as it was resolved.
		const old = structuredClone(fellBack);
		old.tokenIn = NATIVE;
		old.tokenInDecimals = 18;
		old.amount = "1";
		old.resolved!.fallback = undefined;
		old.resolved!.amountIn = parseUnits("1", 18).toString();
		old.resolved!.swap!.tokens = [WETH, USDC];
		expect(buildSwapCalls(old, 1, SAFE).map((c) => c.to)).toEqual([ROUTER, USDC, MESSENGER]);
	});

	it("deposits the coin as the value of the call, and a token after an approval", () => {
		const eth: SwapParams = {
			...base,
			tokenIn: NATIVE,
			tokenInSymbol: "ETH",
			tokenInDecimals: 18,
			amount: "1",
			resolved: {
				amountIn: parseUnits("1", 18).toString(),
				preparedAt: 1,
				across: {
					asset: "WETH",
					amount: parseUnits("1", 18).toString(),
					output: parseUnits("0.999919", 18).toString(),
					fee: parseUnits("0.000081", 18).toString(),
					fillDeadlineOffset: 7200,
					resetAllowance: false,
				},
			},
		};
		const calls = buildSwapCalls(eth, 1, SAFE);
		expect(calls).toHaveLength(1);
		expect(calls[0].to).toBe(SPOKE);
		expect(calls[0].value).toBe(parseUnits("1", 18));
		expect(decodeFunctionData({ abi: SPOKE_POOL_ABI, data: calls[0].data }).args?.slice(2, 7)).toEqual([
			addressToBytes32(WETH),
			addressToBytes32(WETH_BASE),
			parseUnits("1", 18),
			parseUnits("0.999919", 18),
			8453n,
		]);
		// The same asset held as a token: approved, and no value sent.
		const weth = buildSwapCalls({ ...eth, tokenIn: WETH, tokenInSymbol: "WETH" }, 1, SAFE);
		expect(weth.map((c) => [c.to, c.value])).toEqual([
			[WETH, 0n],
			[SPOKE, 0n],
		]);
		// A leg of another asset than the token is, or a fee above that asset's cap.
		const wrong = structuredClone(eth);
		wrong.resolved!.across!.asset = "USDT";
		expect(() => buildSwapCalls(wrong, 1, SAFE)).toThrow();
		const greedy = structuredClone(eth);
		greedy.resolved!.across!.output = parseUnits("0.98", 18).toString();
		greedy.resolved!.across!.fee = parseUnits("0.02", 18).toString();
		expect(() => buildSwapCalls(greedy, 1, SAFE)).toThrow();
		// 1% of the amount plus about five dollars of the asset.
		expect(acrossFeeCap(parseUnits("1", 18), "WETH", acrossToken(1, "WETH"))).toBe(parseUnits("0.012", 18));
		expect(acrossFeeCap(100_000_000n, "WBTC", acrossToken(1, "WBTC"))).toBe(1_005_000n);
	});

	it("converts between 6 and 18 decimals and counts the fee in the token sent", () => {
		expect(scaleUnits(1_000_000n, 6, 18)).toBe(10n ** 18n);
		expect(scaleUnits(10n ** 18n + 999n, 18, 6)).toBe(1_000_000n);
		expect(acrossFee(1_000_000_000n, 999_896_436n * E12, usdt(1), usdt(56))).toBe(103_564n);
		expect(acrossFee(1000n * 10n ** 18n, 999_875_694n, usdt(56), usdt(1))).toBe(124_306n * E12);
		// 1% of the amount plus 5 USDT.
		expect(acrossFeeCap(1_000_000_000n, "USDT", usdt(1))).toBe(15_000_000n);
		expect(acrossFeeCap(1000n * 10n ** 18n, "USDT", usdt(56))).toBe(15n * 10n ** 18n);
	});

	it("takes the amount to receive from a quote only when it is about this route and within the fee cap", () => {
		const answer = (bridge: Record<string, unknown> = {}, over: Record<string, unknown> = {}): unknown => ({
			crossSwapType: "bridgeableToBridgeable",
			steps: {
				bridge: {
					provider: "across",
					inputAmount: "1000000000",
					outputAmount: (999_896_427n * E12).toString(),
					tokenIn: { address: USDT, decimals: 6, chainId: 1 },
					tokenOut: { address: USDT_BNB, decimals: 18, chainId: 56 },
					...bridge,
				},
			},
			swapTx: { to: SPOKE, data: "0xad5425c6" },
			...over,
		});
		const amount = 1_000_000_000n;
		expect(parseAcrossQuote(answer(), eth, bnb, "USDT", amount)).toBe(999_896_427n * E12);
		const refused = (json: unknown, value = amount): void => {
			expect(() => parseAcrossQuote(json, eth, bnb, "USDT", value)).toThrow();
		};
		// Another contract, token, amount or bridge than the one asked about.
		refused(answer({}, { swapTx: { to: OTHER } }));
		refused(answer({ tokenIn: { address: USDC, decimals: 6 } }));
		refused(answer({ tokenOut: { address: USDT_BNB, decimals: 6 } }));
		refused(answer({ provider: "cctp" }));
		refused(answer({ provider: "oft" }));
		refused(answer(), 2_000_000_000n);
		// A swap added on either side is not the plain transfer the app shows.
		refused(answer({}, { steps: { ...(answer() as { steps: object }).steps, destinationSwap: {} } }));
		// More than 1% + 5 USDT kept, or more paid out than sent: not a price.
		refused(answer({ outputAmount: (980_000_000n * E12).toString() }));
		refused(answer({ outputAmount: (1_000_000_001n * E12).toString() }));
		refused(answer({ outputAmount: "0" }));
		refused(answer({ outputAmount: "1e21" }));
		refused("nope");
	});

	it("builds approve + depositNow for a pure USDT transfer", () => {
		const calls = buildSwapCalls(toBnb(), 1, SAFE);
		expect(calls).toHaveLength(2);
		expect(calls[0].to).toBe(USDT);
		expect(decodeFunctionData({ abi: ERC20_ABI, data: calls[0].data }).args).toEqual([SPOKE, 1_000_000_000n]);
		expect(calls[1].to).toBe(SPOKE);
		expect(calls[1].value).toBe(0n);
		const deposit = decodeFunctionData({ abi: SPOKE_POOL_ABI, data: calls[1].data });
		expect(deposit.functionName).toBe("depositNow");
		expect(deposit.args).toEqual([
			addressToBytes32(SAFE),
			addressToBytes32(SAFE),
			addressToBytes32(USDT),
			addressToBytes32(USDT_BNB),
			1_000_000_000n,
			999_896_436n * E12,
			56n,
			pad("0x", { size: 32 }),
			7200,
			0,
			"0x",
		]);
		expect(buildSwapCalls(structuredClone(toBnb()), 1, SAFE)).toEqual(calls);
	});

	it("marks the deposit with the integrator id kept in the operation, after the call's own data", () => {
		const plain = buildSwapCalls(toBnb(), 1, SAFE)[1].data;
		const p = toBnb();
		p.resolved!.across!.integrator = "0xf001";
		const marked = buildSwapCalls(p, 1, SAFE)[1].data;
		expect(marked).toBe(`${plain}1dc0def001`);
		// The contract reads the same call: what follows it is not an argument.
		expect(decodeFunctionData({ abi: SPOKE_POOL_ABI, data: marked }).args).toEqual(
			decodeFunctionData({ abi: SPOKE_POOL_ABI, data: plain }).args,
		);
		for (const bad of ["f001", "0xF001", "0xf00", "0xf001ff", "0x1dc0de"]) {
			p.resolved!.across!.integrator = bad;
			expect(() => buildSwapCalls(p, 1, SAFE)).toThrow();
		}
	});

	it("zeroes a leftover USDT allowance first and honours a custom recipient", () => {
		const p = toBnb({ recipient: OTHER });
		p.resolved!.across!.resetAllowance = true;
		const calls = buildSwapCalls(p, 1, SAFE);
		expect(calls).toHaveLength(3);
		expect(decodeFunctionData({ abi: ERC20_ABI, data: calls[0].data }).args).toEqual([SPOKE, 0n]);
		expect(decodeFunctionData({ abi: ERC20_ABI, data: calls[1].data }).args).toEqual([SPOKE, 1_000_000_000n]);
		const args = decodeFunctionData({ abi: SPOKE_POOL_ABI, data: calls[2].data }).args;
		// The refund of an unfilled deposit still goes to the Safe.
		expect(args?.[0]).toBe(addressToBytes32(SAFE));
		expect(args?.[1]).toBe(addressToBytes32(OTHER));
	});

	it("sends 18-decimal USDT out of BNB Chain and names the 6-decimal amount to receive", () => {
		const p: SwapParams = {
			...base,
			tokenIn: USDT_BNB,
			tokenInSymbol: "USDT",
			tokenInDecimals: 18,
			destChainId: 42161,
			resolved: {
				amountIn: (1000n * 10n ** 18n).toString(),
				preparedAt: 1,
				across: {
					asset: "USDT",
					amount: (1000n * 10n ** 18n).toString(),
					output: "999886130",
					fee: (113_870n * E12).toString(),
					fillDeadlineOffset: 7200,
					resetAllowance: false,
				},
			},
		};
		const calls = buildSwapCalls(p, 56, SAFE);
		expect(calls[1].to).toBe(spokePoolOf(56));
		const args = decodeFunctionData({ abi: SPOKE_POOL_ABI, data: calls[1].data }).args;
		expect(args?.slice(2, 7)).toEqual([
			addressToBytes32(USDT_BNB),
			addressToBytes32(USDT_ARB),
			1000n * 10n ** 18n,
			999_886_130n,
			42161n,
		]);
	});

	it("refuses resolved data that contradicts the visible parameters", () => {
		const broken = (edit: (p: SwapParams) => void): void => {
			const p = structuredClone(toBnb());
			edit(p);
			expect(() => buildSwapCalls(p, 1, SAFE)).toThrow();
		};
		const leg = (p: SwapParams) => p.resolved!.across!;
		// A smaller payout than the fee shown accounts for.
		broken((p) => {
			leg(p).output = (990_000_000n * E12).toString();
		});
		// A fee above the cap, even when shown honestly.
		broken((p) => {
			leg(p).output = (900_000_000n * E12).toString();
			leg(p).fee = "100000000";
		});
		broken((p) => {
			leg(p).amount = "2000000000";
		});
		broken((p) => {
			leg(p).fillDeadlineOffset = 60;
		});
		broken((p) => {
			leg(p).fillDeadlineOffset = 86_400;
		});
		// Another destination than the amount to receive was quoted for is still USDT through Across,
		// but a token that travels as USDC cannot carry an Across leg.
		broken((p) => {
			p.tokenIn = USDC;
			p.destChainId = 8453;
		});
		broken((p) => {
			p.resolved!.bridge = {
				amount: "1000000000",
				maxFee: "0",
				forwardFee: "0",
				percentFee: "0",
				finality: 2000,
				forward: false,
				receive: "1000000000",
			};
		});
		broken((p) => {
			p.amount = "999";
		});
	});

	it("bridges exactly the guaranteed minimum after a swap into USDT", () => {
		// USDC does not exist on BNB Chain: it is sold for USDT, and that crosses.
		const p = toBnb({ tokenIn: USDC, tokenInSymbol: "USDC", amount: "3000" });
		p.resolved = {
			amountIn: "3000000000",
			preparedAt: 1,
			swap: {
				tokens: [USDC, USDT],
				fees: [100],
				quoteOut: "2999000000",
				minOut: "2970000000",
				deadline: 2_000_000_000,
				resetAllowance: false,
			},
			across: {
				asset: "USDT",
				amount: "2970000000",
				output: (2_969_000_000n * E12).toString(),
				fee: "1000000",
				fillDeadlineOffset: 7200,
				resetAllowance: false,
			},
		};
		const calls = buildSwapCalls(p, 1, SAFE);
		expect(calls.map((c) => c.to)).toEqual([USDC, ROUTER, USDT, SPOKE]);
		expect(decodeFunctionData({ abi: SPOKE_POOL_ABI, data: calls[3].data }).args?.[4]).toBe(2_970_000_000n);
		p.resolved.across!.amount = "3000000000";
		expect(() => buildSwapCalls(p, 1, SAFE)).toThrow();
	});

	it("routes into another stablecoin through the 0.01% pool of the dollar token", () => {
		const routes = candidateRoutes(eth, WETH, USDT);
		expect(routes).toContainEqual({ tokens: [WETH, USDC, USDT], fees: [500, 100] });
		// The hop through the wrapped coin keeps to the tiers where its pools are.
		expect(candidateRoutes(eth, USDC, USDT).some((r) => r.tokens[1] === WETH && r.fees[1] === 100)).toBe(false);
	});

	it("reads the transfer status defensively", () => {
		const hash = `0x${"ab".repeat(32)}`;
		const answer = { status: "filled", originChainId: 1, destinationChainId: 56, fillTxnRef: hash };
		expect(parseAcrossStatus(answer, 1, 56)).toEqual({ state: "filled", fillTxHash: hash, refundTxHash: undefined });
		expect(parseAcrossStatus({ ...answer, status: "refunded", depositRefundTxHash: hash }, 1, 56)?.refundTxHash).toBe(
			hash,
		);
		// About another transfer, an unknown state, or not a hash.
		expect(parseAcrossStatus(answer, 1, 42161)).toBeUndefined();
		expect(parseAcrossStatus({ ...answer, status: "slow" }, 1, 56)).toBeUndefined();
		expect(parseAcrossStatus({ ...answer, fillTxnRef: "javascript:alert(1)" }, 1, 56)?.fillTxHash).toBeUndefined();
		expect(parseAcrossStatus(null, 1, 56)).toBeUndefined();
	});
});
