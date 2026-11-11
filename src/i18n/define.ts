export type Lang = 'en' | 'ru';

export interface ModuleDict {
  en: Record<string, string>;
  ru: Record<string, string>;
}

/** Declares a module dictionary; the compiler checks that `ru` has exactly the keys of `en`. */
export const defineDict = <T extends Record<string, string>>(dict: {
  en: T;
  /** Same keys as `en`; extra plural forms (`_few`, `_many`) are allowed. */
  ru: { [K in keyof T]: string } & Record<string, string>;
}): ModuleDict => dict;
