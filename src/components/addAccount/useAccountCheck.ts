import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useOnline } from "@/hooks/useOnline";
import { useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { hlInfo, type HlMultiSigSigners } from "@/lib/hl/api";
import { verifyHlAccount } from "@/lib/hl/account";
import { fetchSafeInfo, type SafeInfo } from "@/lib/safe/info";
import type { AccountKind, NetworkEnv } from "@/types/domain";

export interface AccountCheckInput {
	kind: AccountKind;
	env: NetworkEnv;
	/** Safe accounts only. */
	chainId?: number;
	/** Checksummed address, `undefined` while the input is not a valid address. */
	address: Address | undefined;
	/** Skip the check (e.g. the account is already in the app). */
	skip?: boolean;
}

export type AccountCheck =
	| { status: "idle" }
	| { status: "checking" }
	| { status: "offline" }
	| { status: "error"; message: string }
	| { status: "ok"; safe?: SafeInfo; multiSig?: HlMultiSigSigners | null };

interface Settled {
	key: string;
	check: AccountCheck;
}

const DEBOUNCE_MS = 350;

/**
 * Verifies that the address is a Hyperliquid account / compatible Safe on the chosen network.
 * The result is tied to the exact inputs it was computed for – stale answers are never shown.
 */
export const useAccountCheck = ({ kind, env, chainId, address, skip }: AccountCheckInput): AccountCheck => {
	const t = useT();
	const online = useOnline();
	const [attempt, setAttempt] = useState(0);
	const [settled, setSettled] = useState<Settled | null>(null);
	const key = address && !skip ? `${kind}|${env}|${chainId ?? ""}|${address.toLowerCase()}|${attempt}` : "";

	useEffect(() => {
		if (!key || !address || !online) return undefined;
		let cancelled = false;
		const timer = setTimeout(async () => {
			let check: AccountCheck;
			try {
				if (kind === "hl") {
					await verifyHlAccount(env, address);
					const multiSig = await hlInfo<HlMultiSigSigners | null>(env, {
						type: "userToMultiSigSigners",
						user: address,
					});
					check = { status: "ok", multiSig };
				} else {
					check = { status: "ok", safe: await fetchSafeInfo(chainId as number, address) };
				}
			} catch (e) {
				check = { status: "error", message: describeError(e, t) };
			}
			if (!cancelled) setSettled({ key, check });
		}, DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [key, address, online, kind, env, chainId, t]);

	// Came back online after a failed attempt – check again.
	useEffect(() => {
		if (online) setAttempt((n) => n + 1);
	}, [online]);

	if (!key) return { status: "idle" };
	if (settled?.key === key) return settled.check;
	return online ? { status: "checking" } : { status: "offline" };
};
