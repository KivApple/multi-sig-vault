import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useOnline } from "@/hooks/useOnline";
import { useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { inspectTarget, type TargetState } from "@/lib/safe/creation";
import type { SafeCreation } from "@/types/domain";

export type TargetCheck =
	| { status: "idle" }
	| { status: "checking" }
	| { status: "offline" }
	| { status: "error"; message: string }
	| ({ status: "ready" } & TargetState);

export interface UseTargetStateResult {
	target: TargetCheck;
	recheck: () => void;
}

/** Looks at the target chain: are the Safe contracts there, is the predicted address already taken. */
export const useTargetState = (
	chainId: number,
	creation: SafeCreation | undefined,
	address: Address | undefined,
): UseTargetStateResult => {
	const t = useT();
	const online = useOnline();
	const [attempt, setAttempt] = useState(0);
	const [settled, setSettled] = useState<{ key: string; target: TargetCheck } | null>(null);
	const key = creation && address ? `${chainId}|${address}|${creation.saltNonce}|${attempt}` : "";

	useEffect(() => {
		if (!key || !creation || !address || !online) return undefined;
		let cancelled = false;
		const timer = setTimeout(() => {
			inspectTarget(chainId, creation, address)
				.then((state): TargetCheck => ({ status: "ready", ...state }))
				.catch((e: unknown): TargetCheck => ({ status: "error", message: describeError(e, t) }))
				.then((target) => {
					if (!cancelled) setSettled({ key, target });
				});
		}, 300);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [key, chainId, creation, address, online, t]);

	const recheck = useCallback(() => setAttempt((n) => n + 1), []);
	useEffect(() => {
		if (online) recheck();
	}, [online, recheck]);

	let target: TargetCheck;
	if (!key) target = { status: "idle" };
	else if (settled?.key === key) target = settled.target;
	else target = online ? { status: "checking" } : { status: "offline" };
	return { target, recheck };
};
