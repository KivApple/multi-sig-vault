import { APP_VERSION } from "@/config/constants";
import { errorText } from "@/lib/errors";
import { useAppStore } from "@/store/appStore";
import { sha256Hex, verifyManifest, type ReleaseFile, type ReleaseManifest } from "./releaseCore.mjs";
import { useUpdateStore, type UpdateState, type VerificationStatus } from "./store";
import { RELEASE_SIGNER, verifyRelease } from "./verify";

/**
 * Application-level updater.
 *
 * The service worker (public/sw.js) only serves the ACTIVE release from the Cache API.
 * This module – i.e. the code of the release the user already runs and trusts – finds a new
 * release, checks the developer multi-sig approval (optional), downloads every file with
 * SHA-256 verification into a separate cache and waits. Only `applyUpdate()`, called from an
 * explicit user action, switches the active pointer and reloads.
 */
const META_CACHE = "msv-meta";
const RELEASE_PREFIX = "msv-release-";
const BASE = typeof location === "undefined" ? "" : new URL("./", location.href).href;
const ACTIVE_URL = `${BASE}__msv/active`;
const PENDING_URL = `${BASE}__msv/pending`;
const LAST_CHECK_KEY = "msv-update-checked";
const CHECK_INTERVAL_MS = 30 * 60_000;
const RETRY_VERIFY_MS = 2 * 60_000;

interface ActivePointer {
	id: string;
	version: string;
}

interface PendingRecord {
	manifest: ReleaseManifest;
	verification: VerificationStatus;
}

const set = (patch: Partial<UpdateState>): void => useUpdateStore.setState(patch);

const supported = (): boolean =>
	import.meta.env.PROD &&
	typeof navigator !== "undefined" &&
	"serviceWorker" in navigator &&
	typeof caches !== "undefined" &&
	window.isSecureContext;

const readMeta = async <T>(url: string): Promise<T | undefined> => {
	const res = await (await caches.open(META_CACHE)).match(url);
	if (!res) return undefined;
	try {
		return (await res.json()) as T;
	} catch {
		return undefined;
	}
};

const writeMeta = async (url: string, value: unknown): Promise<void> => {
	await (await caches.open(META_CACHE)).put(
		url,
		new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }),
	);
};

const deleteMeta = async (url: string): Promise<void> => {
	await (await caches.open(META_CACHE)).delete(url);
};

const fileUrl = (path: string): string => new URL(path, BASE).href;

const readVerified = async (cache: Cache, file: ReleaseFile): Promise<Response | undefined> => {
	const hit = await cache.match(fileUrl(file.path));
	if (!hit) return undefined;
	const body = await hit.clone().arrayBuffer();
	return (await sha256Hex(body)) === file.sha256 ? hit : undefined;
};

const isComplete = async (manifest: ReleaseManifest): Promise<boolean> => {
	if (!(await caches.has(RELEASE_PREFIX + manifest.id))) return false;
	const cache = await caches.open(RELEASE_PREFIX + manifest.id);
	for (const file of manifest.files) {
		if (!(await readVerified(cache, file))) return false;
	}
	return true;
};

/**
 * Fills the cache of `manifest` with verified files. Files already present (resumed download)
 * or identical in the active release are reused – only changed bytes travel over the network.
 */
const downloadRelease = async (
	manifest: ReleaseManifest,
	reuseFromId: string | undefined,
	onProgress: (fraction: number) => void,
): Promise<void> => {
	const target = await caches.open(RELEASE_PREFIX + manifest.id);
	const source =
		reuseFromId && reuseFromId !== manifest.id && (await caches.has(RELEASE_PREFIX + reuseFromId))
			? await caches.open(RELEASE_PREFIX + reuseFromId)
			: undefined;
	const total = manifest.files.reduce((sum, f) => sum + f.size, 0) || 1;
	let done = 0;
	const queue = [...manifest.files];

	const worker = async (): Promise<void> => {
		for (let file = queue.shift(); file; file = queue.shift()) {
			const url = fileUrl(file.path);
			if (!(await readVerified(target, file))) {
				const reused = source ? await readVerified(source, file) : undefined;
				if (reused) {
					await target.put(url, reused);
				} else {
					const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
					if (!res.ok) throw new Error(`HTTP ${res.status}: ${file.path}`);
					const body = await res.arrayBuffer();
					if ((await sha256Hex(body)) !== file.sha256) throw new Error(`update.error.integrity`);
					const headers: Record<string, string> = { "Content-Length": String(body.byteLength) };
					const type = res.headers.get("Content-Type");
					if (type) headers["Content-Type"] = type;
					await target.put(url, new Response(body, { status: 200, headers }));
				}
			}
			done += file.size;
			onProgress(Math.min(1, done / total));
		}
	};
	await Promise.all([worker(), worker(), worker(), worker()]);
};

const fetchManifest = async (): Promise<ReleaseManifest> => {
	const res = await fetch(`${BASE}release.json`, { cache: "no-store", credentials: "same-origin" });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return verifyManifest(await res.json());
};

const deleteReleaseCaches = async (keep: (string | undefined)[]): Promise<void> => {
	const names = await caches.keys();
	await Promise.all(
		names
			.filter((n) => n.startsWith(RELEASE_PREFIX) && !keep.includes(n.slice(RELEASE_PREFIX.length)))
			.map((n) => caches.delete(n)),
	);
};

/** Tells the worker to forget its in-memory pointer and waits for the acknowledgement. */
const notifyWorker = async (): Promise<void> => {
	const reg = await navigator.serviceWorker.getRegistration(BASE);
	const worker = navigator.serviceWorker.controller ?? reg?.active;
	if (!worker) return;
	await new Promise<void>((resolve) => {
		const channel = new MessageChannel();
		const timer = setTimeout(resolve, 1500);
		channel.port1.onmessage = () => {
			clearTimeout(timer);
			resolve();
		};
		worker.postMessage({ type: "msv-release-changed" }, [channel.port2]);
	});
};

type VerificationMode = "not-configured" | "disabled" | "enabled";

const verificationMode = (): VerificationMode => {
	if (!RELEASE_SIGNER) return "not-configured";
	return useAppStore.getState().settings.verifyUpdates ? "enabled" : "disabled";
};

const idleVerification = (): VerificationStatus => {
	const mode = verificationMode();
	return mode === "enabled" ? "pending" : mode;
};

/** A stored pending release may be offered only if it satisfies the CURRENT verification setting. */
const pendingAllowed = (rec: PendingRecord): boolean =>
	verificationMode() !== "enabled" || rec.verification === "verified";

const showIdle = (): void =>
	set({
		status: "idle",
		newId: undefined,
		newVersion: undefined,
		progress: undefined,
		error: undefined,
		verification: idleVerification(),
	});

/** State when nothing new could be learned (offline, server error): keep what is known. */
const restore = async (error?: string): Promise<void> => {
	const { currentId } = useUpdateStore.getState();
	const rec = await readMeta<PendingRecord>(PENDING_URL);
	if (rec && rec.manifest.id !== currentId && pendingAllowed(rec)) {
		set({
			status: "ready",
			newId: rec.manifest.id,
			newVersion: rec.manifest.version,
			verification: verificationMode() === "enabled" ? "verified" : idleVerification(),
			progress: undefined,
			error: undefined,
		});
		return;
	}
	if (error) set({ status: "error", error, progress: undefined });
	else showIdle();
};

let retryTimer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;

const doCheck = async (manual: boolean): Promise<void> => {
	if (!supported()) return;
	const { currentId, status: before } = useUpdateStore.getState();
	// A background re-check must not make an already offered update flicker.
	const quiet = !manual && before === "ready";
	if (!quiet) set({ status: "checking", error: undefined, progress: undefined });

	let manifest: ReleaseManifest;
	try {
		manifest = await fetchManifest();
	} catch (e) {
		// Being offline is the normal state of this app – never an error on automatic checks.
		const key = !navigator.onLine || e instanceof TypeError ? "update.error.offline" : errorText(e);
		await restore(manual ? key : undefined);
		return;
	}
	const lastCheckedAt = Date.now();
	localStorage.setItem(LAST_CHECK_KEY, String(lastCheckedAt));
	set({ lastCheckedAt });

	if (manifest.id === currentId) {
		await deleteMeta(PENDING_URL);
		await deleteReleaseCaches([currentId]);
		showIdle();
		return;
	}

	const known = await readMeta<PendingRecord>(PENDING_URL);
	if (known?.manifest.id === manifest.id && pendingAllowed(known) && (await isComplete(manifest))) {
		await restore();
		return;
	}

	const mode = verificationMode();
	let verification: VerificationStatus = mode === "enabled" ? "pending" : mode;
	if (mode === "enabled" && RELEASE_SIGNER) {
		if (known?.manifest.id === manifest.id && known.verification === "verified") {
			verification = "verified";
		} else {
			set({ status: "verifying", newId: manifest.id, newVersion: manifest.version, verification: "pending" });
			const outcome = await verifyRelease(manifest.id, RELEASE_SIGNER);
			if (outcome === "failed") {
				// Not approved by the developer multi-sig: nothing is downloaded, nothing is offered.
				set({ status: "unverified", verification: "failed" });
				return;
			}
			if (outcome === "pending") {
				set({ status: "idle", verification: "pending" });
				clearTimeout(retryTimer);
				retryTimer = setTimeout(() => void checkForUpdate(false), RETRY_VERIFY_MS);
				return;
			}
			verification = "verified";
		}
	}

	set({ status: "downloading", newId: manifest.id, newVersion: manifest.version, verification, progress: 0 });
	try {
		await downloadRelease(manifest, currentId, (progress) => set({ progress }));
	} catch (e) {
		await restore(manual ? (navigator.onLine ? errorText(e) : "update.error.offline") : undefined);
		return;
	}
	await writeMeta(PENDING_URL, { manifest, verification } satisfies PendingRecord);
	await deleteReleaseCaches([currentId, manifest.id]);
	set({ status: "ready", progress: undefined, error: undefined });
};

/** Looks for a new release. `manual` – started by the user, so failures are reported. */
export const checkForUpdate = (manual = true): Promise<void> => {
	running ??= doCheck(manual)
		.catch((e: unknown) => set({ status: "error", error: errorText(e), progress: undefined }))
		.finally(() => {
			running = null;
		});
	return running;
};

const broadcast = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("msv-update");

/** Activates the downloaded release and reloads. Call only from an explicit user action. */
export const applyUpdate = async (): Promise<void> => {
	if (running) await running;
	const rec = await readMeta<PendingRecord>(PENDING_URL);
	if (!rec || !pendingAllowed(rec)) {
		await checkForUpdate(true);
		return;
	}
	// Re-verify every byte right before switching: the cache may have been evicted or altered.
	if (!(await isComplete(rec.manifest))) {
		await caches.delete(RELEASE_PREFIX + rec.manifest.id);
		await deleteMeta(PENDING_URL);
		set({ status: "error", error: "update.error.integrity", progress: undefined });
		return;
	}
	const pointer: ActivePointer = { id: rec.manifest.id, version: rec.manifest.version };
	await writeMeta(ACTIVE_URL, pointer);
	await deleteMeta(PENDING_URL);
	await notifyWorker();
	await deleteReleaseCaches([pointer.id]);
	broadcast?.postMessage("applied");
	location.reload();
};

/**
 * Makes sure an active release exists and is intact. Normally the worker caches the first
 * release during its install; if the cache was evicted by the browser, the release currently
 * on the server becomes the active one (the page itself was just loaded from there anyway).
 */
const ensureActive = async (): Promise<ActivePointer | undefined> => {
	const ready = await Promise.race([
		navigator.serviceWorker.ready.then(() => true),
		new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 90_000)),
	]);
	if (!ready) return undefined;
	const pointer = await readMeta<ActivePointer>(ACTIVE_URL);
	if (pointer && (await caches.has(RELEASE_PREFIX + pointer.id))) {
		const cache = await caches.open(RELEASE_PREFIX + pointer.id);
		if (await cache.match(fileUrl("index.html"))) return pointer;
	}
	try {
		const manifest = await fetchManifest();
		await downloadRelease(manifest, undefined, () => undefined);
		const healed: ActivePointer = { id: manifest.id, version: manifest.version };
		await writeMeta(ACTIVE_URL, healed);
		await notifyWorker();
		return healed;
	} catch {
		return undefined;
	}
};

/**
 * The browser itself re-fetches sw.js and installs it when its bytes differ – the web platform
 * gives a page no way to veto that. A changed worker stays in `waiting` while any tab of the app
 * is open (sw.js never calls skipWaiting over an existing release) and takes control afterwards.
 * We cannot gate it, so we keep sw.js stable across releases and tell the user when it happens.
 */
const watchWorker = (reg: ServiceWorkerRegistration): void => {
	const flag = (): void => {
		if (reg.waiting && navigator.serviceWorker.controller) set({ swUpdatePending: true });
	};
	flag();
	reg.addEventListener("updatefound", () => {
		const worker = reg.installing;
		worker?.addEventListener("statechange", () => {
			if (worker.state === "installed") flag();
		});
	});
};

let started = false;

/** Registers the service worker and starts periodic update checks (production builds only). */
export const initUpdates = async (): Promise<void> => {
	if (started) return;
	started = true;
	if (!supported()) {
		set({ status: "unsupported", verification: idleVerification() });
		return;
	}
	const stored = Number(localStorage.getItem(LAST_CHECK_KEY));
	set({ verification: idleVerification(), lastCheckedAt: stored > 0 ? stored : undefined });

	try {
		const reg = await navigator.serviceWorker.register(new URL("sw.js", BASE), {
			scope: BASE,
			updateViaCache: "none",
		});
		watchWorker(reg);
	} catch {
		set({ status: "unsupported" });
		return;
	}

	broadcast?.addEventListener("message", (e: MessageEvent) => {
		// Another tab activated a new release: this tab's lazy chunks no longer exist.
		if (e.data === "applied") location.reload();
	});

	const pointer = await ensureActive();
	if (!pointer) {
		set({ status: "unsupported" });
		return;
	}
	set({ currentId: pointer.id, currentVersion: pointer.version || APP_VERSION });
	await restore();

	const maybeCheck = (): void => {
		if (document.visibilityState !== "visible" || !navigator.onLine) return;
		const last = useUpdateStore.getState().lastCheckedAt ?? 0;
		if (Date.now() - last >= CHECK_INTERVAL_MS) void checkForUpdate(false);
	};
	void checkForUpdate(false);
	setInterval(maybeCheck, 5 * 60_000);
	document.addEventListener("visibilitychange", maybeCheck);
	window.addEventListener("online", () => void checkForUpdate(false));

	// Turning verification on/off changes whether a found release may be offered.
	useAppStore.subscribe((state, prev) => {
		if (state.settings.verifyUpdates !== prev.settings.verifyUpdates) void checkForUpdate(false);
	});
};
