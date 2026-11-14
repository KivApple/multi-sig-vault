import { History, Pencil, QrCode, RefreshCw, Settings } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { AccountSettingsDialog } from "@/components/accounts/AccountSettingsDialog";
import { AssetsCard } from "@/components/accounts/AssetsCard";
import { multiSigLabel } from "@/components/accounts/multiSigLabel";
import { SignersCard } from "@/components/accounts/SignersCard";
import { Notice } from "@/components/common/Notice";
import { RenameDialog } from "@/components/common/RenameDialog";
import { AccountIcon } from "@/components/icons/AccountIcon";
import { OperationsSection } from "@/components/ops/OperationsSection";
import { QrDialog } from "@/components/qr/QrDialog";
import { CopyButton } from "@/components/ui/CopyButton";
import { IconButton } from "@/components/ui/IconButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { useOpEnv } from "@/hooks/useAccountData";
import { useLang, useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { formatRelative, formatSignedUsd, formatUsd, shortAddress } from "@/lib/format";
import { accountNetworkName } from "@/lib/known";
import { ownerSetOf } from "@/lib/ops/engine";
import { addressQrValue } from "@/lib/qr/address";
import { useAppStore } from "@/store/appStore";

/** Account details: balance, assets, signers and operations. */
export const AccountPage: React.FC = () => {
	const t = useT();
	const lang = useLang();
	const { id } = useParams();
	const ready = useAppStore((s) => s.ready);
	const account = useAppStore((s) => s.accounts.find((a) => a.id === id));
	const { env, data, refresh } = useOpEnv(account);
	const [renaming, setRenaming] = useState(false);
	const [qr, setQr] = useState(false);
	const [settings, setSettings] = useState(false);

	const handleRename = useCallback(
		(name: string) => {
			if (account) useAppStore.getState().updateAccount(account.id, { name: name || undefined });
		},
		[account],
	);
	const owners = useMemo(() => (env ? ownerSetOf(env) : undefined), [env]);

	if (!account || !env) return ready ? <Navigate to="/" replace /> : null;

	const title = account.name?.trim() || shortAddress(account.address);
	const scope = account.kind === "safe" ? { chainId: account.chainId as number } : { hlEnv: account.env };
	const mode = multiSigLabel(account, data.data, t);
	// Exchange accounts: part of the balance may be held by open orders or as margin.
	const availableUsd = (data.data as { availableUsd?: number } | undefined)?.availableUsd;
	const held = !!data.data && availableUsd !== undefined && data.data.totalUsd - availableUsd > 0.01;
	// Exchange accounts with open positions: their unrealised result together.
	const hl = env.hl;
	const pnl = hl && hl.positions.length > 0 && Number.isFinite(hl.unrealizedPnl) ? hl.unrealizedPnl : undefined;

	return (
		<>
			<PageHeader
				back="/"
				title={
					<span className="flex min-w-0 items-center gap-3">
						<AccountIcon kind={account.kind} env={account.env} chainId={account.chainId} size={36} />
						<span className="min-w-0 truncate">{title}</span>
					</span>
				}
				actions={
					<>
						<IconButton label={t("common.rename")} onClick={() => setRenaming(true)}>
							<Pencil className="size-4" />
						</IconButton>
						{account.kind === "safe" && (
							<IconButton label={t("accounts.settings")} onClick={() => setSettings(true)}>
								<Settings className="size-4" />
							</IconButton>
						)}
					</>
				}
			/>

			<div className="flex flex-col gap-4">
				<section className="card-surface p-4">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<div className="tabular text-3xl font-bold tracking-tight">
								{data.data ? formatUsd(data.data.totalUsd, lang) : <span className="skeleton inline-block h-8 w-36" />}
							</div>
							{pnl !== undefined && (
								<div className="text-base-content/60 tabular mt-0.5 text-sm">
									{t("accounts.unrealizedPnl")}{" "}
									<span className={pnl >= 0 ? "text-success" : "text-error"}>{formatSignedUsd(pnl, lang)}</span>
								</div>
							)}
							{held && (
								<div className="text-warning tabular mt-0.5 text-sm">
									{t("accounts.availableUsd", { amount: formatUsd(availableUsd as number, lang) })}
								</div>
							)}
							<div className="text-base-content/60 mt-1 text-xs">
								{accountNetworkName(account)}
								{data.updatedAt && ` · ${t("common.updatedAt", { when: formatRelative(data.updatedAt, lang) })}`}
							</div>
						</div>
						<button
							type="button"
							className="btn btn-ghost btn-sm btn-square"
							onClick={() => void refresh()}
							disabled={data.loading}
							aria-label={t("common.refresh")}
							title={t("common.refresh")}
						>
							{data.loading ? <Spinner /> : <RefreshCw className="size-4" />}
						</button>
					</div>
					<div className="bg-base-200 rounded-field mt-3 flex items-center gap-1 py-1 pr-1 pl-3">
						<span className="mono min-w-0 flex-1 text-xs break-all sm:text-sm">{account.address}</span>
						<CopyButton value={account.address} label={t("common.copyAddress")} />
						<IconButton label={t("common.showQr")} onClick={() => setQr(true)}>
							<QrCode className="size-4" />
						</IconButton>
					</div>
				</section>

				{data.error !== undefined && (
					<Notice tone={data.data ? "warning" : "error"}>
						{data.data ? t("accounts.staleData") : describeError(data.error, t)}
					</Notice>
				)}

				{data.data && <AssetsCard account={account} assets={data.data.assets} />}
				{owners && mode && <SignersCard mode={mode} owners={owners.owners} scope={scope} />}

				<OperationsSection env={env} />
				<Link className="btn btn-ghost btn-sm self-center" to={`/account/${encodeURIComponent(account.id)}/history`}>
					<History className="size-4" />
					{t("history.open")}
				</Link>
			</div>

			<RenameDialog
				open={renaming}
				onClose={() => setRenaming(false)}
				title={t("accounts.rename")}
				initial={account.name ?? ""}
				allowEmpty
				onSave={handleRename}
			/>
			{account.kind === "safe" && (
				<AccountSettingsDialog open={settings} onClose={() => setSettings(false)} account={account} />
			)}
			<QrDialog
				open={qr}
				onClose={() => setQr(false)}
				title={title}
				value={addressQrValue(account.address, account.chainId)}
				copyValue={account.address}
				caption={<span className="mono text-sm break-all">{account.address}</span>}
			/>
		</>
	);
};
