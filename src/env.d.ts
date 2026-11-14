/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
	/** Developer Safe that signs releases (optional, build-time). */
	readonly PUBLIC_RELEASE_SAFE?: string;
	/** Chain ids the developer Safe may sign on, comma-separated (optional, build-time). */
	readonly PUBLIC_RELEASE_CHAIN_ID?: string;
	readonly PUBLIC_APP_VERSION?: string;
	/** Optional credentials of the Across bridge API, set by the build from ACROSS_API_KEY and ACROSS_INTEGRATOR_ID. */
	readonly PUBLIC_ACROSS_API_KEY?: string;
	readonly PUBLIC_ACROSS_INTEGRATOR_ID?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv & { MODE: string; DEV: boolean; PROD: boolean };
}
