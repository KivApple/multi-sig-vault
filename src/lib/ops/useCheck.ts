import { useCallback } from "react";
import { useCached } from "@/hooks/useCached";
import { useOnline } from "@/hooks/useOnline";
import { useT } from "@/i18n";
import { AppError } from "@/lib/errors";
import type { OpNotices } from "./types";

/** What a look at the network found holds for a while, and can be looked at again. */
const TTL_MS = 5 * 60_000;
const NONE: OpNotices = { notices: [] };

type CheckResult = { ok: true } | { ok: false; key: string; vars?: Record<string, string | number> };

/**
 * A check that asks the network has three outcomes, and they are not the same thing:
 *
 * - it found nothing wrong;
 * - it found a problem – the operation would lose funds or fail, and is not signed;
 * - it could not ask (no connection, the endpoint is down). That is not a problem found. The user
 *   is told, can try again, and may go on without the check: a device that signs offline has no other way.
 *
 * `check` throws an `AppError` for a problem; `unchecked` names the keys it throws when it could
 * not ask. Any other failure is taken as "could not ask" too.
 */
export const settle = async (check: () => Promise<void>, unchecked: readonly string[]): Promise<CheckResult> => {
	try {
		await check();
		return { ok: true };
	} catch (e) {
		if (e instanceof AppError && !unchecked.includes(e.key)) return { ok: false, key: e.key, vars: e.vars };
		throw e;
	}
};

/** For the engine's own steps: a problem stops them, "could not ask" does not – the card asks about that. */
export const unlessUnchecked = async (check: Promise<void>, unchecked: readonly string[]): Promise<void> => {
	try {
		await check;
	} catch (e) {
		if (e instanceof AppError && !unchecked.includes(e.key)) throw e;
	}
};

export interface CheckTexts {
	/** What could not be checked, and what going on without it risks. */
	unchecked: string;
}

/**
 * Runs a network check for a card and turns its outcome into notices: nothing, a blocking error,
 * or "could not check" with a retry and a box to go on without it. `id` identifies what is being
 * checked (the parameters it depends on); `null` – nothing to check yet.
 */
export const useCheck = (
	id: string | null,
	check: () => Promise<void>,
	unchecked: readonly string[],
	texts: CheckTexts,
): OpNotices => {
	const t = useT();
	const online = useOnline();
	// biome-ignore lint/correctness/useExhaustiveDependencies: `id` names everything `check` depends on
	const fetcher = useCallback(() => settle(check, unchecked), [id]);
	const result = useCached<CheckResult>(id ? `check:${id}` : null, fetcher, TTL_MS);
	if (!id) return NONE;
	const again = { refresh: () => void result.refresh(), checking: result.loading };
	if (result.data) {
		if (result.data.ok) return NONE;
		return {
			notices: [{ id: `check:${id}:problem`, text: t(result.data.key, result.data.vars), block: true }],
			...again,
		};
	}
	if (result.error !== undefined || !online) {
		return {
			notices: [{ id: `check:${id}:unchecked`, text: texts.unchecked, confirm: t("ops.notice.proceed") }],
			...again,
		};
	}
	return { notices: [], pending: true };
};
