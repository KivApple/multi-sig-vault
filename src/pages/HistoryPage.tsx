import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router";
import { Notice } from "@/components/common/Notice";
import { HistoryRow } from "@/components/history/HistoryRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { useLang, useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { formatDateTime, shortAddress } from "@/lib/format";
import { hlActionInLedger, hlHistoryLoader } from "@/lib/history/hl";
import { safeHistoryLoader } from "@/lib/history/safe";
import type { HistoryItem } from "@/lib/history/types";
import { opTitleKey } from "@/lib/ops/registry";
import { useOpEnv } from "@/hooks/useAccountData";
import { useAppStore } from "@/store/appStore";

interface Loaded {
	items: HistoryItem[];
	actionsSince?: number | null;
	cursor?: unknown;
	done: boolean;
}

const EMPTY: Loaded = { items: [], done: false };

/** A row the chain data could not name better than "a call": the app's own name for the operation is used instead. */
const isGeneric = (item: HistoryItem): boolean =>
	"raw" in item.title || item.title.key === "history.safe.call" || item.title.key === "history.safe.batch";

/**
 * Exchange actions this app sent for the account and still remembers, as history rows with their
 * signers. Only those that leave no ledger entry: the rest are in the ledger already.
 */
const rememberedHlActions = (accountId: string): HistoryItem[] =>
	useAppStore.getState().operations.flatMap((op): HistoryItem[] => {
		if (op.accountId !== accountId || op.status !== "sent" || !op.result || op.payload?.kind !== "hl") return [];
		const type = String(op.payload.action.type);
		if (hlActionInLedger(type)) return [];
		return [
			{
				id: `op:${op.id}`,
				time: op.result.sentAt,
				title: { key: opTitleKey(op.type) },
				amounts: [],
				hlAction: type,
				signers: op.signatures.map((s) => s.signer),
				sender: op.result.sender,
			},
		];
	});

/**
 * History of one account, newest first. Opened on demand from the account page; older pages load
 * as the list is scrolled to its end.
 */
export const HistoryPage: React.FC = () => {
	const t = useT();
	const lang = useLang();
	const { id } = useParams();
	const ready = useAppStore((s) => s.ready);
	const account = useAppStore((s) => s.accounts.find((a) => a.id === id));
	const operations = useAppStore((s) => s.operations);
	const { data } = useOpEnv(account);

	const loader = useMemo(() => {
		if (!account) return undefined;
		if (account.kind === "safe") return safeHistoryLoader(account.chainId as number, account.address);
		return hlHistoryLoader(account.env, account.address, rememberedHlActions(account.id));
	}, [account?.kind, account?.env, account?.chainId, account?.address]);

	const [state, setState] = useState<Loaded>(EMPTY);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const busy = useRef(false);
	const stateRef = useRef(state);
	stateRef.current = state;

	const loadMore = useCallback(async () => {
		if (!loader || busy.current || stateRef.current.done) return;
		busy.current = true;
		setLoading(true);
		setError(undefined);
		const before = stateRef.current;
		try {
			const page = await loader(before.cursor);
			// The account changed while this page was on its way.
			if (stateRef.current !== before) return;
			const seen = new Set(before.items.map((i) => i.id));
			setState({
				items: [...before.items, ...page.items.filter((i) => !seen.has(i.id))],
				actionsSince: before.cursor === undefined ? page.actionsSince : before.actionsSince,
				cursor: page.next,
				done: page.next === undefined,
			});
		} catch (e) {
			setError(describeError(e, t));
		} finally {
			busy.current = false;
			setLoading(false);
		}
	}, [loader, t]);

	useEffect(() => {
		const fresh = { ...EMPTY };
		stateRef.current = fresh;
		setState(fresh);
		setError(undefined);
	}, [loader]);

	// The sentinel under the list asks for the next page whenever it comes into view.
	const sentinel = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = sentinel.current;
		if (!el || !loader || state.done || error) return undefined;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) void loadMore();
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [loader, loadMore, state.done, state.items.length, error]);

	// Operations made in this app are named the way the app names them.
	const ownTitles = useMemo(() => {
		const map = new Map<string, string>();
		for (const op of operations) {
			if (op.accountId === account?.id && op.result?.txHash)
				map.set(op.result.txHash.toLowerCase(), t(opTitleKey(op.type)));
		}
		return map;
	}, [operations, account?.id, t]);

	if (!account) return ready ? <Navigate to="/" replace /> : null;

	const back = `/account/${encodeURIComponent(account.id)}`;
	const scope = account.kind === "safe" ? { chainId: account.chainId as number } : { hlEnv: account.env };
	const multiSig = account.kind === "hl" && !!(data.data as { multiSig?: unknown } | undefined)?.multiSig;
	const name = account.name?.trim() || shortAddress(account.address);

	return (
		<>
			<PageHeader back={back} title={`${t("history.title")} · ${name}`} />
			{!loader ? (
				<Notice>{t("history.noSource")}</Notice>
			) : (
				<div className="flex flex-col gap-3">
					<p className="text-base-content/60 text-xs">
						{t(account.kind === "hl" ? "history.hlNote" : "history.safeNote")}
					</p>
					{state.actionsSince !== undefined && (
						<Notice>
							{state.actionsSince === null
								? t("history.hlNoExplorer")
								: t("history.hlCut", { date: formatDateTime(state.actionsSince, lang) })}
						</Notice>
					)}
					{state.items.length > 0 && (
						<ul className="card-surface divide-base-300 flex flex-col divide-y">
							{state.items.map((item) => (
								<HistoryRow
									key={item.id}
									item={item}
									scope={scope}
									ownTitle={item.txHash && isGeneric(item) ? ownTitles.get(item.txHash.toLowerCase()) : undefined}
									lookupSigners={multiSig ? account.env : undefined}
								/>
							))}
						</ul>
					)}
					{error && <Notice tone="error">{error}</Notice>}
					{state.done ? (
						<p className="text-base-content/60 py-2 text-center text-sm">
							{t(state.items.length === 0 ? "history.empty" : "history.end")}
						</p>
					) : loading ? (
						<div className="flex justify-center py-3">
							<Spinner />
						</div>
					) : (
						<button type="button" className="btn btn-ghost btn-sm self-center" onClick={() => void loadMore()}>
							{t("history.more")}
						</button>
					)}
					<div ref={sentinel} aria-hidden="true" />
				</div>
			)}
		</>
	);
};
