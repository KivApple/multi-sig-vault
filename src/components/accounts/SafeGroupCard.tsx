import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, Eye, EyeOff, GripVertical, QrCode, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { SortableList } from "@/components/common/SortableList";
import { AccountIcon } from "@/components/icons/AccountIcon";
import { NetworkIcon } from "@/components/icons/NetworkIcon";
import { QrDialog } from "@/components/qr/QrDialog";
import { CopyButton } from "@/components/ui/CopyButton";
import { IconButton } from "@/components/ui/IconButton";
import { useAccountData } from "@/hooks/useAccountData";
import { useConfirm } from "@/hooks/useConfirm";
import { useLang, useT } from "@/i18n";
import { useCacheStore } from "@/lib/dataCache";
import { formatUsd, shortAddress } from "@/lib/format";
import { accountNetworkName } from "@/lib/known";
import { accountCacheKey } from "@/lib/ops/engine";
import { addressQrValue } from "@/lib/qr/address";
import type { SafeAccountData } from "@/lib/safe/account";
import { useAppStore } from "@/store/appStore";
import type { Account } from "@/types/domain";
import { multiSigLabel } from "./multiSigLabel";

export interface SafeGroupCardProps {
	/** Safes of one address on different networks, in row order. */
	accounts: Account[];
	editing: boolean;
	/** New order of the rows (account ids). */
	onReorder: (ids: string[]) => void;
}

interface RowProps {
	account: Account;
	editing: boolean;
	/** The signature threshold differs between the networks: every row says its own. */
	showMode: boolean;
}

const GroupRow: React.FC<RowProps> = ({ account, editing, showMode }) => {
	const t = useT();
	const lang = useLang();
	const confirm = useConfirm();
	const { data, error } = useAccountData(account);
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: account.id,
		disabled: !editing,
	});
	const name = account.name?.trim();
	const network = accountNetworkName(account);
	const mode = showMode ? multiSigLabel(account, data, t) : undefined;

	const toggleHidden = useCallback(() => {
		useAppStore.getState().updateAccount(account.id, { hidden: !account.hidden });
	}, [account.id, account.hidden]);

	const handleDelete = useCallback(async () => {
		const ok = await confirm({
			title: t("accounts.delete.title"),
			body: t("accounts.delete.body", { name: name ? `${name} · ${network}` : network }),
			confirmLabel: t("common.delete"),
			danger: true,
		});
		if (ok) useAppStore.getState().removeAccount(account.id);
	}, [confirm, account.id, name, network, t]);

	const text = (
		<>
			<NetworkIcon chainId={account.chainId as number} size={28} />
			<span className="min-w-0 flex-1 leading-tight">
				{/* The account's own name, when it has one, goes over the network. */}
				{name && <span className="block truncate font-medium">{name}</span>}
				<span className={`block truncate ${name ? "text-base-content/60 text-xs" : "font-medium"}`}>{network}</span>
			</span>
			{mode && <span className="badge badge-ghost badge-xs text-base-content/70 whitespace-nowrap">{mode}</span>}
		</>
	);

	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={`border-base-300 bg-base-200 border-t first:border-t-0 ${isDragging ? "relative z-10 opacity-90" : ""}`}
		>
			{editing ? (
				<div className={`flex min-h-12 items-center gap-2 py-1 pr-1 ${account.hidden ? "opacity-50" : ""}`}>
					<button
						type="button"
						className="text-base-content/40 hover:text-base-content flex h-10 w-7 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
						aria-label={t("common.dragToReorder")}
						title={t("common.dragToReorder")}
						{...attributes}
						{...listeners}
					>
						<GripVertical className="size-4" />
					</button>
					{text}
					<span className="flex shrink-0">
						<IconButton label={t(account.hidden ? "common.show" : "common.hide")} onClick={toggleHidden}>
							{account.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
						</IconButton>
						<IconButton label={t("common.delete")} onClick={() => void handleDelete()} className="text-error">
							<Trash2 className="size-4" />
						</IconButton>
					</span>
				</div>
			) : (
				// The row is the only thing in the card that opens something: it alone reacts to the pointer.
				<Link
					to={`/account/${encodeURIComponent(account.id)}`}
					className="hover:bg-base-300/60 flex min-h-12 items-center gap-2.5 py-1.5 pr-1.5 pl-2.5"
				>
					{text}
					<span className="tabular shrink-0 font-semibold">
						{data ? (
							formatUsd(data.totalUsd, lang, true)
						) : error ? (
							<span className="text-base-content/40">—</span>
						) : (
							<span className="skeleton inline-block h-5 w-14" />
						)}
					</span>
					<ChevronRight className="text-base-content/40 size-4 shrink-0" />
				</Link>
			)}
		</li>
	);
};

/**
 * Safes that share an address, as one card: the address and the sum on top, a row per network below.
 * Only the rows are links; the header does nothing but copy the address and show its QR code.
 */
export const SafeGroupCard: React.FC<SafeGroupCardProps> = ({ accounts, editing, onReorder }) => {
	const t = useT();
	const lang = useLang();
	const [qr, setQr] = useState(false);
	const first = accounts[0];
	const ids = useMemo(() => accounts.map((a) => a.id), [accounts]);

	// What the rows loaded, as a primitive: the sum, and the threshold of each network.
	const summary = useCacheStore((s) =>
		accounts
			.map((a) => {
				const data = s.entries[accountCacheKey(a)]?.data as SafeAccountData | undefined;
				return data ? `${a.hidden ? 0 : data.totalUsd}:${data.threshold}/${data.owners.length}` : "";
			})
			.join("|"),
	);
	const known = summary.split("|").filter((v) => v !== "");
	const total = known.length > 0 ? known.reduce((sum, v) => sum + Number(v.split(":")[0]), 0) : undefined;
	const modes = [...new Set(known.map((v) => v.split(":")[1]))];
	// One threshold everywhere is said once, in the header; different ones, by every row.
	const [m, count] = modes.length === 1 ? modes[0].split("/").map(Number) : [];
	const allHidden = accounts.every((a) => a.hidden);

	return (
		<div className={`card-surface p-1.5 ${allHidden ? "opacity-50" : ""}`}>
			<div className="flex items-center gap-3 py-1 pr-0 pl-1.5">
				<AccountIcon kind="safe" env={first.env} size={44} />
				<div className="min-w-0 flex-1 leading-tight">
					<div className="mono truncate font-semibold">{shortAddress(first.address)}</div>
					<div className="text-base-content/60 truncate text-xs">
						{t("accounts.networks", { count: accounts.length })}
					</div>
					{m !== undefined && (
						<div className="mt-1">
							<span className="badge badge-ghost badge-xs text-base-content/70 whitespace-nowrap">
								{t("owners.keys", { m, count })}
							</span>
						</div>
					)}
				</div>
				<div className="flex shrink-0 flex-col items-end gap-0.5">
					<div className="tabular pr-1.5 font-semibold">
						{total !== undefined ? formatUsd(total, lang, true) : <span className="skeleton inline-block h-5 w-16" />}
					</div>
					<div className="flex">
						<CopyButton value={first.address} label={t("common.copyAddress")} />
						<IconButton label={t("common.showQr")} onClick={() => setQr(true)}>
							<QrCode className="size-4" />
						</IconButton>
					</div>
				</div>
			</div>
			<SortableList ids={ids} onReorder={onReorder} layout="rows">
				<ul className="border-base-300 rounded-field mt-1.5 overflow-hidden border">
					{accounts.map((account) => (
						<GroupRow key={account.id} account={account} editing={editing} showMode={modes.length > 1} />
					))}
				</ul>
			</SortableList>
			<QrDialog
				open={qr}
				onClose={() => setQr(false)}
				title={shortAddress(first.address)}
				value={addressQrValue(first.address)}
				copyValue={first.address}
				caption={<span className="mono text-sm break-all">{first.address}</span>}
			/>
		</div>
	);
};
