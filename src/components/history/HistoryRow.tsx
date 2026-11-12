import { ArrowLeft, ArrowRight, ExternalLink, PenLine, Send } from "lucide-react";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { AddressLabel } from "@/components/common/AddressLabel";
import { useLang, useT } from "@/i18n";
import { formatAmount, formatDateTime } from "@/lib/format";
import { fetchHlSigners } from "@/lib/history/hl";
import type { HistoryItem } from "@/lib/history/types";
import type { AddressScope } from "@/lib/known";
import type { NetworkEnv } from "@/types/domain";

export interface HistoryRowProps {
	item: HistoryItem;
	/** Network of the account: names its other accounts among counterparties. */
	scope: AddressScope;
	/** Title of the operation made in this app, when the item is one. */
	ownTitle?: string;
	/** Set for a Hyperliquid multi-sig account: signers are looked up by hash. */
	lookupSigners?: NetworkEnv;
}

const SIGN = { 1: "+", [-1]: "−", 0: "" } as const;

/** Signers and sender of a multi-sig exchange action, fetched once the row is on screen. */
const useHlSigners = (env: NetworkEnv | undefined, hash: string | undefined) => {
	const [found, setFound] = useState<{ signers: Address[]; sender?: Address }>();
	useEffect(() => {
		if (!env || !hash) return undefined;
		let stale = false;
		fetchHlSigners(env, hash)
			.then((r) => !stale && r && setFound(r))
			.catch(() => undefined);
		return () => {
			stale = true;
		};
	}, [env, hash]);
	return found;
};

/**
 * One line of history. What happened and how much read at normal size; when, with whom and who
 * signed sit in one small muted line under it.
 */
export const HistoryRow: React.FC<HistoryRowProps> = ({ item, scope, ownTitle, lookupSigners }) => {
	const t = useT();
	const lang = useLang();
	const looked = useHlSigners(lookupSigners, item.hlHash);
	const signers = item.signers ?? looked?.signers ?? [];
	const sender = item.sender ?? looked?.sender;
	const shown = item.amounts.slice(0, 2);

	return (
		<li className="flex flex-col gap-1 px-4 py-2.5">
			<div className="flex items-baseline justify-between gap-3">
				<span className={`min-w-0 truncate font-medium ${item.failed ? "text-base-content/50 line-through" : ""}`}>
					{ownTitle ??
						("key" in item.title ? t(item.title.key, item.title.vars) : <span className="mono">{item.title.raw}</span>)}
				</span>
				<span className="tabular flex shrink-0 flex-col items-end text-sm">
					{shown.map((a) => (
						<span key={a.symbol} className={a.sign > 0 ? "text-success" : ""}>
							{SIGN[a.sign]}
							{formatAmount(a.value, lang, 6)} {a.symbol}
						</span>
					))}
					{item.amounts.length > shown.length && (
						<span className="text-base-content/60 text-xs">+{item.amounts.length - shown.length}</span>
					)}
				</span>
			</div>
			<div className="text-base-content/60 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
				<span>{formatDateTime(item.time, lang)}</span>
				{item.failed && <span className="text-error">{t("history.failed")}</span>}
				{item.counterparty && (
					<span className="inline-flex min-w-0 items-center gap-1">
						{item.counterparty.role === "to" ? <ArrowRight className="size-3" /> : <ArrowLeft className="size-3" />}
						<AddressLabel address={item.counterparty.address} scope={scope} size={14} compact />
					</span>
				)}
				{signers.length > 0 && (
					<span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1" title={t("history.signedBy")}>
						<PenLine className="size-3 shrink-0" aria-label={t("history.signedBy")} />
						{signers.map((s) => (
							<AddressLabel key={s} address={s} size={14} compact />
						))}
					</span>
				)}
				{sender && (
					<span className="inline-flex min-w-0 items-center gap-1.5" title={t("history.sentBy")}>
						<Send className="size-3 shrink-0" aria-label={t("history.sentBy")} />
						<AddressLabel address={sender} size={14} compact />
					</span>
				)}
				{item.link && (
					<a
						className="link link-hover inline-flex items-center"
						href={item.link}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={t("history.viewTx")}
						title={t("history.viewTx")}
					>
						<ExternalLink className="size-3" />
					</a>
				)}
			</div>
		</li>
	);
};
