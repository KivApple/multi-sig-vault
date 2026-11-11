import { BaseError, createPublicClient, http, isAddress, type Address } from "viem";
import { findChain } from "@/config/chains";
import { rpcUrlsFor, viemChain } from "@/lib/rpc";
import { EIP1271_MAGIC, isValidSignatureCalldata, releaseDigest } from "./releaseCore.mjs";

export interface ReleaseSigner {
	safe: Address;
	chainId: number;
}

/**
 * Build-time configuration: the developer Safe that approves releases.
 * Without both variables the feature does not exist in the build.
 */
export const RELEASE_SIGNER: ReleaseSigner | undefined = (() => {
	const safe = import.meta.env.PUBLIC_RELEASE_SAFE?.trim();
	const chainId = Number(import.meta.env.PUBLIC_RELEASE_CHAIN_ID);
	if (!safe || !isAddress(safe, { strict: false }) || !findChain(chainId)) return undefined;
	return { safe: safe as Address, chainId };
})();

export type VerifyOutcome = "verified" | "failed" | "pending";

const isRevert = (e: unknown): boolean => {
	if (!(e instanceof BaseError)) return false;
	const text = `${e.shortMessage} ${e.details ?? ""} ${e.message}`;
	return /revert|hash not approved|invalid opcode/i.test(text);
};

const askEndpoint = async (url: string, signer: ReleaseSigner, data: `0x${string}`): Promise<VerifyOutcome> => {
	const client = createPublicClient({
		chain: viemChain(signer.chainId),
		transport: http(url, { timeout: 12_000, retryCount: 0 }),
	});
	try {
		const res = await client.call({ to: signer.safe, data });
		return res.data?.toLowerCase().startsWith(EIP1271_MAGIC) ? "verified" : "failed";
	} catch (e) {
		return isRevert(e) ? "failed" : "pending";
	}
};

/**
 * EIP-1271 check against the developer Safe: `isValidSignature(digest, "")` returns the magic
 * value only if the Safe itself (i.e. a threshold of its owners) executed
 * `SignMessageLib.signMessage(abi.encode(digest))`.
 *
 * The answer comes from an RPC endpoint, so one lying endpoint must not be enough:
 * two independent endpoints have to confirm (one, if only one is configured).
 * Any explicit "not signed" answer fails the check; unreachable endpoints leave it pending.
 */
export const verifyRelease = async (id: string, signer: ReleaseSigner): Promise<VerifyOutcome> => {
	const data = isValidSignatureCalldata(releaseDigest(id));
	const urls = [...new Set(rpcUrlsFor(signer.chainId))];
	const needed = Math.min(2, urls.length);
	let confirmed = 0;
	for (const url of urls) {
		const outcome = await askEndpoint(url, signer, data);
		if (outcome === "failed") return "failed";
		if (outcome === "verified") confirmed += 1;
		if (confirmed >= needed) return "verified";
	}
	return "pending";
};
