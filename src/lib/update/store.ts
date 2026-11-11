import { create } from "zustand";
import { APP_VERSION } from "@/config/constants";

export type UpdateStatus =
	| "idle"
	| "checking"
	| "verifying"
	| "downloading"
	| "ready"
	| "unverified"
	| "error"
	| "unsupported";

export type VerificationStatus = "disabled" | "not-configured" | "verified" | "failed" | "pending";

export interface UpdateState {
	status: UpdateStatus;
	currentVersion: string;
	/** Id of the release being served offline; undefined until the first release is cached. */
	currentId?: string;
	newVersion?: string;
	newId?: string;
	/** 0..1 while downloading. */
	progress?: number;
	/** i18n key (`update.error.*`) or a raw message. */
	error?: string;
	/** Verification of the NEW release (or the feature state when there is none). */
	verification: VerificationStatus;
	lastCheckedAt?: number;
	/** A changed `sw.js` is waiting; it takes over once every tab of the app is closed. */
	swUpdatePending: boolean;
}

export const useUpdateStore = create<UpdateState>()(() => ({
	status: "idle",
	currentVersion: APP_VERSION,
	verification: "not-configured",
	swUpdatePending: false,
}));

/** `const { status, newVersion } = useUpdate()` or with a selector. */
export const useUpdate = useUpdateStore;
