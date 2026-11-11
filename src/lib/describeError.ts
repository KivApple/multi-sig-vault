import type { TFunc } from "@/i18n";
import { AppError, errorText } from "./errors";

/** Turns any thrown value into a message for the user. */
export const describeError = (e: unknown, t: TFunc): string => {
	if (e instanceof AppError) {
		const text = t(e.key, e.vars);
		return text === e.key ? e.message : text.replace(/[\s:–-]+$/u, "");
	}
	const text = errorText(e);
	if (/failed to fetch|networkerror|load failed/i.test(text)) return t("error.network");
	return text.length > 300 ? `${text.slice(0, 300)}…` : text;
};
