import { Check, KeyRound, Pencil, Plus, RefreshCw, ScanLine, Wallet } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AccountCard } from "@/components/accounts/AccountCard";
import { SortableList } from "@/components/common/SortableList";
import { SortableRow } from "@/components/common/SortableRow";
import { ImportOperationDialog } from "@/components/ops/ImportOperationDialog";
import { ScannerDialog } from "@/components/qr/ScannerDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconButton } from "@/components/ui/IconButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { findChain } from "@/config/chains";
import { useLang, useT } from "@/i18n";
import { requestRefresh, useCacheStore } from "@/lib/dataCache";
import { describeError } from "@/lib/describeError";
import { formatUsd } from "@/lib/format";
import { accountCacheKey } from "@/lib/ops/engine";
import { applyImport, parseImport, type ParsedImport } from "@/lib/ops/transfer";
import { parseAddressQr } from "@/lib/qr/address";
import { isTransferText } from "@/lib/qr/transfer";
import { toast } from "@/lib/toast";
import { useAppStore } from "@/store/appStore";

/** Home: account cards, universal QR scanner, list editing. */
export const AccountsPage: React.FC = () => {
	const t = useT();
	const lang = useLang();
	const navigate = useNavigate();
	const accounts = useAppStore((s) => s.accounts);
	const hasSigners = useAppStore((s) => s.signers.length > 0);
	const [editing, setEditing] = useState(false);
	const [scanning, setScanning] = useState(false);
	const [parsed, setParsed] = useState<ParsedImport | null>(null);

	const visible = useMemo(() => (editing ? accounts : accounts.filter((a) => !a.hidden)), [accounts, editing]);
	const ids = useMemo(() => visible.map((a) => a.id), [visible]);
	const shown = useMemo(() => accounts.filter((a) => !a.hidden), [accounts]);
	const total = useCacheStore((s) => {
		let sum = 0;
		let known = false;
		for (const a of shown) {
			const entry = s.entries[accountCacheKey(a)]?.data as { totalUsd?: number } | undefined;
			if (entry?.totalUsd !== undefined) {
				sum += entry.totalUsd;
				known = true;
			}
		}
		return known ? sum : undefined;
	});

	const handleReorder = useCallback((next: string[]) => useAppStore.getState().reorderAccounts(next), []);

	const handleScan = useCallback(
		async (text: string) => {
			if (isTransferText(text)) {
				try {
					const result = await parseImport(text);
					setScanning(false);
					setParsed(result);
				} catch (e) {
					toast.error(describeError(e, t));
				}
				return;
			}
			const address = parseAddressQr(text);
			if (!address) {
				toast.error(t("accounts.scan.unknown"));
				return;
			}
			setScanning(false);
			const chain = findChain(address.chainId);
			const query = new URLSearchParams({ address: address.address });
			if (chain) {
				query.set("kind", "safe");
				query.set("chain", chain.key);
				query.set("env", chain.env);
			}
			void navigate(`/accounts/new?${query.toString()}`);
		},
		[navigate, t],
	);

	const handleImport = useCallback(
		async (p: ParsedImport) => {
			try {
				await applyImport(p);
				setParsed(null);
				toast.success(t("import.done"));
				void navigate(`/account/${encodeURIComponent(p.account.id)}`);
			} catch (e) {
				toast.error(describeError(e, t));
			}
		},
		[navigate, t],
	);

	return (
		<>
			<PageHeader
				title={t("nav.accounts")}
				actions={
					<>
						<IconButton label={t("accounts.scan")} onClick={() => setScanning(true)}>
							<ScanLine className="size-5" />
						</IconButton>
						{accounts.length > 0 && (
							<IconButton label={t("common.refresh")} onClick={() => requestRefresh("account:")}>
								<RefreshCw className="size-5" />
							</IconButton>
						)}
						{accounts.length > 0 && (
							<IconButton
								label={t(editing ? "common.done" : "accounts.editList")}
								onClick={() => setEditing((v) => !v)}
								active={editing}
							>
								{editing ? <Check className="size-5" /> : <Pencil className="size-5" />}
							</IconButton>
						)}
						<Link
							to="/accounts/new"
							className="btn btn-primary btn-sm btn-square"
							aria-label={t("accounts.add")}
							title={t("accounts.add")}
						>
							<Plus className="size-5" />
						</Link>
					</>
				}
			/>

			{!hasSigners && (
				<div className="card-surface border-primary/40 mb-4 flex items-center gap-3 p-4">
					<KeyRound className="text-primary size-6 shrink-0" />
					<div className="min-w-0 flex-1">
						<p className="font-medium">{t("accounts.noSigners.title")}</p>
						<p className="text-base-content/60 text-sm">{t("accounts.noSigners.text")}</p>
					</div>
					<Link to="/signers" className="btn btn-primary btn-sm">
						{t("accounts.noSigners.action")}
					</Link>
				</div>
			)}

			{accounts.length === 0 ? (
				<EmptyState
					icon={<Wallet className="size-10" />}
					title={t("accounts.empty.title")}
					text={t("accounts.empty.text")}
					action={
						<Link to="/accounts/new" className="btn btn-primary">
							<Plus className="size-4" />
							{t("accounts.add")}
						</Link>
					}
				/>
			) : (
				<>
					{total !== undefined && shown.length > 1 && !editing && (
						<p className="text-base-content/60 mb-3 px-1 text-sm">
							{t("accounts.total")}{" "}
							<span className="text-base-content tabular font-semibold">{formatUsd(total, lang)}</span>
						</p>
					)}
					<SortableList ids={ids} onReorder={handleReorder}>
						<ul className="flex flex-col gap-2">
							{visible.map((account) => (
								<SortableRow key={account.id} id={account.id} editing={editing}>
									<AccountCard account={account} editing={editing} />
								</SortableRow>
							))}
						</ul>
					</SortableList>
					{visible.length === 0 && (
						<p className="text-base-content/60 py-8 text-center text-sm">{t("accounts.allHidden")}</p>
					)}
				</>
			)}

			<ScannerDialog
				open={scanning}
				onClose={() => setScanning(false)}
				onResult={(text) => void handleScan(text)}
				title={t("accounts.scan")}
				hint={t("accounts.scan.hint")}
			/>
			<ImportOperationDialog parsed={parsed} onClose={() => setParsed(null)} onConfirm={(p) => void handleImport(p)} />
		</>
	);
};
