export type Lang = 'en' | 'ru';

export interface ModuleDict {
  en: Record<string, string>;
  ru: Record<string, string>;
}

/** Declares a module dictionary; the compiler checks that `ru` has exactly the keys of `en`. */
export const defineDict = <T extends Record<string, string>>(dict: {
  en: T;
  ru: Record<keyof T, string>;
}): ModuleDict => dict;
