/**
 * End-to-end simulation of the swap/bridge operation on anvil forks of real networks.
 * Skipped by default (needs network + foundry): `MSV_FORK=1 npx vitest run tests/swap.fork.test.ts`.
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
				params(f, { amount: "1", destChainId: bridgeTo, forward: false, speed: fast ? "fast" : "standard" }),
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
