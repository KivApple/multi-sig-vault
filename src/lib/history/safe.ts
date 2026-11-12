import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { explorerTx, findChain, getChain } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { sameAddress } from "@/lib/format";
import { cleanSymbol, type HistoryAmount, type HistoryItem, type HistoryLoader } from "./types";

/**
 * Safe history from the Safe Transaction Service (`all-transactions`): executed Safe transactions
 * with the owners that confirmed them, plus incoming transfers. The service is a third party –
 * everything it returns is validated and shown as text; nothing from it is ever signed or sent.
 */
const PAGE = 30;
const ZERO = "0x0000000000000000000000000000000000000000";

const addressOf = (v: unknown): Address | undefined =>
	typeof v === "string" && isAddress(v, { strict: false }) ? getAddress(v) : undefined;

const OWNER_METHODS = new Set(["addOwnerWithThreshold", "removeOwner", "swapOwner", "changeThreshold"]);

interface RawTransfer {
	type?: unknown;
	from?: unknown;
	to?: unknown;
	value?: unknown;
	tokenInfo?: { symbol?: unknown; decimals?: unknown; trusted?: unknown } | null;
}

/**
 * Transfers of one transaction as amounts, netted per token. Tokens the service does not vouch for
 * are left out: anybody can send a Safe a worthless token named like a real one.
 */
export const transferAmounts = (transfers: unknown, safe: Address, nativeSymbol: string): HistoryAmount[] => {
	if (!Array.isArray(transfers)) return [];
	const net = new Map<string, bigint>();
	const decimalsOf = new Map<string, number>();
	for (const t of transfers.slice(0, 200) as RawTransfer[]) {
		if (!t || typeof t.value !== "string" || !/^\d{1,78}$/.test(t.value)) continue;
		let symbol: string | undefined;
		let decimals: number;
		if (t.type === "ETHER_TRANSFER") {
			symbol = nativeSymbol;
			decimals = 18;
		} else if (t.type === "ERC20_TRANSFER" && t.tokenInfo?.trusted === true) {
			symbol = cleanSymbol(t.tokenInfo.symbol);
			decimals = Number(t.tokenInfo.decimals);
			if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue;
		} else {
			continue;
		}
		if (!symbol) continue;
		const incoming = sameAddress(t.to as string, safe);
		const outgoing = sameAddress(t.from as string, safe);
		if (incoming === outgoing) continue;
		net.set(symbol, (net.get(symbol) ?? 0n) + (incoming ? BigInt(t.value) : -BigInt(t.value)));
		decimalsOf.set(symbol, decimals);
	}
	const out: HistoryAmount[] = [];
	for (const [symbol, value] of net) {
		if (value === 0n) continue;
		out.push({
			sign: value > 0n ? 1 : -1,
			value: formatUnits(value > 0n ? value : -value, decimalsOf.get(symbol) ?? 18),
			symbol,
		});
	}
	return out;
};

const firstOther = (transfers: unknown, safe: Address, field: "from" | "to"): Address | undefined => {
	if (!Array.isArray(transfers)) return undefined;
	for (const t of transfers as RawTransfer[]) {
		const a = addressOf(t?.[field]);
		if (a && !sameAddress(a, safe) && a !== ZERO) return a;
	}
	return undefined;
};

/** One service record as a history row; `undefined` for what is not worth a row (pending, spam, noise). */
export const describeSafeRecord = (raw: unknown, safe: Address, chainId: number): HistoryItem | undefined => {
	const r = raw as Record<string, unknown> | null;
	if (!r || typeof r !== "object") return undefined;
	const time = Date.parse(String(r.executionDate ?? ""));
	if (!Number.isFinite(time)) return undefined;
	const txHash =
		typeof r.transactionHash === "string" ? r.transactionHash : typeof r.txHash === "string" ? r.txHash : undefined;
	const hash = txHash && /^0x[0-9a-f]{64}$/i.test(txHash) ? txHash : undefined;
	const amounts = transferAmounts(r.transfers, safe, getChain(chainId).nativeSymbol);
	const base = { time, amounts, link: hash ? explorerTx(chainId, hash) : undefined, txHash: hash };
	const key = (name: string): HistoryItem["title"] => ({ key: `history.safe.${name}` });

	if (r.txType === "MULTISIG_TRANSACTION") {
		if (r.isExecuted !== true) return undefined;
		const method = (r.dataDecoded as { method?: unknown } | null)?.method;
		const hasData = typeof r.data === "string" && r.data.length > 2;
		const to = addressOf(r.to);
		let title: HistoryItem["title"];
		if (!hasData) title = key(r.value === "0" || !r.value ? "empty" : "send");
		else if (method === "transfer") title = key("send");
		else if (method === "signMessage") title = key("signMessage");
		else if (method === "multiSend") title = key("batch");
		else if (method === "approve") title = key("approve");
		else if (typeof method === "string" && OWNER_METHODS.has(method)) title = key("owners");
		else if (typeof method === "string" && /^\w{1,48}$/.test(method)) title = { raw: method };
		else title = key("call");
		const signers: Address[] = [];
		if (Array.isArray(r.confirmations)) {
			for (const c of r.confirmations.slice(0, 50) as { owner?: unknown }[]) {
				const owner = addressOf(c?.owner);
				if (owner && !signers.some((s) => sameAddress(s, owner))) signers.push(owner);
			}
		}
		const sent = amounts.some((a) => a.sign < 0);
		const target = sent ? (firstOther(r.transfers, safe, "to") ?? to) : to;
		return {
			...base,
			id: `m:${String(r.safeTxHash)}`,
			title,
			failed: r.isSuccessful === false,
			signers,
			sender: addressOf(r.executor),
			counterparty: target && !sameAddress(target, safe) ? { role: "to", address: target } : undefined,
		};
	}
	if (r.txType === "MODULE_TRANSACTION") {
		const module = addressOf(r.module);
		return {
			...base,
			id: `x:${hash ?? ""}:${String(r.moduleTransactionId ?? time)}`,
			title: key("module"),
			failed: r.isSuccessful === false,
			counterparty: module && { role: "from", address: module },
		};
	}
	if (r.txType === "ETHEREUM_TRANSACTION") {
		// Somebody else's transaction that moved the Safe's funds; without a visible amount it says nothing.
		if (amounts.length === 0) return undefined;
		const received = amounts.every((a) => a.sign > 0);
		const other = firstOther(r.transfers, safe, received ? "from" : "to");
		return {
			...base,
			id: `e:${hash ?? time}`,
			title: key(received ? "received" : "moved"),
			counterparty: other && { role: received ? "from" : "to", address: other },
		};
	}
	return undefined;
};

/** The creation of the Safe as a history row: when, by whom, with which signers. */
export const describeCreation = (raw: unknown, chainId: number): HistoryItem | undefined => {
	const r = raw as Record<string, unknown> | null;
	if (!r || typeof r !== "object") return undefined;
	const time = Date.parse(String(r.created ?? ""));
	if (!Number.isFinite(time)) return undefined;
	const hash =
		typeof r.transactionHash === "string" && /^0x[0-9a-f]{64}$/i.test(r.transactionHash)
			? r.transactionHash
			: undefined;
	const params = (r.dataDecoded as { parameters?: unknown } | null)?.parameters;
	const param = (name: string): unknown =>
		Array.isArray(params)
			? (params as { name?: unknown; value?: unknown }[]).find((p) => p?.name === name)?.value
			: undefined;
	const owners = param("_owners");
	const signers = Array.isArray(owners) ? owners.slice(0, 50).flatMap((o) => addressOf(o) ?? []) : [];
	const threshold = Number(param("_threshold"));
	const known = signers.length > 0 && Number.isInteger(threshold) && threshold > 0 && threshold <= signers.length;
	return {
		id: "created",
		time,
		title: known
			? { key: "history.safe.createdWith", vars: { m: String(threshold), n: String(signers.length) } }
			: { key: "history.safe.created" },
		amounts: [],
		link: hash ? explorerTx(chainId, hash) : undefined,
		txHash: hash,
		sender: addressOf(r.creator),
	};
};

const fetchCreation = async (base: string, safe: Address, chainId: number): Promise<HistoryItem | undefined> => {
	const res = await fetch(`${base}/api/v1/safes/${getAddress(safe)}/creation/`, { referrerPolicy: "no-referrer" });
	return res.ok ? describeCreation(await res.json(), chainId) : undefined;
};

/** `undefined` when the chain has no transaction service (no history source). */
export const safeHistoryLoader = (chainId: number, safe: Address): HistoryLoader | undefined => {
	const base = findChain(chainId)?.safeTxService;
	if (!base) return undefined;
	return async (raw) => {
		let offset = typeof raw === "number" ? raw : 0;
		// A page of the service may hold nothing worth showing (spam transfers) – read on.
		for (let attempt = 0; attempt < 5; attempt++) {
			const url = `${base}/api/v2/safes/${getAddress(safe)}/all-transactions/?limit=${PAGE}&offset=${offset}&executed=true&queued=false&trusted=true`;
			const res = await fetch(url, { referrerPolicy: "no-referrer" });
			if (res.status === 429) throw new AppError("history.error.rateLimit");
			if (!res.ok) throw new AppError("history.error.http", { status: res.status });
			const body = (await res.json()) as { results?: unknown; next?: unknown };
			const results = Array.isArray(body.results) ? body.results : [];
			const items = results.flatMap((r) => describeSafeRecord(r, safe, chainId) ?? []);
			offset += PAGE;
			const more = typeof body.next === "string" && results.length > 0;
			if (!more) {
				// The oldest entry of every Safe is its creation, which the list above does not contain.
				const created = await fetchCreation(base, safe, chainId).catch(() => undefined);
				return { items: created ? [...items, created] : items };
			}
			if (items.length > 0) return { items, next: offset };
		}
		return { items: [], next: offset };
	};
};
