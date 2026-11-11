import { useEffect } from "react";
import { dropCached } from "@/lib/dataCache";
import { accountCacheKey, patchResultExtra } from "@/lib/ops/engine";
import { getPublicClient } from "@/lib/rpc";
import type { Account, Operation } from "@/types/domain";

export type TxStatus = "success" | "reverted" | undefined;

/**
 * Follows a sent Safe transaction until it is mined and stores the outcome in
 * `op.result.extra.txStatus` (survives reloads; result components read it from there).
 */
export const useTxStatus = (op: Operation, account: Account): TxStatus => {
	const status = op.result?.extra?.txStatus as TxStatus;
	const hash = op.result?.txHash;
	const chainId = account.chainId;
	useEffect(() => {
		if (!hash || status || chainId === undefined) return undefined;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async (): Promise<void> => {
			if (stopped) return;
			try {
				if (navigator.onLine && document.visibilityState === "visible") {
					const receipt = await getPublicClient(chainId).getTransactionReceipt({ hash });
					if (!stopped) {
						patchResultExtra(op.id, { txStatus: receipt.status });
						dropCached(accountCacheKey(account));
						return;
					}
				}
			} catch {
				// Not mined yet (or network hiccup) – keep polling.
			}
			timer = setTimeout(() => void poll(), 4000);
		};
		void poll();
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	}, [hash, status, chainId, op.id, account]);
	return status;
};
