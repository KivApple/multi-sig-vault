/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
  /** Developer Safe that signs releases (optional, build-time). */
  readonly PUBLIC_RELEASE_SAFE?: string;
  /** Chain id of the developer Safe (optional, build-time). */
  readonly PUBLIC_RELEASE_CHAIN_ID?: string;
  readonly PUBLIC_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv & { MODE: string; DEV: boolean; PROD: boolean };
}
