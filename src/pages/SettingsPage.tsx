import { useState } from "react";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { RpcSettings } from "@/components/settings/RpcSettings";
import { TokenListSettingsSection } from "@/components/tokens/TokenListSettingsSection";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingRow } from "@/components/ui/SettingRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { UpdateSettingsSection } from "@/components/update/UpdateSettingsSection";
import { useT } from "@/i18n";
import { useAppStore } from "@/store/appStore";

export const SettingsPage: React.FC = () => {
	const t = useT();
	const settings = useAppStore((s) => s.settings);
	const update = useAppStore((s) => s.updateSettings);
	const [showRpc, setShowRpc] = useState(false);

	return (
		<>
			<PageHeader title={t("nav.settings")} />
			<SettingsSection title={t("settings.appearance")}>
				<AppearanceSettings />
			</SettingsSection>

			<SettingsSection title={t("settings.network")}>
				<SettingRow
					label={t("settings.mev")}
					hint={t("settings.mevHint")}
					control={
						<input
							type="checkbox"
							className="toggle toggle-primary"
							checked={settings.mevProtection}
							onChange={(e) => update({ mevProtection: e.target.checked })}
							aria-label={t("settings.mev")}
						/>
					}
				/>
				<SettingRow
					label={t("settings.clearSigning")}
					hint={t("settings.clearSigningHint")}
					control={
						<input
							type="checkbox"
							className="toggle toggle-primary"
							checked={settings.clearSigning}
							onChange={(e) => update({ clearSigning: e.target.checked })}
							aria-label={t("settings.clearSigning")}
						/>
					}
				/>
				<SettingRow
					label={t("settings.deepLinks")}
					hint={t("settings.deepLinksHint")}
					control={
						<input
							type="checkbox"
							className="toggle toggle-primary"
							checked={settings.deepLinks}
							onChange={(e) => update({ deepLinks: e.target.checked })}
							aria-label={t("settings.deepLinks")}
						/>
					}
				/>
				<SettingRow
					label={t("settings.rpc")}
					control={
						<button type="button" className="btn btn-sm" onClick={() => setShowRpc((v) => !v)} aria-expanded={showRpc}>
							{t(showRpc ? "common.hide" : "common.edit")}
						</button>
					}
				>
					{showRpc && <RpcSettings />}
				</SettingRow>
			</SettingsSection>

			<TokenListSettingsSection />
			<UpdateSettingsSection />

			<p className="text-base-content/50 px-1 text-xs">{t("settings.privacy")}</p>
		</>
	);
};
