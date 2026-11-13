import type { Address } from "viem";
import { fetchCached } from "@/lib/dataCache";
import { AppError } from "@/lib/errors";
import type { AssetRow, NetworkEnv } from "@/types/domain";
import {
	hlInfo,
	type HlAbstraction,
	type HlAgent,
	type HlClearinghouseState,
	type HlMultiSigSigners,
	type HlPortfolio,
	type HlPreTransferCheck,
	type HlSpotCtx,
	type HlSpotMeta,
	type HlSpotState,
	type HlSpotToken,
	type HlSubAccount,
	type HlUserRole,
} from "./api";

export interface HlMarket {
	tokens: HlSpotToken[];
	/** Token index → USD price. */
	prices: Record<number, number>;
}

/** Spot metadata + USD prices for an environment (shared by all accounts, cached 30 s). */
export const fetchHlMarket = (env: NetworkEnv): Promise<HlMarket> =>
	fetchCached(
		`hl-market:${env}`,
		async () => {
			const [meta, ctxs] = await hlInfo<[HlSpotMeta, HlSpotCtx[]]>(env, { type: "spotMetaAndAssetCtxs" });
			const px = new Map(ctxs.map((c) => [c.coin, Number(c.midPx ?? c.markPx)]));
			const prices: Record<number, number> = { 0: 1 };
			// Pairs quoted in USDC first, then pairs quoted in another already priced token (USDH, USDT0, …).
			for (const pass of [0, 1]) {
				for (const pair of meta.universe) {
					const [base, quote] = pair.tokens;
					const p = px.get(pair.name);
					if (prices[base] !== undefined || p === undefined || !Number.isFinite(p)) continue;
					if (pass === 0 && quote === 0) prices[base] = p;
					else if (pass === 1 && prices[quote] !== undefined) prices[base] = p * prices[quote];
				}
			}
			return { tokens: meta.tokens, prices };
		},
		25_000,
	);

const fetchPerpDexs = (env: NetworkEnv): Promise<string[]> =>
	fetchCached(
		`hl-dexs:${env}`,
		async () => {
			const list = await hlInfo<({ name: string } | null)[]>(env, { type: "perpDexs" });
			return list.map((d) => d?.name ?? "");
		},
		3_600_000,
	).catch(() => [""]);

export interface HlPerpPosition {
	coin: string;
	size: string;
	notional: number;
	/** Margin the position holds. */
	margin: number;
	/** Isolated margin; otherwise the position shares the cross margin of the account. */
	isolated: boolean;
	pnl: number;
	/** Average entry price and the current mark price, USD. */
	entryPx: number;
	markPx: number;
	/** Funding since the position was opened, USD: positive – received, negative – paid. */
	funding: number;
	leverage: number;
}

export interface HlAccountData {
	exists: boolean;
	/** `null` – ordinary account controlled by its own key. */
	multiSig: HlMultiSigSigners | null;
	abstraction: HlAbstraction;
	/** Unified / portfolio margin: one balance for spot and perps. */
	unified: boolean;
	totalUsd: number;
	/** Part of `totalUsd` that can leave the account now: not held by open orders or as margin. */
	availableUsd: number;
	assets: AssetRow[];
	spot: { coin: string; token: number; tokenId: string; total: string; available: string; usd: number; evm: boolean }[];
	/** USDC that can leave the perp account (standard mode) or the unified balance. */
	withdrawable: string;
	positions: HlPerpPosition[];
	/** Unrealised result of all open positions together, USD. */
	unrealizedPnl: number;
	/** `USDC:0x…` – token identifier used by transfer actions. */
	usdcToken: string;
}

const sub = (a: string, b: string): string => {
	const v = Number(a) - Number(b);
	return v > 0 ? String(Math.floor(v * 1e8) / 1e8) : "0";
};

/** Balances, positions and multi-sig configuration of a Hyperliquid account. */
export const fetchHlAccount = async (env: NetworkEnv, user: Address): Promise<HlAccountData> => {
	const [market, dexs, spotState, multiSig, abstraction, role] = await Promise.all([
		fetchHlMarket(env),
		fetchPerpDexs(env),
		hlInfo<HlSpotState>(env, { type: "spotClearinghouseState", user }),
		hlInfo<HlMultiSigSigners | null>(env, { type: "userToMultiSigSigners", user }),
		hlInfo<HlAbstraction>(env, { type: "userAbstraction", user }).catch(() => "default" as const),
		hlInfo<HlUserRole>(env, { type: "userRole", user }),
	]);
	const perps = await Promise.all(
		dexs.map((dex) =>
			hlInfo<HlClearinghouseState>(env, { type: "clearinghouseState", user, ...(dex ? { dex } : {}) }).catch(
				(e: unknown) => {
					if (dex === "") throw e;
					return undefined;
				},
			),
		),
	);

	const unified = abstraction === "unifiedAccount" || abstraction === "portfolioMargin";
	const tokenByIndex = new Map(market.tokens.map((t) => [t.index, t]));
	const available = new Map(spotState.tokenToAvailableAfterMaintenance ?? []);

	const positions: HlPerpPosition[] = [];
	let perpValue = 0;
	/** Collateral the open positions hold: money that is in the account but sits in positions. */
	let marginSum = 0;
	for (const state of perps) {
		if (!state) continue;
		perpValue += Number(state.marginSummary.accountValue);
		for (const { position: p } of state.assetPositions) {
			const pnl = Number(p.unrealizedPnl);
			marginSum += Number(p.marginUsed) || 0;
			positions.push({
				coin: p.coin,
				size: p.szi,
				notional: Number(p.positionValue),
				margin: Number(p.marginUsed) || 0,
				isolated: p.leverage.type === "isolated",
				pnl,
				entryPx: Number(p.entryPx) || 0,
				// The position is valued at the mark price, so the price is its value per unit.
				markPx: Number(p.szi) ? Math.abs(Number(p.positionValue) / Number(p.szi)) : 0,
				// The exchange counts what the position paid; shown as a result, so received is positive.
				funding: -Number(p.cumFunding?.sinceOpen ?? 0) || 0,
				leverage: p.leverage.value,
			});
		}
	}

	const assets: AssetRow[] = [];
	const spot: HlAccountData["spot"] = [];
	let spotUsd = 0;
	let availableUsd = 0;
	for (const b of spotState.balances) {
		const total = Number(b.total);
		if (total === 0) continue;
		const token = tokenByIndex.get(b.token);
		const usd = total * (market.prices[b.token] ?? 0);
		spotUsd += usd;
		// Held by open orders, and (unified modes) what margin still needs: the smaller of the two is free.
		const unheld = sub(b.total, b.hold);
		const afterMargin = available.get(b.token);
		const free = afterMargin !== undefined && Number(afterMargin) < Number(unheld) ? afterMargin : unheld;
		// Never more than the balance itself, whatever the exchange reports.
		const freeUnits = Math.max(0, Math.min(total, Number(free) || 0));
		availableUsd += freeUnits * (market.prices[b.token] ?? 0);
		spot.push({
			coin: b.coin,
			token: b.token,
			tokenId: token?.tokenId ?? "",
			total: b.total,
			available: free,
			usd,
			evm: !!token?.evmContract || b.coin === "HYPE",
		});
		// Unified modes: USDC is the collateral of every position, and the balance the exchange reports
		// already includes their margin and unrealised PnL. The part held by positions is shown on their own
		// rows, so this row is only what is left over – otherwise the same money would be listed twice.
		const inPositions = unified && b.token === 0 ? Math.min(total, marginSum) : 0;
		const rowUnits = total - inPositions;
		if (inPositions > 0 && rowUnits < 0.005) continue;
		assets.push({
			key: `spot:${b.token}`,
			symbol: b.coin,
			name: token?.fullName ?? undefined,
			amount: inPositions > 0 ? String(Math.round(rowUnits * 1e6) / 1e6) : b.total,
			available: String(Math.min(freeUnits, rowUnits)),
			usd: usd - inPositions,
			kind: "spot",
			icon: { symbol: b.coin, hl: true },
		});
	}

	// Standard mode: the perp account is a balance of its own. What positions hold is on their rows;
	// this row is the rest of it, and the exchange says how much of that is free.
	const perpFree = unified ? 0 : Math.max(0, Number(perps[0]?.withdrawable ?? 0) || 0);
	availableUsd += perpFree;
	const perpCash = perpValue - marginSum;
	if (!unified && perpCash > 0.005) {
		assets.push({
			key: "perp:usdc",
			symbol: "USDC",
			amount: String(Math.round(perpCash * 1e6) / 1e6),
			available: String(Math.min(perpFree, perpCash)),
			usd: perpCash,
			kind: "spot",
			icon: { symbol: "USDC", hl: true },
			note: "perps",
		});
	}
	for (const p of positions) {
		assets.push({
			key: `perp:${p.coin}`,
			symbol: p.coin,
			amount: p.size,
			// A position's share of the account is the margin behind it (an isolated one carries its PnL in it).
			usd: p.margin,
			position: {
				notional: p.notional,
				margin: p.margin,
				isolated: p.isolated,
				pnl: p.pnl,
				funding: p.funding,
				entry: p.entryPx,
				mark: p.markPx,
			},
			kind: "perp",
			icon: { symbol: p.coin, hl: true },
			note: `${p.leverage}x`,
		});
	}

	const main = perps[0];
	const withdrawable = unified ? (spot.find((s) => s.token === 0)?.available ?? "0") : (main?.withdrawable ?? "0");

	return {
		exists: role.role !== "missing",
		multiSig: multiSig ? { authorizedUsers: multiSig.authorizedUsers, threshold: multiSig.threshold } : null,
		abstraction,
		unified,
		totalUsd: unified ? spotUsd : spotUsd + perpValue,
		availableUsd,
		assets,
		spot,
		withdrawable,
		positions,
		unrealizedPnl: positions.reduce((sum, p) => sum + (p.pnl || 0), 0),
		usdcToken: `USDC:${tokenByIndex.get(0)?.tokenId ?? ""}`,
	};
};

export interface HlSubInfo {
	name: string;
	address: Address;
	/** Perp USDC that can be moved out. */
	withdrawable: string;
	spot: { coin: string; token: number; tokenId: string; total: string }[];
}

export interface HlAccountExtras {
	agents: HlAgent[];
	subAccounts: HlSubInfo[];
	/** Lifetime traded volume, USD. */
	volume: number;
}

/** Rarely changing details used to decide which operations make sense. */
export const fetchHlExtras = async (env: NetworkEnv, user: Address): Promise<HlAccountExtras> => {
	const [market, agents, subs, portfolio] = await Promise.all([
		fetchHlMarket(env),
		hlInfo<HlAgent[]>(env, { type: "extraAgents", user }),
		hlInfo<HlSubAccount[] | null>(env, { type: "subAccounts", user }),
		hlInfo<HlPortfolio>(env, { type: "portfolio", user }).catch(() => [] as HlPortfolio),
	]);
	const allTime = portfolio.find(([period]) => period === "allTime")?.[1];
	return {
		agents: agents ?? [],
		subAccounts: (subs ?? []).map((s) => ({
			name: s.name,
			address: s.subAccountUser,
			withdrawable: s.clearinghouseState?.withdrawable ?? "0",
			spot: (s.spotState?.balances ?? [])
				.filter((b) => Number(b.total) > 0)
				.map((b) => ({
					coin: b.coin,
					token: b.token,
					tokenId: market.tokens.find((t) => t.index === b.token)?.tokenId ?? "",
					total: b.total,
				})),
		})),
		volume: Number(allTime?.vlm ?? 0),
	};
};

/** Checks that the address can be added as a Hyperliquid account. */
export const verifyHlAccount = async (env: NetworkEnv, user: Address): Promise<void> => {
	const role = await hlInfo<HlUserRole>(env, { type: "userRole", user });
	if (role.role === "missing") throw new AppError("hl.error.missing");
	if (role.role === "agent") throw new AppError("hl.error.isAgent");
	if (role.role === "vault") throw new AppError("hl.error.isVault");
};

export const hlUserExists = async (env: NetworkEnv, user: Address): Promise<boolean> =>
	(await hlInfo<HlUserRole>(env, { type: "userRole", user })).role !== "missing";

/** Fee charged for sending to `destination` (1 USDC when the account does not exist yet). */
export const hlTransferCheck = (env: NetworkEnv, source: Address, destination: Address): Promise<HlPreTransferCheck> =>
	hlInfo<HlPreTransferCheck>(env, { type: "preTransferCheck", user: destination, source });

export const SUB_ACCOUNT_MIN_VOLUME = 100_000;
/** Bridge fee of `withdraw3` (USDC), charged on top of nothing: the recipient gets amount − fee. */
export const HL_WITHDRAW_FEE = 1;

/** System address that bridges a spot token to HyperEVM. */
export const hlSystemAddress = (tokenIndex: number, coin: string): Address =>
	coin === "HYPE"
		? "0x2222222222222222222222222222222222222222"
		: (`0x20${tokenIndex.toString(16).padStart(38, "0")}` as Address);
