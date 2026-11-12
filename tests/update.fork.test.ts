/**
 * End-to-end check of on-chain release verification against a forked chain.
 * Skipped unless a fork is provided:
 *   MSV_FORK_RPC=http://127.0.0.1:8599 MSV_FORK_CHAIN_ID=8453 MSV_FORK_SAFE=0x… MSV_FORK_SIGNED_ID=<release id> pnpm vitest run tests/update.fork.test.ts
 * where the Safe has executed the transaction printed by `pnpm release:info` for that id.
 */
import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";

const RPC = process.env.MSV_FORK_RPC;
const SAFE = process.env.MSV_FORK_SAFE as Address | undefined;
const SIGNED_ID = process.env.MSV_FORK_SIGNED_ID;
const CHAIN_ID = Number(process.env.MSV_FORK_CHAIN_ID ?? 8453);

let urls: string[] = [];
vi.mock("@/lib/rpc", async () => {
	const { defineChain } = await import("viem");
	return {
		rpcUrlsFor: () => urls,
		viemChain: (id: number) =>
			defineChain({
				id,
				name: "fork",
				nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
				rpcUrls: { default: { http: urls } },
			}),
	};
});

describe.skipIf(!RPC || !SAFE || !SIGNED_ID)("release verification on a fork", () => {
	it("accepts the signed release, rejects others, stays pending when the RPC is down", async () => {
		const { verifyRelease } = await import("../src/lib/update/verify");
		const signer = { safe: SAFE as Address, chainIds: [CHAIN_ID] };
		urls = [RPC as string];
		expect(await verifyRelease(SIGNED_ID as string, signer)).toBe("verified");
		expect(await verifyRelease("0".repeat(64), signer)).toBe("failed");
		// An address without code answers 0x – not a signature.
		expect(
			await verifyRelease(SIGNED_ID as string, { ...signer, safe: "0x000000000000000000000000000000000000dEaD" }),
		).toBe("failed");
		urls = ["http://127.0.0.1:1"];
		expect(await verifyRelease(SIGNED_ID as string, signer)).toBe("pending");
		// Two endpoints configured: one reachable confirmation is not enough.
		urls = [RPC as string, "http://127.0.0.1:1"];
		expect(await verifyRelease(SIGNED_ID as string, signer)).toBe("pending");
	});
});
