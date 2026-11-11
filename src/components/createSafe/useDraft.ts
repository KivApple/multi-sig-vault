import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@/store/appStore";
import type { SafeCreation } from "@/types/domain";

export type CreateMode = "new" | "copy" | "vanity";

/** Everything the user typed on the Create Safe page that does not fit into the URL. */
export interface CreateSafeDraft {
	name: string;
	owners: string[];
	threshold: number;
	/** Decimal string. */
	saltNonce: string;
	/** Account id of the Safe whose address is being reproduced. */
	sourceId?: string;
	/** Creation parameters resolved for `sourceId`. */
	sourceCreation?: SafeCreation;
	prefix: string;
	minerOutput: string;
}

const KEY = "msv:create-safe";

const load = (): CreateSafeDraft | undefined => {
	try {
		const raw = sessionStorage.getItem(KEY);
		const parsed = raw ? (JSON.parse(raw) as Partial<CreateSafeDraft>) : undefined;
		if (!parsed || !Array.isArray(parsed.owners) || typeof parsed.saltNonce !== "string") return undefined;
		return {
			name: String(parsed.name ?? ""),
			owners: parsed.owners.map(String),
			threshold: Number(parsed.threshold) || 1,
			saltNonce: /^\d+$/.test(parsed.saltNonce) ? parsed.saltNonce : "0",
			sourceId: parsed.sourceId,
			sourceCreation: parsed.sourceCreation,
			prefix: String(parsed.prefix ?? ""),
			minerOutput: String(parsed.minerOutput ?? ""),
		};
	} catch {
		return undefined;
	}
};

export const clearDraft = (): void => {
	try {
		sessionStorage.removeItem(KEY);
	} catch {
		// Storage unavailable – nothing to clear.
	}
};

/** Draft persisted in sessionStorage; starts with all known signers and a majority threshold. */
export const useDraft = (newSalt: () => string): [CreateSafeDraft, (patch: Partial<CreateSafeDraft>) => void] => {
	const [draft, setDraft] = useState<CreateSafeDraft>(() => {
		const saved = load();
		if (saved) return saved;
		const owners = useAppStore
			.getState()
			.signers.slice(0, 10)
			.map((s) => s.address as string);
		return {
			name: "",
			owners: owners.length > 0 ? owners : [""],
			threshold: owners.length > 1 ? Math.floor(owners.length / 2) + 1 : 1,
			saltNonce: newSalt(),
			prefix: "",
			minerOutput: "",
		};
	});

	useEffect(() => {
		try {
			sessionStorage.setItem(KEY, JSON.stringify(draft));
		} catch {
			// Private mode / quota – the draft just won't survive a reload.
		}
	}, [draft]);

	const patch = useCallback((changes: Partial<CreateSafeDraft>) => setDraft((d) => ({ ...d, ...changes })), []);
	return [draft, patch];
};
