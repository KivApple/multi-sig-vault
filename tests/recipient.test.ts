import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { fastAvailable } from "@/lib/evm/bridges/cctp";
import { buildSwapCalls, type SwapParams } from "@/lib/evm/swapBuild";
import { hlSystemAddress } from "@/lib/hl/account";
import { spotSendOp, usdSendOp, withdrawOp } from "@/lib/ops/hl/transfers";
import { unitWithdrawOp } from "@/lib/ops/hl/unit";
import { safeSendOp } from "@/lib/ops/safe/send";
import { parseAddress } from "@/lib/format";
import { parseSolanaAccount, isSolanaWallet } from "@/lib/hl/solana";
import { mergeNotices } from "@/lib/ops/recipientNotices";
import { unknownSigners } from "@/lib/ops/useUnknownSigners";
import { knownContracts, recipientProblem, requireRecipient } from "@/lib/recipient";

// The operation definitions reference their React components; they are irrelevant here.
vi.mock("@/components/ops/safe/SafeSendForm", () => ({ SafeSendForm: () => null }));
vi.mock("@/components/ops/hl/SpotSendForm", () => ({ SpotSendForm: () => null }));
vi.mock("@/components/ops/hl/SpotWithdrawForm", () => ({ SpotWithdrawForm: () => null }));
vi.mock("@/components/ops/hl/UsdSendForm", () => ({ UsdSendForm: () => null }));
vi.mock("@/components/ops/hl/WithdrawForm", () => ({ WithdrawForm: () => null }));
vi.mock("@/components/ops/hl/ClassTransferForm", () => ({ ClassTransferForm: () => null }));
vi.mock("@/components/ops/hl/UnitWithdrawForm", () => ({ UnitWithdrawForm: () => null }));

const SAFE = "0x1111111111111111111111111111111111111111";
const USER = "0x52908400098527886E0F7030069857D2E4169EE7";
const ZERO = `0x${"0".repeat(40)}`;
const low = (n: number): string => `0x${n.toString(16).padStart(40, "0")}`;

describe("the one check of a recipient address", () => {
	it("accepts an ordinary address, in any case", () => {
		expect(recipientProblem(USER)).toBeUndefined();
		expect(recipientProblem(` ${USER.toLowerCase()} `)).toBeUndefined();
		expect(requireRecipient(USER.toLowerCase())).toBe(USER);
	});

	it("takes mixed case for a checksum, and a wrong one for a typo", () => {
		// One letter's case flipped: still twenty bytes, no longer the address that was meant to be typed.
		const typo = USER.replace("E7", "e7");
		expect(typo).not.toBe(USER);
		expect(recipientProblem(typo)).toBe("address.checksum");
		expect(() => requireRecipient(typo)).toThrow();
		expect(parseAddress(typo)).toBeUndefined();
		// No case, no checksum to hold.
		expect(recipientProblem(USER.toLowerCase())).toBeUndefined();
		expect(recipientProblem(`0x${USER.slice(2).toUpperCase()}`)).toBeUndefined();
		expect(parseAddress(USER.toLowerCase())).toBe(USER);
	});

	it("refuses what is not an address, and places funds do not come back from", () => {
		expect(recipientProblem("")).toBe("error.required");
		expect(recipientProblem("0x1234")).toBe("error.invalidAddress");
		expect(recipientProblem(ZERO)).toBe("address.zero");
		// Precompiles, and the values Uniswap's router reads as "the caller" and "the router".
		expect(recipientProblem(low(1))).toBe("address.reserved");
		expect(recipientProblem(low(2))).toBe("address.reserved");
		expect(recipientProblem(low(0xffff))).toBe("address.reserved");
		expect(recipientProblem(low(0x10000))).toBeUndefined();
		expect(recipientProblem("0x000000000000000000000000000000000000dEaD")).toBe("address.burn");
		// Other addresses nobody holds: more burn conventions, and placeholders for "the coin" and "none".
		for (const dead of [
			`0x${"dead".repeat(10)}`,
			`0xdead${"0".repeat(36)}`,
			`0x${"E".repeat(40)}`,
			`0x${"f".repeat(40)}`,
			`0x${"fe".repeat(20)}`,
		]) {
			expect(recipientProblem(dead)).toBe("address.burn");
		}
		expect(recipientProblem(SAFE, { self: SAFE.toUpperCase().replace("0X", "0x") })).toBe("address.self");
	});

	it("knows Hyperliquid's system addresses from accounts, where a Hyperliquid account is paid", () => {
		for (const system of [hlSystemAddress(1, "PURR"), hlSystemAddress(150, "HYPE"), hlSystemAddress(268, "USDT0")]) {
			expect(recipientProblem(system, { hyperliquid: true })).toBe("address.hlSystem");
			// On an EVM network the same bytes are just an address.
			expect(recipientProblem(system)).toBeUndefined();
		}
		expect(recipientProblem(`0x${"3".repeat(40)}`, { hyperliquid: true })).toBe("address.hlSystem");
		expect(recipientProblem(USER, { hyperliquid: true })).toBeUndefined();
	});

	it("refuses the contracts an operation works with", () => {
		const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
		const ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
		const eth = knownContracts(1);
		// The token, the exchange, both bridges and the Safe system contracts of the network.
		for (const contract of [
			USDC,
			"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
			"0xdAC17F958D2ee523a2206206994597C13D831ec7",
			ROUTER,
			"0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
			"0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
			"0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
		]) {
			expect(recipientProblem(contract, { contracts: eth })).toBe("address.contract");
		}
		expect(recipientProblem(USER, { contracts: eth })).toBeUndefined();
		expect(knownContracts(undefined)).toEqual([]);
		// Hyperliquid's bridge, on the one network it lives on: USDC sent to it from a Safe is a deposit nobody can use.
		const BRIDGE = "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7";
		expect(recipientProblem(BRIDGE, { contracts: knownContracts(42161) })).toBe("address.contract");
		expect(recipientProblem(BRIDGE, { contracts: knownContracts(1) })).toBeUndefined();
		expect(knownContracts(421614)).toContain("0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89");

		// A send of a token to the token itself, or to the router – from the form or from an import.
		const send = (recipient: string, token = USDC) =>
			(safeSendOp.buildSafe as NonNullable<typeof safeSendOp.buildSafe>)(
				{ token, symbol: "USDC", decimals: 6, recipient, amount: "1" },
				{ chainId: 1, safe: SAFE },
			);
		expect(() => send(USDC)).toThrow();
		expect(() => send(ROUTER)).toThrow();
		expect(() =>
			send("0x514910771AF9Ca656af840dff83E8264EcF986CA", "0x514910771AF9Ca656af840dff83E8264EcF986CA"),
		).toThrow();
		expect(send(USER)).toHaveLength(1);

		// The coin sent to its wrapped-token contract is how it is wrapped; a token sent there is lost.
		const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
		const coin = (recipient: string) =>
			(safeSendOp.buildSafe as NonNullable<typeof safeSendOp.buildSafe>)(
				{ token: "", symbol: "ETH", decimals: 18, recipient, amount: "1" },
				{ chainId: 1, safe: SAFE },
			);
		expect(coin(WETH)).toEqual([{ to: WETH, value: 10n ** 18n, data: "0x" }]);
		expect(() => send(WETH)).toThrow();
		expect(() => send(WETH, WETH)).toThrow();
		// Any other contract of the network is no place for the coin either.
		expect(() => coin(ROUTER)).toThrow();
		expect(() => coin(USDC)).toThrow();
		const rows = safeSendOp.summary(
			{ token: "", symbol: "ETH", decimals: 18, recipient: WETH, amount: "1" },
			{ t: (k) => k, lang: "en", account: { chainId: 1 } as never },
		);
		expect(rows.some((r) => r.label === "safe.send.wrap")).toBe(true);

		// A bridge pays on another network: the contracts of that one are no recipients either.
		const bridge: SwapParams = {
			tokenIn: USDC,
			tokenInSymbol: "USDC",
			tokenInDecimals: 6,
			amount: "1000",
			destChainId: 8453,
			tokenOut: "",
			tokenOutSymbol: "",
			tokenOutDecimals: 18,
			recipient: USER,
			slippage: "1",
			feeTier: 0,
			speed: "standard",
			forward: false,
			forwardLevel: "med",
			resolved: {
				amountIn: "1000000000",
				preparedAt: 1,
				bridge: {
					amount: "1000000000",
					maxFee: "0",
					forwardFee: "0",
					percentFee: "0",
					finality: 2000,
					forward: false,
					receive: "1000000000",
				},
			},
		};
		expect(buildSwapCalls(bridge, 1, SAFE)).toHaveLength(2);
		// USDC on Base, the router on Ethereum, the token being sent.
		for (const recipient of ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", ROUTER, USDC]) {
			expect(() => buildSwapCalls({ ...bridge, recipient }, 1, SAFE)).toThrow();
		}
	});

	it("is what every builder runs, whatever the form let through", () => {
		const send = (recipient: string) =>
			(safeSendOp.buildSafe as NonNullable<typeof safeSendOp.buildSafe>)(
				{ token: "", symbol: "ETH", decimals: 18, recipient, amount: "1" },
				{ chainId: 1, safe: SAFE },
			);
		expect(send(USER)[0].to).toBe(USER);
		expect(() => send(ZERO)).toThrow();
		expect(() => send(low(2))).toThrow();

		const hl = { env: "mainnet" as const, nonce: 1, user: USER as never };
		const usd = usdSendOp.buildHl as NonNullable<typeof usdSendOp.buildHl>;
		expect(usd({ destination: USER, amount: "5" }, hl).destination).toBe(USER.toLowerCase());
		expect(() => usd({ destination: ZERO, amount: "5" }, hl)).toThrow();
		expect(() => usd({ destination: hlSystemAddress(150, "HYPE"), amount: "5" }, hl)).toThrow();
		const spot = spotSendOp.buildHl as NonNullable<typeof spotSendOp.buildHl>;
		const token = { token: 1, tokenRef: "PURR:0xc1fb593aeffbeb02f85e0308e9956a90", coin: "PURR", amount: "5" };
		expect(() => spot({ ...token, destination: hlSystemAddress(1, "PURR") }, hl)).toThrow();
		expect(spot({ ...token, destination: USER }, hl).destination).toBe(USER.toLowerCase());
		const withdraw = withdrawOp.buildHl as NonNullable<typeof withdrawOp.buildHl>;
		expect(() => withdraw({ destination: low(1), amount: "5" }, hl)).toThrow();

		const swap: SwapParams = {
			tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
			tokenInSymbol: "USDC",
			tokenInDecimals: 6,
			amount: "1000",
			destChainId: 8453,
			tokenOut: "",
			tokenOutSymbol: "",
			tokenOutDecimals: 18,
			recipient: low(2),
			slippage: "1",
			feeTier: 0,
			speed: "standard",
			forward: false,
			forwardLevel: "med",
			resolved: {
				amountIn: "1000000000",
				preparedAt: 1,
				bridge: {
					amount: "1000000000",
					maxFee: "0",
					forwardFee: "0",
					percentFee: "0",
					finality: 2000,
					forward: false,
					receive: "1000000000",
				},
			},
		};
		expect(() => buildSwapCalls(swap, 1, SAFE)).toThrow();
		expect(buildSwapCalls({ ...swap, recipient: USER }, 1, SAFE)).toHaveLength(2);
	});
});

describe("Unit withdrawal to an EVM network", () => {
	it("holds the destination to the same rule as any recipient", () => {
		const errors = (destination: string) =>
			unitWithdrawOp.validate(
				{
					token: 221,
					tokenRef: "UETH:0xe1edd30daaf5caac3fe63569e24748da",
					coin: "UETH",
					amount: "1",
					destination,
					protocolAddress: "",
					signatures: {},
				},
				{ account: { env: "mainnet" } as never, accounts: [], signers: [] },
				(k) => k,
			).destination;
		expect(errors(USER)).toBeUndefined();
		expect(errors(ZERO)).toBe("address.zero");
		expect(errors("0x000000000000000000000000000000000000dEaD")).toBe("address.burn");
	});
});

describe("CCTP speed", () => {
	it("offers fast transfers only where Circle has them", () => {
		expect(fastAvailable("ethereum")).toBe(true);
		expect(fastAvailable("base")).toBe(true);
		expect(fastAvailable("hyperevm")).toBe(false);
		expect(fastAvailable("polygon")).toBe(false);
	});
});

describe("a Solana destination", () => {
	const account = (value: unknown) => parseSolanaAccount({ jsonrpc: "2.0", id: 1, result: { context: {}, value } });
	const SYSTEM = "11111111111111111111111111111111";

	it("is a wallet when nothing is there yet, or the System Program owns it", () => {
		expect(account(null)).toBeNull();
		expect(isSolanaWallet(null)).toBe(true);
		expect(isSolanaWallet(account({ owner: SYSTEM, executable: false }) ?? { owner: "", executable: true })).toBe(true);
	});

	it("is not one when it is a token account or a program", () => {
		expect(isSolanaWallet({ owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", executable: false })).toBe(false);
		expect(isSolanaWallet({ owner: "BPFLoaderUpgradeab1e11111111111111111111111", executable: true })).toBe(false);
		expect(isSolanaWallet({ owner: SYSTEM, executable: true })).toBe(false);
	});

	it("tells an answer from no answer", () => {
		expect(parseSolanaAccount({ error: { code: 403 } })).toBeUndefined();
		expect(parseSolanaAccount(null)).toBeUndefined();
		expect(account({ lamports: 1 })).toBeUndefined();
	});
});

describe("new signers the app has no key for", () => {
	const signer = {
		id: USER.toLowerCase(),
		address: USER as never,
		name: "Ledger",
		wallet: "ledger" as const,
		addedAt: 1,
	};

	it("are the addresses that are not its own signers", () => {
		const other = "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
		expect(unknownSigners([USER.toLowerCase(), other], [signer])).toEqual([other]);
		expect(unknownSigners([USER], [signer])).toEqual([]);
		expect(unknownSigners([other], [])).toEqual([other]);
		// What is not an address yet is the form's business, not a signer to ask about.
		expect(unknownSigners(["", "0x12"], [signer])).toEqual([]);
	});
});

describe("several findings about one operation", () => {
	it("are shown together, wait together and are looked at again together", () => {
		let calls = 0;
		const merged = mergeNotices(
			{ notices: [{ id: "a", text: "A", confirm: "ok" }], refresh: () => calls++, checking: true },
			{ notices: [] },
			{ notices: [{ id: "b", text: "B" }], pending: true, refresh: () => calls++ },
		);
		expect(merged.notices.map((n) => n.id)).toEqual(["a", "b"]);
		expect(merged.pending).toBe(true);
		expect(merged.checking).toBe(true);
		merged.refresh?.();
		expect(calls).toBe(2);
		const none = mergeNotices({ notices: [] }, { notices: [] });
		expect(none).toMatchObject({ notices: [], pending: false, checking: false });
		expect(none.refresh).toBeUndefined();
	});
});
