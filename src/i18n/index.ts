import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import type { Lang } from "./define";
import { DICTS } from "./dicts";

/**
 * Every feature module owns a dictionary in `./dict/*.ts` registered in `./dicts.ts`.
 * Keys are namespaced (`accounts.title`). Plurals: `key_one|few|many|other` + `{count}` variable.
 */
const merged: Record<Lang, Record<string, string>> = { en: {}, ru: {} };
for (const mod of DICTS) {
	Object.assign(merged.en, mod.en);
	Object.assign(merged.ru, mod.ru);
}

export type TVars = Record<string, string | number | undefined>;
export type TFunc = (key: string, vars?: TVars) => string;

const pluralRules: Record<Lang, Intl.PluralRules> = {
	en: new Intl.PluralRules("en"),
	ru: new Intl.PluralRules("ru"),
};

export const translate = (lang: Lang, key: string, vars?: TVars): string => {
	const dict = merged[lang];
	let template: string | undefined;
	if (vars && typeof vars.count === "number") {
		template = dict[`${key}_${pluralRules[lang].select(vars.count)}`] ?? dict[`${key}_other`];
	}
	template ??= dict[key] ?? merged.en[key];
	if (template === undefined) return key;
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (m, name: string) => (vars[name] === undefined ? m : String(vars[name])));
};

export const resolveLang = (setting: "system" | Lang): Lang => {
	if (setting !== "system") return setting;
	const langs = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
	return langs.some((l) => l.toLowerCase().startsWith("ru")) ? "ru" : "en";
};

export const useLang = (): Lang => {
	const setting = useAppStore((s) => s.settings.lang);
	return useMemo(() => resolveLang(setting), [setting]);
};

export const useT = (): TFunc => {
	const lang = useLang();
	return useMemo<TFunc>(() => (key, vars) => translate(lang, key, vars), [lang]);
};

/** For non-React code (toasts from async flows). */
export const tNow: TFunc = (key, vars) => translate(resolveLang(useAppStore.getState().settings.lang), key, vars);

export const allDictionaries = merged;
export type { Lang } from "./define";
