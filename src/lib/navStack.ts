import { useCallback } from "react";
import { useNavigate } from "react-router";

/**
 * Navigation model: the three sections are siblings, pages opened from them go deeper.
 *   - switching sections never adds a history entry, so "back" does not replay every switch;
 *   - a deeper page is pushed, so "back" leaves it;
 *   - switching sections from a deeper page first unwinds to the entry the app was opened on.
 * The router numbers its own history entries (`idx`, 0 on the entry the app was opened on), which
 * survives reloads – that number is the current depth.
 */
export const historyDepth = (): number => {
	const idx = (window.history.state as { idx?: unknown } | null)?.idx;
	return typeof idx === "number" && idx > 0 ? idx : 0;
};

/** Goes `depth` entries back and runs `then` once the browser has done it. */
const unwind = (depth: number, then: () => void): void => {
	const done = (): void => {
		window.removeEventListener("popstate", done);
		then();
	};
	window.addEventListener("popstate", done);
	window.history.go(-depth);
};

export interface StackNav {
	/** Shows a section (or any top-level page) in place of everything opened so far. */
	toSection: (to: string) => void;
	/** Leaves the current page: back in history, or to `fallback` when the app was opened right on it. */
	back: (fallback: string) => void;
	/** Replaces the pages opened so far with `to` (after finishing a wizard: back must not reopen it). */
	finishAt: (to: string) => void;
}

export const useStackNav = (): StackNav => {
	const navigate = useNavigate();
	const toSection = useCallback(
		(to: string) => {
			const depth = historyDepth();
			const show = (): void => void navigate(to, { replace: true });
			if (depth > 0) unwind(depth, show);
			else show();
		},
		[navigate],
	);
	const back = useCallback(
		(fallback: string) => {
			if (historyDepth() > 0) void navigate(-1);
			else void navigate(fallback, { replace: true });
		},
		[navigate],
	);
	const finishAt = useCallback(
		(to: string) => {
			const depth = historyDepth();
			if (depth > 0) unwind(depth, () => void navigate(to));
			else void navigate(to, { replace: true });
		},
		[navigate],
	);
	return { toSection, back, finishAt };
};
