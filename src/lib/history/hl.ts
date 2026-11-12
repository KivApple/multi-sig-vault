import { getAddress, isAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { HL_APP, HL_EXPLORER_API } from "@/config/chains";
import { sameAddress } from "@/lib/format";
import { hlInfo } from "@/lib/hl/api";
import { hlSignerTypedData, USER_SIGNED } from "@/lib/hl/signing";
import { toFullTypedData } from "@/lib/wallets/typedData";
import type { NetworkEnv } from "@/types/domain";
import { cleanDecimal, cleanSymbol, type HistoryAmount, type HistoryItem, type HistoryLoader } from "./types";

/**
 * Hyperliquid history from two sources.
 *
 * The ledger (`userNonFundingLedgerUpdates`) is complete and can be read back to the first day:
 * deposits, withdrawals, transfers, vault and staking moves. Orders and fills are not in it, which is
 * the point: trading is what agent keys do, and this page is about what the account's own key did.
 *
 * Actions that move nothing (approving an agent, converting to multi-sig, a sub-account…) leave no
 * ledger entry. They come from the explorer, which returns only the account's latest transactions
 * (a few hundred, trading included) and cannot be paged – for an account that trades through an
 * agent, older actions of this kind are simply not available anywhere.
 */
interface LedgerEntry {
	time: number;
	hash: string;
	delta: Record<string, unknown> & { type: string };
}

/** The exchange answers with at most this many entries, oldest first. */
const API_LIMIT = 2000;
const PAGE = 40;
const DAY = 86_400_000;
const GENESIS = Date.UTC(2023, 0, 1);
const ZERO_HASH = /^0x0+$/;

const addressOf = (v: unknown): Address | undefined =>
	typeof v === "string" && isAddress(v, { strict: false }) ? getAddress(v) : undefined;

const amount = (sign: HistoryAmount["sign"], value: unknown, symbol: unknown): HistoryAmount[] => {
	const v = cleanDecimal(value);
	const s = cleanSymbol(symbol);
	return v && s ? [{ sign, value: v, symbol: s }] : [];
};

/** Direction of a transfer between `user` and `destination`, seen from the account. */
const between = (
	me: Address,
	d: Record<string, unknown>,
): { sign: HistoryAmount["sign"]; counterparty?: HistoryItem["counterparty"] } => {
	const from = addressOf(d.user);
	const to = addressOf(d.destination);
	if (from && to && sameAddress(from, me) && sameAddress(to, me)) return { sign: 0 };
	if (from && sameAddress(from, me)) return { sign: -1, counterparty: to && { role: "to", address: to } };
	return { sign: 1, counterparty: from && { role: "from", address: from } };
};

const dexName = (v: unknown): string => (v === "spot" ? "Spot" : v === "" ? "Perps" : (cleanSymbol(v) ?? "?"));

/** One ledger entry as a history row. Unknown kinds keep their name and whatever amount they carry. */
export const describeLedgerEntry = (entry: LedgerEntry, me: Address, env: NetworkEnv): HistoryItem => {
	const d = entry.delta;
	const hash = typeof entry.hash === "string" && /^0x[0-9a-f]{64}$/i.test(entry.hash) ? entry.hash : undefined;
	const real = hash && !ZERO_HASH.test(hash) ? hash : undefined;
	const base = {
		id: `${entry.time}:${hash ?? ""}:${d.type}`,
		time: entry.time,
		link: real ? `${HL_APP[env]}/explorer/tx/${real}` : undefined,
		hlHash: real,
	};
	const key = (name: string, vars?: Record<string, string>): HistoryItem["title"] => ({
		key: `history.hl.${name}`,
		vars,
	});
	const vault = addressOf(d.vault);
	switch (d.type) {
		case "deposit":
			return { ...base, title: key("deposit"), amounts: amount(1, d.usdc, "USDC"), hlHash: undefined };
		case "withdraw":
			return { ...base, title: key("withdraw"), amounts: amount(-1, d.usdc, "USDC") };
		case "internalTransfer":
		case "subAccountTransfer": {
			const dir = between(me, d);
			return {
				...base,
				title: key(d.type === "internalTransfer" ? "transfer" : "subTransfer"),
				amounts: amount(dir.sign, d.usdc, "USDC"),
				counterparty: dir.counterparty,
				hlHash: dir.sign === 1 ? undefined : base.hlHash,
			};
		}
		case "accountClassTransfer":
			return {
				...base,
				title: key("move", d.toPerp ? { from: "Spot", to: "Perps" } : { from: "Perps", to: "Spot" }),
				amounts: amount(0, d.usdc, "USDC"),
			};
		case "spotTransfer":
		case "send": {
			const dir = between(me, d);
			const moved = d.type === "send" && dir.sign === 0;
			return {
				...base,
				title: moved ? key("move", { from: dexName(d.sourceDex), to: dexName(d.destinationDex) }) : key("transfer"),
				amounts: amount(dir.sign, d.amount, d.token),
				counterparty: dir.counterparty,
				hlHash: dir.sign === 1 ? undefined : base.hlHash,
			};
		}
		case "spotGenesis":
			return { ...base, title: key("genesis"), amounts: amount(1, d.amount, d.token), hlHash: undefined };
		case "cStakingTransfer":
			return { ...base, title: key(d.isDeposit ? "stake" : "unstake"), amounts: amount(0, d.amount, d.token) };
		case "vaultCreate":
		case "vaultDeposit":
			return {
				...base,
				title: key(d.type),
				amounts: amount(-1, d.usdc, "USDC"),
				counterparty: vault && { role: "to", address: vault },
			};
		case "vaultWithdraw":
			return {
				...base,
				title: key("vaultWithdraw"),
				amounts: amount(1, d.netWithdrawnUsd, "USDC"),
				counterparty: vault && { role: "from", address: vault },
			};
		case "vaultDistribution":
		case "vaultLeaderCommission":
			return { ...base, title: key(d.type), amounts: amount(1, d.usdc, "USDC"), hlHash: undefined };
		case "rewardsClaim":
			return { ...base, title: key("rewardsClaim"), amounts: amount(1, d.amount, d.token ?? "USDC") };
		case "liquidation":
			return { ...base, title: key("liquidation"), amounts: [], hlHash: undefined };
		default:
			return {
				...base,
				title: { raw: /^[\w-]{1,40}$/.test(d.type) ? d.type : "?" },
				amounts: d.usdc !== undefined ? amount(0, d.usdc, "USDC") : amount(0, d.amount, d.token),
			};
	}
};

const isEntry = (v: unknown): v is LedgerEntry => {
	const e = v as LedgerEntry | null;
	return (
		!!e &&
		typeof e.time === "number" &&
		typeof e.delta === "object" &&
		e.delta !== null &&
		typeof e.delta.type === "string"
	);
};

const fetchLedger = async (
	env: NetworkEnv,
	user: Address,
	startTime: number,
	endTime?: number,
): Promise<LedgerEntry[]> => {
	const body: Record<string, unknown> = { type: "userNonFundingLedgerUpdates", user, startTime };
	if (endTime !== undefined) body.endTime = endTime;
	const res = await hlInfo<unknown>(env, body);
	return Array.isArray(res) ? res.filter(isEntry) : [];
};

type Cursor = { mode: "all"; offset: number } | { mode: "window"; end: number; span: number };

/**
 * Newest-first pages over an API that only reads forward from a start time.
 *
 * A short history fits in one answer and is paged in memory. A long one is read in time windows
 * walking back from now: a window that comes back full was cut at its newest end, so it is halved
 * and asked again; a sparse one doubles the next window.
 */
export const hlHistoryLoader = (env: NetworkEnv, user: Address): HistoryLoader => {
	let all: LedgerEntry[] | undefined;
	/** Actions without a ledger entry, newest first; each is handed out with the page its time falls into. */
	let extras: HistoryItem[] = [];
	const toItems = (entries: LedgerEntry[], last: boolean): HistoryItem[] => {
		const items = entries.map((e) => describeLedgerEntry(e, user, env));
		const oldest = items.at(-1)?.time;
		const take = last || oldest === undefined ? (last ? extras : []) : extras.filter((x) => x.time >= oldest);
		if (take.length === 0) return items;
		extras = extras.filter((x) => !take.includes(x));
		return [...items, ...take].sort((a, b) => b.time - a.time);
	};

	return async (raw) => {
		let cursor = raw as Cursor | undefined;
		if (!cursor) {
			const [first, recent] = await Promise.all([
				fetchLedger(env, user, 0),
				// The explorer is a second source: without it the ledger alone is still shown.
				fetchExplorerActions(env, user).catch(() => []),
			]);
			extras = recent;
			if (first.length < API_LIMIT) {
				all = first.sort((a, b) => b.time - a.time);
				cursor = { mode: "all", offset: 0 };
			} else {
				cursor = { mode: "window", end: Date.now(), span: 30 * DAY };
			}
		}
		if (cursor.mode === "all") {
			const list = all ?? [];
			const end = cursor.offset + PAGE;
			const more = end < list.length;
			return {
				items: toItems(list.slice(cursor.offset, end), !more),
				next: more ? ({ mode: "all", offset: end } satisfies Cursor) : undefined,
			};
		}
		let { end, span } = cursor;
		for (let attempt = 0; attempt < 12; attempt++) {
			const start = Math.max(GENESIS, end - span);
			const entries = await fetchLedger(env, user, start, end);
			if (entries.length >= API_LIMIT && span > 60_000) {
				span = Math.floor(span / 2);
				continue;
			}
			const older = start > GENESIS;
			if (entries.length === 0 && older) {
				end = start - 1;
				span *= 2;
				continue;
			}
			return {
				items: toItems(
					entries.sort((a, b) => b.time - a.time),
					!older,
				),
				next: older
					? ({
							mode: "window",
							end: start - 1,
							span: entries.length < API_LIMIT / 10 ? span * 2 : span,
						} satisfies Cursor)
					: undefined,
			};
		}
		return { items: [], next: { mode: "window", end, span } satisfies Cursor };
	};
};

// ---- Who signed (multi-sig accounts) ----

export interface HlSigners {
	/** Addresses recovered from the inner signatures. */
	signers: Address[];
	/** The signer that submitted the action. */
	sender?: Address;
}

const pad32 = (v: unknown): Hex | undefined =>
	typeof v === "string" && /^0x[0-9a-f]{1,64}$/i.test(v) ? (`0x${v.slice(2).padStart(64, "0")}` as Hex) : undefined;

/**
 * Recovers who signed a `multiSig` action, as the explorer returns it. Every inner signature is over
 * the inner action bound to the multi-sig user and the outer signer – the same typed data the app
 * builds when it collects signatures. Returns `undefined` for anything that is not such an action;
 * L1 inner actions (their hash needs the outer nonce, which the explorer does not give) yield the sender only.
 */
export const recoverMultiSigSigners = async (action: unknown, env: NetworkEnv): Promise<HlSigners | undefined> => {
	const a = action as {
		type?: unknown;
		signatures?: unknown;
		payload?: { multiSigUser?: unknown; outerSigner?: unknown; action?: unknown };
	} | null;
	if (!a || a.type !== "multiSig" || !a.payload || !Array.isArray(a.signatures)) return undefined;
	const user = addressOf(a.payload.multiSigUser);
	const sender = addressOf(a.payload.outerSigner);
	const inner = a.payload.action as Record<string, unknown> | null;
	if (!user || !sender || !inner || typeof inner !== "object") return undefined;
	if (!USER_SIGNED[String(inner.type)]) return { signers: [], sender };
	const typed = toFullTypedData(
		hlSignerTypedData(
			{ kind: "hl", multiSig: true, leader: sender, nonce: 0, signing: "user", action: inner },
			user,
			env,
		),
	);
	const signers: Address[] = [];
	for (const sig of a.signatures.slice(0, 20) as { r?: unknown; s?: unknown; v?: unknown }[]) {
		const r = pad32(sig?.r);
		const s = pad32(sig?.s);
		const v = Number(sig?.v);
		if (!r || !s || (v !== 27 && v !== 28)) continue;
		const signature = `${r}${s.slice(2)}${v.toString(16)}` as Hex;
		const who = await recoverTypedDataAddress({ ...typed, signature } as never).catch(() => undefined);
		if (who && !signers.some((x) => sameAddress(x, who))) signers.push(who);
	}
	return { signers, sender };
};

const signerCache = new Map<string, Promise<HlSigners | undefined>>();

/** Signers of a transaction by hash, from the explorer. Cached; `undefined` when unknown. */
export const fetchHlSigners = (env: NetworkEnv, hash: string): Promise<HlSigners | undefined> => {
	const key = `${env}:${hash}`;
	let hit = signerCache.get(key);
	if (!hit) {
		hit = (async () => {
			const res = await fetch(HL_EXPLORER_API[env], {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ type: "txDetails", hash }),
				referrerPolicy: "no-referrer",
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = (await res.json()) as { tx?: { action?: unknown } };
			return recoverMultiSigSigners(body.tx?.action, env);
		})();
		// A failed lookup may be retried later.
		hit.catch(() => signerCache.delete(key));
		signerCache.set(key, hit);
	}
	return hit;
};

// ---- Actions without a ledger entry (explorer) ----

/** Action types whose effect is a ledger entry already. */
const IN_LEDGER = new Set([
	"withdraw3",
	"usdSend",
	"spotSend",
	"sendAsset",
	"usdClassTransfer",
	"subAccountTransfer",
	"subAccountSpotTransfer",
	"vaultTransfer",
	"cDeposit",
	"cWithdraw",
	"claimRewards",
]);

/** L1 actions (an agent could sign them too) that are account management, not trading. */
const L1_SHOWN = new Set(["createSubAccount", "subAccountModify", "createVault", "setReferrer", "setDisplayName"]);

const shortText = (v: unknown, max = 32): string | undefined =>
	typeof v === "string" && v.length > 0
		? v.replace(/[^\p{L}\p{N} ._:@#/+-]/gu, "").slice(0, max) || undefined
		: undefined;

const parseSigners = (v: unknown): { authorizedUsers?: unknown; threshold?: unknown } | null => {
	try {
		const parsed: unknown = JSON.parse(String(v));
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
};

/** Title and counterparty of an action the account's key signed. `undefined` – not shown. */
const describeAction = (action: Record<string, unknown>): Pick<HistoryItem, "title" | "counterparty"> | undefined => {
	const type = String(action.type);
	const key = (name: string, vars?: Record<string, string>): HistoryItem["title"] => ({
		key: `history.hl.${name}`,
		vars,
	});
	if (IN_LEDGER.has(type)) return undefined;
	switch (type) {
		case "approveAgent": {
			const agent = addressOf(action.agentAddress);
			// The app stores the term in the name ("<name> valid_until <ms>").
			const name = shortText(String(action.agentName ?? "").replace(/ valid_until \d+$/, "")) ?? "";
			if (!agent || /^0x0+$/.test(agent)) return { title: key("agentRevoke", { name }) };
			return { title: key("agentApprove", { name }), counterparty: { role: "to", address: agent } };
		}
		case "convertToMultiSigUser": {
			const config = parseSigners(action.signers);
			const users = Array.isArray(config?.authorizedUsers) ? config.authorizedUsers.length : 0;
			if (!config || users === 0) return { title: key("multiSigOff") };
			return { title: key("multiSigOn", { m: String(Number(config.threshold) || 0), n: String(users) }) };
		}
		case "createSubAccount":
			return { title: key("subCreate", { name: shortText(action.name) ?? "" }) };
		case "subAccountModify": {
			const sub = addressOf(action.subAccountUser);
			return {
				title: key("subRename", { name: shortText(action.name) ?? "" }),
				counterparty: sub && { role: "to", address: sub },
			};
		}
		case "approveBuilderFee": {
			const builder = addressOf(action.builder);
			return {
				title: key("builderFee", { rate: shortText(action.maxFeeRate, 12) ?? "" }),
				counterparty: builder && { role: "to", address: builder },
			};
		}
		case "tokenDelegate": {
			const validator = addressOf(action.validator);
			return {
				title: key(action.isUndelegate ? "undelegate" : "delegate"),
				counterparty: validator && { role: "to", address: validator },
			};
		}
		default:
			// Signed with the account's own key (EIP-712 "user-signed" actions carry the chain name) or
			// plain account management: shown under its own name. Everything else is trading.
			if (typeof action.hyperliquidChain !== "string" && !L1_SHOWN.has(type)) return undefined;
			return { title: { raw: /^[\w-]{1,40}$/.test(type) ? type : "?" } };
	}
};

interface ExplorerTx {
	time?: unknown;
	user?: unknown;
	hash?: unknown;
	error?: unknown;
	action?: unknown;
}

/** One explorer transaction as a history row, when it is the account's own action without a ledger entry. */
export const describeExplorerTx = async (
	tx: ExplorerTx,
	me: Address,
	env: NetworkEnv,
): Promise<HistoryItem | undefined> => {
	const outer = tx.action as Record<string, unknown> | null;
	if (!outer || typeof outer !== "object" || typeof tx.time !== "number") return undefined;
	const hash = typeof tx.hash === "string" && /^0x[0-9a-f]{64}$/i.test(tx.hash) ? tx.hash : undefined;
	let action = outer;
	let signed: HlSigners | undefined;
	if (outer.type === "multiSig") {
		const payload = outer.payload as { multiSigUser?: unknown; action?: unknown } | null;
		if (!sameAddress(addressOf(payload?.multiSigUser), me)) return undefined;
		if (!payload?.action || typeof payload.action !== "object") return undefined;
		action = payload.action as Record<string, unknown>;
		signed = await recoverMultiSigSigners(outer, env).catch(() => undefined);
		// The ledger row of the same transaction finds its signers here without another request.
		if (hash && signed) signerCache.set(`${env}:${hash}`, Promise.resolve(signed));
	} else if (!sameAddress(addressOf(tx.user), me)) {
		return undefined;
	}
	const described = describeAction(action);
	if (!described) return undefined;
	return {
		id: `x:${tx.time}:${hash ?? ""}`,
		time: tx.time,
		amounts: [],
		...described,
		failed: tx.error !== null && tx.error !== undefined,
		link: hash && !ZERO_HASH.test(hash) ? `${HL_APP[env]}/explorer/tx/${hash}` : undefined,
		signers: signed?.signers.length ? signed.signers : undefined,
		sender: signed?.sender,
	};
};

const fetchExplorerActions = async (env: NetworkEnv, user: Address): Promise<HistoryItem[]> => {
	const res = await fetch(HL_EXPLORER_API[env], {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ type: "userDetails", user }),
		referrerPolicy: "no-referrer",
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = (await res.json()) as { txs?: unknown };
	const txs = Array.isArray(body.txs) ? (body.txs.slice(0, 1000) as ExplorerTx[]) : [];
	const items = await Promise.all(txs.map((tx) => describeExplorerTx(tx, user, env).catch(() => undefined)));
	return items.filter((i): i is HistoryItem => !!i).sort((a, b) => b.time - a.time);
};
