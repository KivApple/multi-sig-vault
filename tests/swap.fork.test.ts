/**
 * End-to-end simulation of the swap/bridge operation on anvil forks of real networks.
 * Skipped by default (needs network + foundry): `MSV_FORK=1 pnpm vitest run tests/swap.fork.test.ts`.
 * Optional `MSV_FORK_CHAINS=1,8453` limits the chains.
 */
import "fake-indexeddb/auto";
import { spawn, type ChildProcess } from "node:child_process";
import {
	createPublicClient,
	createWalletClient,
	decodeEventLog,
	encodeFunctionData,
	getTypesForEIP712Domain,
	http,
	parseEventLogs,
	type Address,
	type Hex,
	type PublicClient,
	type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getChain } from "@/config/chains";
import { acrossToken, SPOKE_POOL_ABI, spokePoolOf } from "@/lib/evm/across";
import { addressToBytes32, FORWARD_HOOK_DATA, TOKEN_MESSENGER_ABI } from "@/lib/evm/cctp";
import { NATIVE, type SwapParams } from "@/lib/evm/swapBuild";
import { swapOp } from "@/lib/ops/safe/swap";
import type { OpEnv } from "@/lib/ops/types";
import { ERC20_ABI, PROXY_FACTORY_ABI, SAFE_ABI } from "@/lib/safe/abis";
import { SAFE_141 } from "@/lib/safe/deployments";
import { encodeExecTransaction, safeTxTypedData, toSafeTx } from "@/lib/safe/tx";
import { useAppStore } from "@/store/appStore";
import type { Account } from "@/types/domain";

// The operation definition references its React components; they are irrelevant here.
vi.mock("@/components/ops/safe/SwapForm", () => ({ SwapForm: () => null }));
vi.mock("@/components/ops/safe/SwapResult", () => ({ SwapResult: () => null }));

const ENABLED = process.env.MSV_FORK === "1";
const ONLY = process.env.MSV_FORK_CHAINS?.split(",").map(Number);
const OWNER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const owner = privateKeyToAccount(OWNER_KEY);
const STRANGER: Address = "0x00000000000000000000000000000000DeaDBeef";
const ZERO: Address = "0x0000000000000000000000000000000000000000";

interface Fork {
	chainId: number;
	url: string;
	proc: ChildProcess;
	pub: PublicClient;
	wallet: WalletClient;
	safe: Address;
	account: Account;
}

const FORK_RPC: Record<number, string> = {
	1: process.env.MSV_FORK_RPC_1 ?? "https://eth.drpc.org",
	8453: "https://mainnet.base.org",
	42161: "https://arb1.arbitrum.io/rpc",
	999: "https://rpc.hyperliquid.xyz/evm",
	56: process.env.MSV_FORK_RPC_56 ?? "https://bsc-rpc.publicnode.com",
	137: process.env.MSV_FORK_RPC_137 ?? "https://polygon-bor-rpc.publicnode.com",
};

let nextPort = 18545 + Math.floor(Math.random() * 500);

const startFork = async (chainId: number): Promise<Fork> => {
	const port = nextPort++;
	const url = `http://127.0.0.1:${port}`;
	const proc = spawn(
		"anvil",
		[
			"--fork-url",
			FORK_RPC[chainId],
			"--port",
			String(port),
			"--chain-id",
			String(chainId),
			"--no-rate-limit",
			"--timeout",
			"20000",
			"--retries",
			"8",
			"--silent",
		],
		{
			stdio: "ignore",
		},
	);
	const pub = createPublicClient({ transport: http(url, { timeout: 120_000 }) }) as PublicClient;
	for (let i = 0; ; i++) {
		try {
			await pub.getBlockNumber();
			break;
		} catch (e) {
			if (i > 100 || proc.exitCode !== null) throw new Error(`anvil did not start for chain ${chainId}: ${String(e)}`);
			await new Promise((r) => setTimeout(r, 300));
		}
	}
	const wallet = createWalletClient({ account: owner, transport: http(url, { timeout: 120_000 }) });
	await pub.request({ method: "anvil_setBalance" as never, params: [owner.address, "0x56BC75E2D63100000"] as never });

	// A fresh 1-of-1 Safe 1.4.1 through the real proxy factory.
	const initializer = encodeFunctionData({
		abi: SAFE_ABI,
		functionName: "setup",
		args: [[owner.address], 1n, ZERO, "0x", SAFE_141.fallbackHandler, ZERO, 0n, ZERO],
	});
	const hash = await wallet.sendTransaction({
		chain: null,
		to: SAFE_141.proxyFactory,
		data: encodeFunctionData({
			abi: PROXY_FACTORY_ABI,
			functionName: "createProxyWithNonce",
			args: [SAFE_141.singletonL2, initializer, BigInt(Date.now())],
		}),
	});
	const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 400_000 });
	const created = parseEventLogs({ abi: PROXY_FACTORY_ABI, logs: receipt.logs, eventName: "ProxyCreation" })[0];
	const safe = created.args.proxy;
	await pub.request({ method: "anvil_setBalance" as never, params: [safe, "0x56BC75E2D63100000"] as never });

	// Route all app reads for this chain to the fork.
	useAppStore.setState((s) => ({
		settings: { ...s.settings, rpcOverrides: { ...s.settings.rpcOverrides, [String(chainId)]: url } },
	}));
	const account: Account = {
		id: `safe:${chainId}:${safe.toLowerCase()}`,
		kind: "safe",
		env: "mainnet",
		chainId,
		address: safe,
		hidden: false,
		hideDust: false,
		addedAt: 0,
	};
	return { chainId, url, proc, pub, wallet, safe, account };
};

const params = (f: Fork, over: Partial<SwapParams>): SwapParams => ({
	tokenIn: NATIVE,
	tokenInSymbol: getChain(f.chainId).nativeSymbol,
	tokenInDecimals: 18,
	amount: "1",
	destChainId: f.chainId,
	tokenOut: "",
	tokenOutSymbol: "",
	tokenOutDecimals: 18,
	recipient: "",
	slippage: "3",
	feeTier: 0,
	speed: "standard",
	forward: true,
	forwardLevel: "med",
	...over,
});

/** prepare → build → sign → execTransaction, exactly the app's code path. */
const run = async (f: Fork, p: SwapParams) => {
	const env: OpEnv = { account: f.account, accounts: [], signers: [] };
	expect(swapOp.validate(p, env, (k) => k)).toEqual({});
	const prepared = await (swapOp.prepare as NonNullable<typeof swapOp.prepare>)(p, env);
	const build = swapOp.buildSafe as NonNullable<typeof swapOp.buildSafe>;
	const calls = build(prepared, { chainId: f.chainId, safe: f.safe });
	// Determinism: the engine re-runs the builder to verify the payload.
	expect(build(structuredClone(prepared), { chainId: f.chainId, safe: f.safe })).toEqual(calls);
	const nonce = await f.pub.readContract({ address: f.safe, abi: SAFE_ABI, functionName: "nonce" });
	const tx = toSafeTx(calls, nonce);
	const typed = safeTxTypedData(f.chainId, f.safe, tx);
	const signature = await owner.signTypedData({
		domain: typed.domain,
		types: { EIP712Domain: getTypesForEIP712Domain({ domain: typed.domain }), ...typed.types },
		primaryType: typed.primaryType,
		message: typed.message,
	} as never);
	const hash = await f.wallet.sendTransaction({
		chain: null,
		account: owner,
		to: f.safe,
		data: encodeExecTransaction(tx, [{ signer: owner.address, signature }]),
		gas: 3_000_000n,
	});
	const receipt = await f.pub.waitForTransactionReceipt({ hash, timeout: 400_000 });
	expect(receipt.status).toBe("success");
	expect(await f.pub.readContract({ address: f.safe, abi: SAFE_ABI, functionName: "nonce" })).toBe(nonce + 1n);
	return { prepared, receipt, resolved: prepared.resolved as NonNullable<SwapParams["resolved"]> };
};

const balanceOf = (f: Fork, token: Address, who: Address = f.safe): Promise<bigint> =>
	f.pub.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [who] });

const burnEvent = (f: Fork, logs: Parameters<typeof parseEventLogs>[0]["logs"]) => {
	const messenger = getChain(f.chainId).cctp?.tokenMessenger.toLowerCase();
	for (const log of logs) {
		if (log.address.toLowerCase() !== messenger) continue;
		try {
			const ev = decodeEventLog({ abi: TOKEN_MESSENGER_ABI, data: log.data, topics: log.topics });
			if (ev.eventName === "DepositForBurn") return ev.args;
		} catch {
			// Other events of the messenger.
		}
	}
	throw new Error("DepositForBurn not emitted");
};

const TOKENS: Record<number, { usdt?: Address; alt?: { address: Address; symbol: string; decimals: number } }> = {
	1: {
		usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
		alt: { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", symbol: "LINK", decimals: 18 },
	},
	8453: {},
	42161: {},
	999: {},
};

const suite = (chainId: number, bridgeTo: number): void => {
	const enabled = ENABLED && (!ONLY || ONLY.includes(chainId));
	describe.skipIf(!enabled)(`swap/bridge on a fork of chain ${chainId}`, () => {
		let f: Fork;
		const chain = getChain(chainId);
		const usdc = chain.usdc as Address;
		const weth = chain.dex?.weth ?? chain.wrappedNative;

		beforeAll(async () => {
			f = await startFork(chainId);
		}, 180_000);
		afterAll(() => {
			f?.proc.kill();
		});

		it("native → USDC", async () => {
			const before = await balanceOf(f, usdc);
			const { resolved } = await run(
				f,
				params(f, { amount: "2", tokenOut: usdc, tokenOutSymbol: "USDC", tokenOutDecimals: 6 }),
			);
			const got = (await balanceOf(f, usdc)) - before;
			expect(got).toBeGreaterThanOrEqual(BigInt(resolved.swap?.minOut ?? 0));
			expect(got).toBeGreaterThan(0n);
			console.log(
				`[${chainId}] 2 ${chain.nativeSymbol} → ${Number(got) / 1e6} USDC via fees ${resolved.swap?.fees.join("+")}, impact ${resolved.swap?.impactBps} bps`,
			);
		}, 180_000);

		it("USDC → wrapped native (ERC-20 → ERC-20)", async () => {
			const before = await balanceOf(f, weth);
			const usdcBefore = await balanceOf(f, usdc);
			const { resolved } = await run(
				f,
				params(f, {
					tokenIn: usdc,
					tokenInSymbol: "USDC",
					tokenInDecimals: 6,
					amount: "20",
					tokenOut: weth,
					tokenOutSymbol: "WETH",
					tokenOutDecimals: 18,
				}),
			);
			expect((await balanceOf(f, weth)) - before).toBeGreaterThanOrEqual(BigInt(resolved.swap?.minOut ?? 0));
			expect(usdcBefore - (await balanceOf(f, usdc))).toBe(20_000_000n);
			// Exact approval is fully consumed.
			expect(
				await f.pub.readContract({
					address: usdc,
					abi: ERC20_ABI,
					functionName: "allowance",
					args: [f.safe, chain.dex?.router as Address],
				}),
			).toBe(0n);
		}, 180_000);

		it("USDC → native coin, unwrapped to another recipient", async () => {
			const before = await f.pub.getBalance({ address: STRANGER });
			const { resolved } = await run(
				f,
				params(f, {
					tokenIn: usdc,
					tokenInSymbol: "USDC",
					tokenInDecimals: 6,
					amount: "20",
					tokenOut: NATIVE,
					tokenOutSymbol: chain.nativeSymbol,
					recipient: STRANGER,
				}),
			);
			const got = (await f.pub.getBalance({ address: STRANGER })) - before;
			expect(got).toBeGreaterThanOrEqual(BigInt(resolved.swap?.minOut ?? 0));
			expect(got).toBeGreaterThan(0n);
		}, 180_000);

		const tk = TOKENS[chainId];
		it.skipIf(!tk.usdt || !tk.alt)(
			"USDT → another ERC-20 (USDT-style approve, multi-hop route)",
			async () => {
				const usdt = tk.usdt as Address;
				const alt = tk.alt as NonNullable<typeof tk.alt>;
				await run(
					f,
					params(f, {
						tokenIn: usdc,
						tokenInSymbol: "USDC",
						tokenInDecimals: 6,
						amount: "50",
						tokenOut: usdt,
						tokenOutSymbol: "USDT",
						tokenOutDecimals: 6,
					}),
				);
				const usdtBalance = await balanceOf(f, usdt);
				expect(usdtBalance).toBeGreaterThan(40_000_000n);
				const before = await balanceOf(f, alt.address);
				const { resolved } = await run(
					f,
					params(f, {
						tokenIn: usdt,
						tokenInSymbol: "USDT",
						tokenInDecimals: 6,
						amount: "40",
						tokenOut: alt.address,
						tokenOutSymbol: alt.symbol,
						tokenOutDecimals: alt.decimals,
					}),
				);
				console.log(
					`[${chainId}] USDT → ${alt.symbol} route: ${resolved.swap?.tokens.join(" → ")} fees ${resolved.swap?.fees.join("+")}`,
				);
				expect(resolved.swap?.tokens.length).toBe(3);
				expect((await balanceOf(f, alt.address)) - before).toBeGreaterThanOrEqual(BigInt(resolved.swap?.minOut ?? 0));
			},
			900_000,
		);

		it("USDC bridge with Circle forwarding", async () => {
			const before = await balanceOf(f, usdc);
			const { resolved, receipt } = await run(
				f,
				params(f, {
					tokenIn: usdc,
					tokenInSymbol: "USDC",
					tokenInDecimals: 6,
					amount: "25",
					destChainId: bridgeTo,
					recipient: STRANGER,
				}),
			);
			expect(resolved.swap).toBeUndefined();
			const bridge = resolved.bridge as NonNullable<typeof resolved.bridge>;
			expect(before - (await balanceOf(f, usdc))).toBe(25_000_000n);
			const ev = burnEvent(f, receipt.logs);
			expect(ev.amount).toBe(25_000_000n);
			expect(ev.burnToken.toLowerCase()).toBe(usdc.toLowerCase());
			expect(ev.depositor.toLowerCase()).toBe(f.safe.toLowerCase());
			expect(ev.mintRecipient).toBe(addressToBytes32(STRANGER));
			expect(ev.destinationDomain).toBe(getChain(bridgeTo).cctp?.domain);
			expect(ev.destinationCaller).toBe(`0x${"00".repeat(32)}`);
			expect(ev.maxFee).toBe(BigInt(bridge.maxFee));
			expect(ev.minFinalityThreshold).toBe(2000);
			expect(ev.hookData).toBe(FORWARD_HOOK_DATA);
			expect(BigInt(bridge.maxFee)).toBeGreaterThan(0n);
			expect(BigInt(bridge.receive)).toBe(25_000_000n - BigInt(bridge.maxFee));
			console.log(`[${chainId}→${bridgeTo}] forward fee ${Number(bridge.maxFee) / 1e6} USDC`);
		}, 180_000);

		it("native → USDC → bridge without forwarding", async () => {
			const before = await balanceOf(f, usdc);
			const fast = chain.key !== "hyperevm";
			const { resolved, receipt } = await run(
				f,
				// The coin could cross as itself between some of these networks: USDC is asked for.
				params(f, {
					amount: "1",
					destChainId: bridgeTo,
					receive: "USDC",
					forward: false,
					speed: fast ? "fast" : "standard",
				}),
			);
			const swap = resolved.swap as NonNullable<typeof resolved.swap>;
			const bridge = resolved.bridge as NonNullable<typeof resolved.bridge>;
			const ev = burnEvent(f, receipt.logs);
			// Exactly the guaranteed minimum is bridged; the surplus stays in the Safe.
			expect(ev.amount).toBe(BigInt(swap.minOut));
			expect(bridge.amount).toBe(swap.minOut);
			expect(ev.mintRecipient).toBe(addressToBytes32(f.safe));
			expect(ev.hookData).toBe("0x");
			expect(ev.minFinalityThreshold).toBe(fast ? 1000 : 2000);
			expect(ev.maxFee).toBe(BigInt(bridge.maxFee));
			expect(bridge.forwardFee).toBe("0");
			const surplus = (await balanceOf(f, usdc)) - before;
			expect(surplus).toBeGreaterThanOrEqual(0n);
			console.log(
				`[${chainId}→${bridgeTo}] bridged ${Number(ev.amount) / 1e6} USDC, surplus kept ${Number(surplus) / 1e6}, maxFee ${bridge.maxFee}`,
			);
		}, 180_000);

		it("prepare refuses an operation that would revert", async () => {
			const env: OpEnv = { account: f.account, accounts: [], signers: [] };
			const p = params(f, {
				tokenIn: usdc,
				tokenInSymbol: "USDC",
				tokenInDecimals: 6,
				amount: "900000000",
				destChainId: bridgeTo,
			});
			await expect((swapOp.prepare as NonNullable<typeof swapOp.prepare>)(p, env)).rejects.toThrow();
		}, 120_000);
	});
};

suite(1, 8453);
suite(8453, 999);
suite(42161, 1);
suite(999, 42161);

/**
 * BNB Chain: PancakeSwap V3 instead of Uniswap and USDT (18 decimals) instead of USDC.
 * The router is a different contract with the same calls – this proves it on the real one.
 */
describe.skipIf(!ENABLED || (!!ONLY && !ONLY.includes(56)))("swap on a fork of chain 56", () => {
	let f: Fork;
	const chain = getChain(56);
	const usdt = chain.quote?.address as Address;
	const wbnb = chain.wrappedNative;

	beforeAll(async () => {
		f = await startFork(56);
	}, 180_000);
	afterAll(() => {
		f?.proc.kill();
	});

	it("native → USDT at a market price", async () => {
		const before = await balanceOf(f, usdt);
		const { resolved } = await run(
			f,
			params(f, { amount: "20", tokenOut: usdt, tokenOutSymbol: "USDT", tokenOutDecimals: 18 }),
		);
		const got = (await balanceOf(f, usdt)) - before;
		expect(got).toBeGreaterThanOrEqual(BigInt(resolved.swap?.minOut ?? 0));
		// Twenty coins must not move the price: a thin pool would show here.
		expect(resolved.swap?.impactBps ?? 10_000).toBeLessThan(100);
		expect(resolved.swap?.fees.every((fee) => chain.dex?.feeTiers.includes(fee))).toBe(true);
		console.log(
			`[56] 20 BNB → ${Number(got) / 1e18} USDT via fees ${resolved.swap?.fees.join("+")}, impact ${resolved.swap?.impactBps} bps`,
		);
	}, 180_000);

	it("USDT → wrapped native, the approval fully used", async () => {
		const before = await balanceOf(f, wbnb);
		const usdtBefore = await balanceOf(f, usdt);
		const { resolved } = await run(
			f,
			params(f, {
				tokenIn: usdt,
				tokenInSymbol: "USDT",
				tokenInDecimals: 18,
				amount: "500",
				tokenOut: wbnb,
				tokenOutSymbol: "WBNB",
				tokenOutDecimals: 18,
			}),
		);
		expect((await balanceOf(f, wbnb)) - before).toBeGreaterThanOrEqual(BigInt(resolved.swap?.minOut ?? 0));
		expect(usdtBefore - (await balanceOf(f, usdt))).toBe(500n * 10n ** 18n);
		expect(
			await f.pub.readContract({
				address: usdt,
				abi: ERC20_ABI,
				functionName: "allowance",
				args: [f.safe, chain.dex?.router as Address],
			}),
		).toBe(0n);
	}, 180_000);

	it("USDT → native coin, unwrapped to another recipient", async () => {
		const before = await f.pub.getBalance({ address: STRANGER });
		const { resolved } = await run(
			f,
			params(f, {
				tokenIn: usdt,
				tokenInSymbol: "USDT",
				tokenInDecimals: 18,
				amount: "500",
				tokenOut: NATIVE,
				tokenOutSymbol: "BNB",
				recipient: STRANGER,
			}),
		);
		const got = (await f.pub.getBalance({ address: STRANGER })) - before;
		expect(got).toBeGreaterThanOrEqual(BigInt(resolved.swap?.minOut ?? 0));
		expect(got).toBeGreaterThan(0n);
	}, 180_000);
});

/**
 * USDT to and from BNB Chain through Across, on forks of the real SpokePools with a live quote.
 * Only the deposit can be proven on a fork; the fill is a relayer's transaction on the other network.
 */
const usdtSide = (chainId: number) => ({
	spokePool: spokePoolOf(chainId),
	usdt: acrossToken(chainId, "USDT").address,
	usdtDecimals: acrossToken(chainId, "USDT").decimals,
});

const acrossSuite = (chainId: number, destChainId: number, nativeAmount: string): void => {
	const enabled = ENABLED && (!ONLY || ONLY.includes(chainId));
	describe.skipIf(!enabled)(`USDT through Across from chain ${chainId} to ${destChainId}`, () => {
		let f: Fork;
		const chain = getChain(chainId);
		const src = usdtSide(chainId);
		const dst = usdtSide(destChainId);
		// Where the coin is ETH it crosses as itself; elsewhere it is sold for USDT first.
		const weth = getChain(chainId).across?.tokens.WETH;
		const coinIsEth = !!weth && weth.address.toLowerCase() === chain.wrappedNative.toLowerCase();

		beforeAll(async () => {
			f = await startFork(chainId);
		}, 180_000);
		afterAll(() => {
			f?.proc.kill();
		});

		const depositOf = (logs: Parameters<typeof parseEventLogs>[0]["logs"]) => {
			const events = parseEventLogs({ abi: SPOKE_POOL_ABI, logs, eventName: "FundsDeposited" }).filter(
				(e) => e.address.toLowerCase() === src.spokePool.toLowerCase(),
			);
			expect(events).toHaveLength(1);
			return events[0].args;
		};
		const allowance = (): Promise<bigint> =>
			f.pub.readContract({
				address: src.usdt,
				abi: ERC20_ABI,
				functionName: "allowance",
				args: [f.safe, src.spokePool],
			});

		it.skipIf(!coinIsEth)(
			"the coin crosses as itself, sent as the value of the call",
			async () => {
				const from = acrossToken(chainId, "WETH");
				const to = acrossToken(destChainId, "WETH");
				const escrowBefore = await balanceOf(f, from.address, src.spokePool);
				const coinBefore = await f.pub.getBalance({ address: f.safe });
				const { resolved, receipt } = await run(f, params(f, { amount: nativeAmount, destChainId }));
				const leg = resolved.across as NonNullable<typeof resolved.across>;
				expect(resolved.swap).toBeUndefined();
				expect(resolved.bridge).toBeUndefined();
				expect(leg.asset).toBe("WETH");
				const ev = depositOf(receipt.logs);
				expect(ev.inputToken).toBe(addressToBytes32(from.address));
				expect(ev.outputToken).toBe(addressToBytes32(to.address));
				expect(ev.inputAmount).toBe(BigInt(leg.amount));
				expect(ev.outputAmount).toBe(BigInt(leg.output));
				expect(ev.destinationChainId).toBe(BigInt(destChainId));
				expect(ev.recipient).toBe(addressToBytes32(f.safe));
				// The pool wrapped the coin: it holds that much more of the token, the Safe that much less of the coin.
				expect((await balanceOf(f, from.address, src.spokePool)) - escrowBefore).toBe(BigInt(leg.amount));
				expect(coinBefore - (await f.pub.getBalance({ address: f.safe }))).toBe(BigInt(leg.amount));
				console.log(
					`[${chainId}→${destChainId}] ${nativeAmount} ${chain.nativeSymbol} → ${Number(leg.output) / 1e18} (unwrap ${leg.unwrap}), bridge fee ${Number(leg.fee) / 1e18}`,
				);
			},
			300_000,
		);

		it.skipIf(coinIsEth)(
			"native coin → USDT → the other network, in one transaction",
			async () => {
				const escrowBefore = await balanceOf(f, src.usdt, src.spokePool);
				const { resolved, receipt } = await run(f, params(f, { amount: nativeAmount, destChainId }));
				const leg = resolved.across as NonNullable<typeof resolved.across>;
				expect(resolved.bridge).toBeUndefined();
				expect(leg.amount).toBe(resolved.swap?.minOut);
				const ev = depositOf(receipt.logs);
				expect(ev.inputToken).toBe(addressToBytes32(src.usdt));
				expect(ev.outputToken).toBe(addressToBytes32(dst.usdt));
				expect(ev.inputAmount).toBe(BigInt(leg.amount));
				expect(ev.outputAmount).toBe(BigInt(leg.output));
				expect(ev.destinationChainId).toBe(BigInt(destChainId));
				expect(ev.depositor).toBe(addressToBytes32(f.safe));
				expect(ev.recipient).toBe(addressToBytes32(f.safe));
				expect(BigInt(ev.exclusiveRelayer)).toBe(0n);
				expect(ev.message).toBe("0x");
				// The contract stamps the quote time and the deadline itself, from the block that ran the deposit.
				const block = await f.pub.getBlock({ blockNumber: receipt.blockNumber });
				expect(ev.quoteTimestamp).toBe(Number(block.timestamp));
				expect(ev.fillDeadline - ev.quoteTimestamp).toBe(leg.fillDeadlineOffset);
				expect((await balanceOf(f, src.usdt, src.spokePool)) - escrowBefore).toBe(BigInt(leg.amount));
				expect(await allowance()).toBe(0n);
				console.log(
					`[${chainId}→${destChainId}] ${nativeAmount} ${chain.nativeSymbol} → ${Number(leg.amount) / 10 ** src.usdtDecimals} USDT via ${resolved.swap?.tokens.length === 2 ? "a direct pool" : "two hops"} (fees ${resolved.swap?.fees.join("+")}, impact ${resolved.swap?.impactBps} bps) → ${Number(leg.output) / 10 ** dst.usdtDecimals} USDT, bridge fee ${Number(leg.fee) / 10 ** src.usdtDecimals}`,
				);
			},
			300_000,
		);

		it("USDT already in the Safe → another recipient, after a leftover allowance", async () => {
			// The swap above left its surplus over the guaranteed minimum in the Safe – unless the pool gave exactly it.
			await run(
				f,
				params(f, {
					amount: nativeAmount,
					tokenOut: src.usdt,
					tokenOutSymbol: "USDT",
					tokenOutDecimals: src.usdtDecimals,
				}),
			);
			const held = await balanceOf(f, src.usdt);
			const send = (held / 2n / 10n ** BigInt(src.usdtDecimals)).toString();
			expect(Number(send)).toBeGreaterThanOrEqual(1);
			// A leftover allowance: USDT on Ethereum refuses to change a non-zero one.
			const approve = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [src.spokePool, 7n] });
			const nonce = await f.pub.readContract({ address: f.safe, abi: SAFE_ABI, functionName: "nonce" });
			const tx = toSafeTx([{ to: src.usdt, value: 0n, data: approve }], nonce);
			const typed = safeTxTypedData(f.chainId, f.safe, tx);
			const signature = await owner.signTypedData({
				domain: typed.domain,
				types: { EIP712Domain: getTypesForEIP712Domain({ domain: typed.domain }), ...typed.types },
				primaryType: typed.primaryType,
				message: typed.message,
			} as never);
			const hash = await f.wallet.sendTransaction({
				chain: null,
				account: owner,
				to: f.safe,
				data: encodeExecTransaction(tx, [{ signer: owner.address, signature }]),
				gas: 1_000_000n,
			});
			await f.pub.waitForTransactionReceipt({ hash, timeout: 400_000 });
			expect(await allowance()).toBe(7n);

			const { resolved, receipt } = await run(
				f,
				params(f, {
					tokenIn: src.usdt,
					tokenInSymbol: "USDT",
					tokenInDecimals: src.usdtDecimals,
					amount: send,
					destChainId,
					recipient: STRANGER,
				}),
			);
			const leg = resolved.across as NonNullable<typeof resolved.across>;
			expect(resolved.swap).toBeUndefined();
			expect(leg.resetAllowance).toBe(true);
			const ev = depositOf(receipt.logs);
			expect(ev.inputAmount).toBe(BigInt(send) * 10n ** BigInt(src.usdtDecimals));
			expect(ev.depositor).toBe(addressToBytes32(f.safe));
			expect(ev.recipient).toBe(addressToBytes32(STRANGER));
			expect(held - (await balanceOf(f, src.usdt))).toBe(ev.inputAmount);
			expect(await allowance()).toBe(0n);
		}, 400_000);
	});
};

acrossSuite(1, 56, "0.5");
acrossSuite(42161, 56, "0.5");
acrossSuite(8453, 56, "0.5");
// The fork gives a Safe 100 coins and the suite spends the amount twice.
acrossSuite(137, 56, "40");
acrossSuite(999, 56, "20");
acrossSuite(56, 42161, "2");

/**
 * Between two networks that also have USDC, USDT is not sold for it: it goes through Across and
 * arrives as USDT. The deposit carries the app's integrator id after its calldata.
 */
describe.skipIf(!ENABLED || (!!ONLY && !ONLY.includes(1)))(
	"USDT as USDT between networks that have USDC (1 → 42161)",
	() => {
		let f: Fork;
		const src = usdtSide(1);
		const dst = usdtSide(42161);

		beforeAll(async () => {
			f = await startFork(1);
		}, 180_000);
		afterAll(() => {
			vi.unstubAllEnvs();
			f?.proc.kill();
		});

		it("deposits USDT held by the Safe, marked with the integrator id", async () => {
			await run(f, params(f, { amount: "0.5", tokenOut: src.usdt, tokenOutSymbol: "USDT", tokenOutDecimals: 6 }));
			const held = await balanceOf(f, src.usdt);
			vi.stubEnv("PUBLIC_ACROSS_INTEGRATOR_ID", "0xf001");
			const { resolved, receipt } = await run(
				f,
				params(f, { tokenIn: src.usdt, tokenInSymbol: "USDT", tokenInDecimals: 6, amount: "500", destChainId: 42161 }),
			);
			const leg = resolved.across as NonNullable<typeof resolved.across>;
			expect(resolved.swap).toBeUndefined();
			expect(resolved.bridge).toBeUndefined();
			expect(leg.integrator).toBe("0xf001");
			const events = parseEventLogs({ abi: SPOKE_POOL_ABI, logs: receipt.logs, eventName: "FundsDeposited" });
			expect(events).toHaveLength(1);
			const ev = events[0].args;
			expect(ev.inputToken).toBe(addressToBytes32(src.usdt));
			expect(ev.outputToken).toBe(addressToBytes32(dst.usdt));
			expect(ev.inputAmount).toBe(500_000_000n);
			expect(ev.outputAmount).toBe(BigInt(leg.output));
			expect(ev.destinationChainId).toBe(42161n);
			expect(ev.recipient).toBe(addressToBytes32(f.safe));
			expect(held - (await balanceOf(f, src.usdt))).toBe(500_000_000n);
			console.log(`[1→42161] 500 USDT → ${Number(leg.output) / 1e6} USDT, bridge fee ${Number(leg.fee) / 1e6}`);
		}, 400_000);

		it("sells USDT for USDC and sends that when USDC is asked for", async () => {
			const usdc = getChain(1).usdc as Address;
			const { resolved, receipt } = await run(
				f,
				params(f, {
					tokenIn: src.usdt,
					tokenInSymbol: "USDT",
					tokenInDecimals: 6,
					amount: "50",
					destChainId: 42161,
					receive: "USDC",
				}),
			);
			expect(resolved.across).toBeUndefined();
			expect(resolved.fallback).toBeUndefined();
			expect(resolved.swap?.tokens.at(-1)?.toLowerCase()).toBe(usdc.toLowerCase());
			expect(burnEvent(f, receipt.logs).amount).toBe(BigInt(resolved.swap?.minOut ?? 0));
		}, 400_000);

		it("falls back to USDC, and says so, when Across cannot carry the amount", async () => {
			const real = globalThis.fetch;
			const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
				String(input).includes("/swap/approval")
					? Promise.resolve(
							new Response(JSON.stringify({ type: "AcrossApiError", code: "AMOUNT_TOO_HIGH", status: 400 }), {
								status: 400,
							}),
						)
					: real(input, init),
			);
			try {
				const { resolved, receipt } = await run(
					f,
					params(f, { tokenIn: src.usdt, tokenInSymbol: "USDT", tokenInDecimals: 6, amount: "50", destChainId: 42161 }),
				);
				expect(resolved.fallback).toBe(true);
				expect(resolved.across).toBeUndefined();
				expect(burnEvent(f, receipt.logs).amount).toBe(BigInt(resolved.swap?.minOut ?? 0));
				// To BNB Chain there is nothing to fall back to: the limit is an error.
				const env: OpEnv = { account: f.account, accounts: [], signers: [] };
				const toBnb = params(f, {
					tokenIn: src.usdt,
					tokenInSymbol: "USDT",
					tokenInDecimals: 6,
					amount: "50",
					destChainId: 56,
				});
				await expect((swapOp.prepare as NonNullable<typeof swapOp.prepare>)(toBnb, env)).rejects.toMatchObject({
					key: "swap.error.acrossLimit",
				});
			} finally {
				spy.mockRestore();
			}
		}, 400_000);

		it("sells USDT for ETH here when ETH is what should arrive", async () => {
			const weth = acrossToken(1, "WETH");
			const { resolved, receipt } = await run(
				f,
				params(f, {
					tokenIn: src.usdt,
					tokenInSymbol: "USDT",
					tokenInDecimals: 6,
					amount: "100",
					destChainId: 8453,
					receive: "WETH",
				}),
			);
			const leg = resolved.across as NonNullable<typeof resolved.across>;
			expect(leg.asset).toBe("WETH");
			expect(resolved.swap?.tokens.at(-1)?.toLowerCase()).toBe(weth.address.toLowerCase());
			expect(leg.amount).toBe(resolved.swap?.minOut);
			const ev = parseEventLogs({ abi: SPOKE_POOL_ABI, logs: receipt.logs, eventName: "FundsDeposited" })[0].args;
			expect(ev.inputToken).toBe(addressToBytes32(weth.address));
			expect(ev.outputToken).toBe(addressToBytes32(acrossToken(8453, "WETH").address));
			expect(ev.inputAmount).toBe(BigInt(leg.amount));
			expect(ev.destinationChainId).toBe(8453n);
			console.log(`[1→8453] 100 USDT → ${Number(leg.amount) / 1e18} WETH → ${Number(leg.output) / 1e18} ETH on Base`);
		}, 400_000);

		it("sends WBTC as WBTC", async () => {
			const wbtc = acrossToken(1, "WBTC");
			await run(
				f,
				params(f, { amount: "2", tokenOut: wbtc.address, tokenOutSymbol: "WBTC", tokenOutDecimals: wbtc.decimals }),
			);
			const held = await balanceOf(f, wbtc.address);
			expect(held).toBeGreaterThan(1_000_000n);
			const { resolved, receipt } = await run(
				f,
				params(f, {
					tokenIn: wbtc.address,
					tokenInSymbol: "WBTC",
					tokenInDecimals: 8,
					amount: "0.01",
					destChainId: 42161,
				}),
			);
			const leg = resolved.across as NonNullable<typeof resolved.across>;
			expect(leg.asset).toBe("WBTC");
			const ev = parseEventLogs({ abi: SPOKE_POOL_ABI, logs: receipt.logs, eventName: "FundsDeposited" })[0].args;
			expect(ev.inputToken).toBe(addressToBytes32(wbtc.address));
			expect(ev.outputToken).toBe(addressToBytes32(acrossToken(42161, "WBTC").address));
			expect(ev.inputAmount).toBe(1_000_000n);
			expect(ev.outputAmount).toBe(BigInt(leg.output));
			console.log(`[1→42161] 0.01 WBTC → ${Number(leg.output) / 1e8} WBTC, bridge fee ${Number(leg.fee) / 1e8}`);
		}, 900_000);
	},
);
