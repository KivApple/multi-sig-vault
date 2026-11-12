import { ExternalLink, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useCallback, useMemo, type ChangeEvent } from "react";
import { SettingRow } from "@/components/ui/SettingRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { findChain } from "@/config/chains";
import { SOURCE_URL } from "@/config/constants";
import { useLang, useT } from "@/i18n";
import { formatRelative, shortAddress } from "@/lib/format";
import { RELEASE_SIGNER, applyUpdate, checkForUpdate, useUpdate } from "@/lib/update";
import { useAppStore } from "@/store/appStore";

/** Settings block: installed version, manual update check and on-chain verification of releases. */
export const UpdateSettingsSection: React.FC = () => {
	const t = useT();
	const lang = useLang();
	const update = useUpdate();
	const verifyUpdates = useAppStore((s) => s.settings.verifyUpdates);
	const updateSettings = useAppStore((s) => s.updateSettings);

	const busy = update.status === "checking" || update.status === "verifying" || update.status === "downloading";
	const handleCheck = useCallback(() => void checkForUpdate(true), []);
	const handleApply = useCallback(() => void applyUpdate(), []);
	const handleToggle = useCallback(
		(e: ChangeEvent<HTMLInputElement>) => updateSettings({ verifyUpdates: !e.target.checked }),
		[updateSettings],
	);

	const statusText = useMemo(() => {
		switch (update.status) {
			case "checking":
				return t("update.status.checking");
			case "verifying":
				return t("update.status.verifying");
			case "downloading":
				return t("update.status.downloading", { percent: Math.round((update.progress ?? 0) * 100) });
			case "ready":
				return t("update.status.ready", { version: update.newVersion });
			case "unverified":
				return t("update.unverifiedTitle", { version: update.newVersion });
			case "error":
				return t(update.error ?? "error.network");
			case "unsupported":
				return t("update.status.unsupported");
			default:
				return update.lastCheckedAt
					? `${t("update.status.upToDate")} · ${t("update.lastChecked", { when: formatRelative(update.lastCheckedAt, lang) })}`
					: t("update.neverChecked");
		}
	}, [update.status, update.progress, update.newVersion, update.error, update.lastCheckedAt, t, lang]);

	const verificationLine = useMemo(() => {
		if (!RELEASE_SIGNER)
			return { tone: "text-base-content/60", Icon: ShieldQuestion, text: t("update.verify.notConfigured") };
		if (!update.newVersion || !verifyUpdates) return undefined;
		const vars = { version: update.newVersion };
		if (update.verification === "verified")
			return { tone: "text-success", Icon: ShieldCheck, text: t("update.verify.verified", vars) };
		if (update.verification === "failed")
			return { tone: "text-base-content/60", Icon: ShieldAlert, text: t("update.unverifiedText") };
		if (update.verification === "pending" && update.status === "idle") {
			return { tone: "text-base-content/60", Icon: ShieldQuestion, text: t("update.verify.pending", vars) };
		}
		return undefined;
	}, [update.newVersion, update.verification, update.status, verifyUpdates, t]);

	const signerChain = findChain(RELEASE_SIGNER?.chainId);

	return (
		<SettingsSection title={t("update.section")}>
			<SettingRow
				label={
					<>
						{t("update.version")} {update.currentVersion}
						{update.currentId && (
							<span className="mono text-base-content/50 ml-2 text-xs" title={update.currentId}>
								{update.currentId.slice(0, 12)}
							</span>
						)}
					</>
				}
				hint={<span className={update.status === "error" ? "text-warning" : ""}>{statusText}</span>}
				control={
					update.status === "ready" ? (
						<button type="button" className="btn btn-primary btn-sm" onClick={handleApply}>
							{t("update.install")}
						</button>
					) : (
						update.status !== "unsupported" && (
							<button
								type="button"
								className="btn btn-ghost btn-sm btn-square"
								onClick={handleCheck}
								disabled={busy}
								aria-label={t("update.check")}
								title={t("update.check")}
							>
								<RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
							</button>
						)
					)
				}
			>
				{update.status === "downloading" && (
					<progress className="progress progress-primary h-1.5 w-full" value={update.progress ?? 0} max={1} />
				)}
			</SettingRow>
			{RELEASE_SIGNER && (
				<SettingRow
					label={t("update.verify.label")}
					hint={t("update.verify.hint", {
						safe: shortAddress(RELEASE_SIGNER.safe),
						chain: signerChain?.name ?? RELEASE_SIGNER.chainId,
					})}
					control={
						<input
							type="checkbox"
							className="toggle toggle-primary"
							checked={!verifyUpdates}
							onChange={handleToggle}
							aria-label={t("update.verify.label")}
						/>
					}
				/>
			)}
			{verificationLine && (
				<div className={`flex items-center gap-2 px-4 py-3 text-xs ${verificationLine.tone}`}>
					<verificationLine.Icon className="size-4 shrink-0" />
					<span>{verificationLine.text}</span>
				</div>
			)}
			<SettingRow
				label={t("update.source")}
				hint={t("update.sourceHint")}
				control={
					<a
						className="btn btn-ghost btn-sm"
						href={SOURCE_URL}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={t("update.source")}
					>
						GitHub
						<ExternalLink className="size-4" />
					</a>
				}
			/>
		</SettingsSection>
	);
};
