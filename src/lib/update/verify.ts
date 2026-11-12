import { BaseError, createPublicClient, http, isAddress, type Address } from "viem";
import { findChain } from "@/config/chains";
import { rpcUrlsFor, viemChain } from "@/lib/rpc";
import { EIP1271_MAGIC, isValidSignatureCalldata, releaseDigest } from "./releaseCore.mjs";

export interface ReleaseSigner {
	safe: Address;
	/** Networks the Safe may approve a release on; an approval on any one of them counts. */
	chainIds: number[];
}

/**
 * Build-time configuration: the developer Safe that approves releases, and the networks to look on
 * (`PUBLIC_RELEASE_CHAIN_ID`, one id or several separated by commas).
 * Without both variables the feature does not exist in the build.
 */
export const RELEASE_SIGNER: ReleaseSigner | undefined = (() => {
	const safe = import.meta.env.PUBLIC_RELEASE_SAFE?.trim();
	const chainIds = (import.meta.env.PUBLIC_RELEASE_CHAIN_ID ?? "")
		.split(/[\s,]+/)
		.map(Number)
		.filter((id, i, all) => Number.isInteger(id) && !!findChain(id) && all.indexOf(id) === i);
	if (!safe || !isAddress(safe, { strict: false }) || chainIds.length === 0) return undefined;
	return { safe: safe as Address, chainIds };
})();

export type VerifyOutcome = "verified" | "failed" | "pending";

const isRevert = (e: unknown): boolean => {
	if (!(e instanceof BaseError)) return false;
	const text = `${e.shortMessage} ${e.details ?? ""} ${e.message}`;
	return /revert|hash not approved|invalid opcode/i.test(text);
};

const askEndpoint = async (
	url: string,
	chainId: number,
	safe: Address,
	data: `0x${string}`,
): Promise<VerifyOutcome> => {
	const client = createPublicClient({
		chain: viemChain(chainId),
		transport: http(url, { timeout: 12_000, retryCount: 0 }),
	});
	try {
		const res = await client.call({ to: safe, data });
		return res.data?.toLowerCase().startsWith(EIP1271_MAGIC) ? "verified" : "failed";
	} catch (e) {
		return isRevert(e) ? "failed" : "pending";
	}
};

/**
 * EIP-1271 check against the developer Safe on one network: `isValidSignature(digest, "")` returns the
 * magic value only if the Safe itself (i.e. a threshold of its owners) executed
 * `SignMessageLib.signMessage(abi.encode(digest))`.
 *
 * The answer comes from an RPC endpoint, so one lying endpoint must not be enough:
 * two independent endpoints have to confirm (one, if only one is configured).
 * Any explicit "not signed" answer fails the check; unreachable endpoints leave it pending.
 * An address without code on this network answers with nothing, which is "not signed".
 */
const verifyOnChain = async (digestCall: `0x${string}`, safe: Address, chainId: number): Promise<VerifyOutcome> => {
	const urls = [...new Set(rpcUrlsFor(chainId))];
	const needed = Math.min(2, urls.length);
	let confirmed = 0;
	for (const url of urls) {
		const outcome = await askEndpoint(url, chainId, safe, digestCall);
		if (outcome === "failed") return "failed";
		if (outcome === "verified") confirmed += 1;
		if (confirmed >= needed) return "verified";
	}
	return "pending";
};

/**
 * A release is approved when the developer Safe signed it on ANY of the configured networks.
 *
 * A Safe's address commits to the signers and threshold it was created with, so the same address on
 * another network can only ever be a Safe that started with those same signers – signing where gas is
 * cheap is as good as signing on Ethereum. (A signer removed later keeps its say on a network where the
 * Safe has not been created yet: whoever creates it there gets the original set.)
 *
 * Verified on one network is enough; otherwise a network that could not be asked leaves the answer open.
 */
export const verifyRelease = async (id: string, signer: ReleaseSigner): Promise<VerifyOutcome> => {
	const data = isValidSignatureCalldata(releaseDigest(id));
	const outcomes = await Promise.all(signer.chainIds.map((chainId) => verifyOnChain(data, signer.safe, chainId)));
	if (outcomes.includes("verified")) return "verified";
	return outcomes.includes("pending") ? "pending" : "failed";
};
