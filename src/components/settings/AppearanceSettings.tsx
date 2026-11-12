import { useCallback } from "react";
import { Segmented } from "@/components/ui/Segmented";
import { SettingRow } from "@/components/ui/SettingRow";
import { useT } from "@/i18n";
import { useAppStore } from "@/store/appStore";
import type { LangSetting, ThemeSetting } from "@/types/domain";

/** Theme and language – the settings every page of the app has a use for. */
export const AppearanceSettings: React.FC = () => {
	const t = useT();
	const theme = useAppStore((s) => s.settings.theme);
	const lang = useAppStore((s) => s.settings.lang);
	const update = useAppStore((s) => s.updateSettings);
	const setTheme = useCallback((value: ThemeSetting) => update({ theme: value }), [update]);
	const setLang = useCallback((value: LangSetting) => update({ lang: value }), [update]);

	return (
		<>
			<SettingRow label={t("settings.theme")}>
				<Segmented<ThemeSetting>
					value={theme}
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
					value={lang}
					size="sm"
					options={[
						{ value: "system", label: t("settings.systemLang") },
						{ value: "en", label: "English" },
						{ value: "ru", label: "Русский" },
					]}
					onChange={setLang}
					ariaLabel={t("settings.language")}
				/>
			</SettingRow>
		</>
	);
};
