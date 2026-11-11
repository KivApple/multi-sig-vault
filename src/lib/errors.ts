/** Error with a translation key – UI shows `t(key, vars)`; `message` stays English for logs. */
export class AppError extends Error {
	readonly key: string;
	readonly vars?: Record<string, string | number>;

	constructor(key: string, vars?: Record<string, string | number>, message?: string) {
		super(message ?? key);
		this.name = "AppError";
		this.key = key;
		this.vars = vars;
	}
}

export type WalletErrorCode =
	| "rejected"
	| "unavailable"
	| "wrong-account"
	| "wrong-device"
	| "chain"
	| "busy"
	| "unsupported"
	| "locked"
	| "app-closed"
	| "blind-signing"
	| "timeout"
	| "unknown";

export class WalletError extends AppError {
	readonly code: WalletErrorCode;

	constructor(code: WalletErrorCode, detail?: string, vars?: Record<string, string | number>) {
		super(`walletError.${code}`, { detail: detail ?? "", ...vars }, detail ?? code);
		this.name = "WalletError";
		this.code = code;
	}
}

export const errorText = (e: unknown): string => {
	if (e instanceof Error) return e.message;
	if (typeof e === "string") return e;
	try {
		return JSON.stringify(e);
	} catch {
		return String(e);
	}
};
