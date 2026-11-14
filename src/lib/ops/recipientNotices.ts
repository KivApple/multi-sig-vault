import { useCallback } from "react";
import type { Address } from "viem";
import { findChain } from "@/config/chains";
import { useCached } from "@/hooks/useCached";
import { useT } from "@/i18n";
import { parseAddress, sameAddress } from "@/lib/format";
import { hlRoleOf } from "@/lib/hl/account";
import { getPublicClient } from "@/lib/rpc";
import { SAFE_ABI } from "@/lib/safe/abis";
import type { OpEnv, OpNotices } from "./types";

/** What is found about a recipient holds for a while, and can be looked at again. */
const TTL_MS = 5 * 60_000;
const NONE: OpNotices = { notices: [] };

/** Several findings about one operation, as one. */
export const mergeNotices = (...parts: OpNotices[]): OpNotices => {
	const refreshers = parts.map((p) => p.refresh).filter((r): r is () => void => !!r);
	return {
		notices: parts.flatMap((p) => p.notices),
		pending: parts.some((p) => p.pending),
		checking: parts.some((p) => p.checking),
		refresh:
			refreshers.length > 0
				? () => {
						for (const refresh of refreshers) refresh();
					}
				: undefined,
	};
};

/** The address is a contract there that is nobody's wallet: not a delegating account, not a Safe. */
export const isPlainContract = async (chainId: number, address: Address): Promise<boolean> => {
	const client = getPublicClient(chainId);
	const code = await client.getCode({ address });
	// An address that only delegates (EIP-7702) is still somebody's wallet.
	if (!code || code === "0x" || code.toLowerCase().startsWith("0xef0100")) return false;
	// A Safe of any version is a wallet too: it has owners and a threshold, and says which version it is.
	const safe = await Promise.all([
		client.readContract({ address, abi: SAFE_ABI, functionName: "getOwners" }),
		client.readContract({ address, abi: SAFE_ABI, functionName: "getThreshold" }),
		client.readContract({ address, abi: SAFE_ABI, functionName: "VERSION" }),
	]).then(
		([owners, threshold]) => owners.length > 0 && threshold > 0n,
		() => false,
	);
	return !safe;
};

/**
 * Says when the recipient is a contract on the network the funds arrive on – unless it is a Safe, of
 * any version, known to the app or not. Not a mistake in itself, so nothing to tick: a contract receives what it is sent,
 * but only some can do anything with it.
 */
export const useContractRecipient = (chainId: number | undefined, recipient: string, env: OpEnv): OpNotices => {
	const t = useT();
	const chain = findChain(chainId);
	const address = parseAddress(recipient);
	const known =
		!!address &&
		(sameAddress(address, env.account.address) ||
			env.accounts.some((a) => a.kind === "safe" && a.chainId === chainId && sameAddress(a.address, address)));
	const asked = chain && address && !known ? { chainId: chain.id, address } : undefined;
	const fetcher = useCallback(
		() => (asked ? isPlainContract(asked.chainId, asked.address) : Promise.resolve(false)),
		[asked?.chainId, asked?.address],
	);
	const code = useCached(asked ? `code:${asked.chainId}:${asked.address.toLowerCase()}` : null, fetcher, TTL_MS);
	if (!asked || !chain || !code.data) return NONE;
	return {
		notices: [
			{ id: `contract:${asked.chainId}:${asked.address}`, text: t("address.isContract", { network: chain.name }) },
		],
		refresh: () => void code.refresh(),
		checking: code.loading,
	};
};

/**
 * Says when nothing has ever happened at the recipient's address on Hyperliquid: the exchange has no
 * account there. A transfer opens one – for whoever holds the key of that address, if anybody does.
 */
export const useHlNewRecipient = (recipient: string, env: OpEnv): OpNotices => {
	const t = useT();
	const address = parseAddress(recipient);
	const hlEnv = env.account.env;
	const fetcher = useCallback(() => (address ? hlRoleOf(hlEnv, address) : Promise.resolve("user")), [hlEnv, address]);
	const role = useCached(address ? `hl-role:${hlEnv}:${address.toLowerCase()}` : null, fetcher, TTL_MS);
	if (!address || role.data !== "missing") return NONE;
	return {
		notices: [{ id: `hl-new:${address}`, text: t("hl.newRecipient") }],
		refresh: () => void role.refresh(),
		checking: role.loading,
	};
};
