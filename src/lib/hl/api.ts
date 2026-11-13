import type { Address } from "viem";
import { HL_API } from "@/config/chains";
import { AppError } from "@/lib/errors";
import type { NetworkEnv } from "@/types/domain";

const post = async <T>(env: NetworkEnv, path: "info" | "exchange", body: unknown): Promise<T> => {
	const res = await fetch(`${HL_API[env]}/${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		referrerPolicy: "no-referrer",
	});
	if (res.status === 429) throw new AppError("hl.error.rateLimit");
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new AppError("hl.error.http", { status: res.status, detail: text.slice(0, 200) });
	}
	return (await res.json()) as T;
};

export const hlInfo = <T>(env: NetworkEnv, body: Record<string, unknown>): Promise<T> => post<T>(env, "info", body);

interface ExchangeResponse {
	status: "ok" | "err";
	response?: unknown;
}

/** Submits a signed action; throws with the exchange's own message when it is rejected. */
export const hlExchange = async (
	env: NetworkEnv,
	body: { action: unknown; nonce: number; signature: unknown },
): Promise<unknown> => {
	const res = await post<ExchangeResponse>(env, "exchange", { ...body, vaultAddress: null });
	if (res.status !== "ok") {
		const detail = typeof res.response === "string" ? res.response : JSON.stringify(res.response);
		throw new AppError("hl.error.rejected", { detail });
	}
	return res.response;
};

// ---- Response shapes (only the fields the app uses) ----

export interface HlSpotToken {
	name: string;
	szDecimals: number;
	weiDecimals: number;
	index: number;
	tokenId: string;
	evmContract: { address: Address; evm_extra_wei_decimals: number } | null;
	fullName: string | null;
}

export interface HlSpotMeta {
	universe: { tokens: [number, number]; name: string; index: number }[];
	tokens: HlSpotToken[];
}

export interface HlSpotCtx {
	coin: string;
	markPx: string;
	midPx: string | null;
}

export interface HlSpotBalance {
	coin: string;
	token: number;
	total: string;
	hold: string;
}

export interface HlSpotState {
	balances: HlSpotBalance[];
	tokenToAvailableAfterMaintenance?: [number, string][];
}

export interface HlPosition {
	coin: string;
	szi: string;
	entryPx: string | null;
	positionValue: string;
	marginUsed: string;
	unrealizedPnl: string;
	/** Funding paid by the position, USD: positive – paid, negative – received. */
	cumFunding?: { allTime: string; sinceOpen: string; sinceChange: string };
	leverage: { type: string; value: number };
}

export interface HlClearinghouseState {
	marginSummary: { accountValue: string; totalNtlPos: string; totalMarginUsed: string };
	withdrawable: string;
	assetPositions: { position: HlPosition }[];
}

export interface HlMultiSigSigners {
	authorizedUsers: Address[];
	threshold: number;
}

export type HlAbstraction = "unifiedAccount" | "portfolioMargin" | "disabled" | "default" | "dexAbstraction";

export interface HlAgent {
	name: string;
	address: Address;
	validUntil: number;
}

export interface HlSubAccount {
	name: string;
	subAccountUser: Address;
	master: Address;
	clearinghouseState?: HlClearinghouseState;
	spotState?: HlSpotState;
}

export interface HlUserRole {
	role: "missing" | "user" | "agent" | "vault" | "subAccount";
}

export interface HlPreTransferCheck {
	fee: string;
	isSanctioned: boolean;
	userExists: boolean;
}

export type HlPortfolio = [string, { vlm: string }][];
