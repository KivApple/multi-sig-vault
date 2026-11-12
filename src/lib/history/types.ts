import type { Address } from "viem";

export interface HistoryAmount {
	/** +1 – received by the account, -1 – left it, 0 – moved inside it. */
	sign: 1 | -1 | 0;
	/** Decimal string. */
	value: string;
	symbol: string;
	/** The amount went into a bridge: it left this network, not the owner. */
	bridged?: boolean;
}

export interface HistoryItem {
	id: string;
	time: number;
	/** i18n key with variables, or a raw name from the chain (shown as code). */
	title: { key: string; vars?: Record<string, string> } | { raw: string };
	amounts: HistoryAmount[];
	counterparty?: { role: "to" | "from"; address: Address };
	failed?: boolean;
	/** Block explorer page. */
	link?: string;
	/** Who signed, when the source says so. */
	signers?: Address[];
	/** Who broadcast it and paid for gas. */
	sender?: Address;
	/** Hyperliquid: hash to look the signers up by (multi-sig accounts). */
	hlHash?: string;
	/** Hyperliquid action type, to tell an explorer row from the same operation remembered by the app. */
	hlAction?: string;
	/** EVM transaction hash, to match the item with an operation made in this app. */
	txHash?: string;
}

export interface HistoryPage {
	items: HistoryItem[];
	/**
	 * First page of a Hyperliquid account: actions that move no funds are known from the exchange only
	 * since this time (`null` – its explorer did not answer at all). Absent when nothing is cut off.
	 */
	actionsSince?: number | null;
	/** Opaque cursor of the next (older) page; absent on the last one. */
	next?: unknown;
}

/** Loads history newest first, one page per call. */
export type HistoryLoader = (cursor?: unknown) => Promise<HistoryPage>;

const DECIMAL = /^\d{1,60}(\.\d{1,40})?$/;

/** A decimal string from an API, or undefined when it is anything else. */
export const cleanDecimal = (v: unknown): string | undefined => {
	const s =
		typeof v === "number" && Number.isFinite(v)
			? String(Math.abs(v))
			: typeof v === "string"
				? v.replace(/^-/, "")
				: "";
	return DECIMAL.test(s) ? s : undefined;
};

/** A token symbol from an API: short, printable, no markup-like surprises. */
export const cleanSymbol = (v: unknown): string | undefined =>
	typeof v === "string" && /^[\w.$+-]{1,16}$/.test(v) ? v : undefined;
