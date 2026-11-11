import { useCallback, useState } from "react";
import { RpcSettings } from "@/components/settings/RpcSettings";
import { TokenListSettingsSection } from "@/components/tokens/TokenListSettingsSection";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { SettingRow } from "@/components/ui/SettingRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { UpdateSettingsSection } from "@/components/update/UpdateSettingsSection";
import { useT } from "@/i18n";
import { useAppStore } from "@/store/appStore";
import type { LangSetting, ThemeSetting } from "@/types/domain";

export const SettingsPage: React.FC = () => {
	const t = useT();
	const settings = useAppStore((s) => s.settings);
	const update = useAppStore((s) => s.updateSettings);
	const [showRpc, setShowRpc] = useState(false);
	const setTheme = useCallback((theme: ThemeSetting) => update({ theme }), [update]);
	const setLang = useCallback((lang: LangSetting) => update({ lang }), [update]);

	return (
		<>
			<PageHeader title={t("nav.settings")} />
			<SettingsSection title={t("settings.appearance")}>
				<SettingRow label={t("settings.theme")}>
					<Segmented<ThemeSetting>
						value={settings.theme}
						size="sm"
						options={[
							{ value: "system", label: t("settings.system") },
							{ value: "light", label: t("settings.light") },
							{ value: "dark", label: t("settings.dark") },
						]}
						onChange={setTheme}
						ariaLabel={t("settings.theme")}
					/>
				</SettingRow>
				<SettingRow label={t("settings.language")}>
					<Segmented<LangSetting>
						value={settings.lang}
						size="sm"
						options={[
							{ value: "system", label: t("settings.system") },
							{ value: "en", label: "English" },
							{ value: "ru", label: "Русский" },
						]}
						onChange={setLang}
						ariaLabel={t("settings.language")}
					/>
				</SettingRow>
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
