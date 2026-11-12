import { APP_VERSION } from "@/config/constants";
import { errorText } from "@/lib/errors";
import { useAppStore } from "@/store/appStore";
import {
	compareVersions,
	parseReleaseList,
	sha256Hex,
	verifyManifest,
	type ReleaseEntry,
	type ReleaseFile,
	type ReleaseManifest,
} from "./releaseCore.mjs";
import { useUpdateStore, type UpdateState, type VerificationStatus } from "./store";
import { RELEASE_SIGNER, verifyRelease } from "./verify";

/**
 * Application-level updater.
 *
 * The service worker (public/sw.js) only serves the ACTIVE release from the Cache API.
 * This module – i.e. the code of the release the user already runs and trusts – finds a new
 * release, downloads every file with SHA-256 verification into a separate cache and waits.
 * Only `applyUpdate()`, called from an explicit user action, switches the active pointer and reloads.
 *
 * Two channels share one server. Every published release stays at `releases/<id>/`, and
 * `releases.json` lists them newest first. With verification on (the default) the app takes the
 * newest release the developer Safe approved on-chain and never moves to a lower version; with
 * test versions allowed it takes the newest one, signed or not. Nothing has to change on the
 * server when a release gets signed: the chain says which one is the stable one.
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
	/** Where the files of this release are served from. */
	base: string,
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
					const res = await fetch(new URL(file.path, base), { cache: "no-store", credentials: "same-origin" });
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

const fetchManifest = async (base = BASE): Promise<ReleaseManifest> => {
	const res = await fetch(`${base}release.json`, { cache: "no-store", credentials: "same-origin" });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return verifyManifest(await res.json());
};

const releaseBase = (id: string): string => `${BASE}releases/${id}/`;

/** The manifest of one published release; its id must be the one asked for. */
const fetchReleaseManifest = async (id: string): Promise<ReleaseManifest> => {
	const manifest = await fetchManifest(releaseBase(id));
	if (manifest.id !== id) throw new Error("Release manifest: unexpected id");
	return manifest;
};

/** `undefined` – this host publishes no list (a plain copy of the build): only its root release exists. */
const fetchList = async (): Promise<ReleaseEntry[] | undefined> => {
	const res = await fetch(`${BASE}releases.json`, { cache: "no-store", credentials: "same-origin" });
	if (res.status === 404 || res.status === 403) return undefined;
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	try {
		return parseReleaseList(await res.json());
	} catch {
		// Not a list (a host that answers every path with its index page).
		return undefined;
	}
};

/** How many releases above the current one are looked at in one check. */
const MAX_CANDIDATES = 20;

type Search =
	| { kind: "none" }
	/** Something newer exists, but nothing the developer Safe approved. */
	| { kind: "unsigned"; id: string; version: string }
	/** The chain could not be asked. */
	| { kind: "retry" }
	| { kind: "found"; manifest: ReleaseManifest; base: string; verification: VerificationStatus };

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

/**
 * Picks the release to move to under the current setting. Throws when the server cannot be reached.
 * `known` – the release downloaded earlier; its recorded approval is not asked for again.
 */
const findRelease = async (
	currentId: string | undefined,
	known: PendingRecord | undefined,
	quiet: boolean,
): Promise<Search> => {
	const mode = verificationMode();
	const signer = mode === "enabled" ? RELEASE_SIGNER : undefined;
	const approved = async (id: string, version: string): Promise<"verified" | "failed" | "pending"> => {
		if (!signer) return "verified";
		if (known?.manifest.id === id && known.verification === "verified") return "verified";
		if (!quiet) set({ status: "verifying", newId: id, newVersion: version, verification: "pending" });
		return verifyRelease(id, signer);
	};
	const idle: VerificationStatus = mode === "enabled" ? "verified" : mode;

	const list = await fetchList();
	if (!list) {
		const manifest = await fetchManifest();
		if (manifest.id === currentId) return { kind: "none" };
		const outcome = await approved(manifest.id, manifest.version);
		if (outcome === "failed") return { kind: "unsigned", id: manifest.id, version: manifest.version };
		if (outcome === "pending") return { kind: "retry" };
		return { kind: "found", manifest, base: BASE, verification: idle };
	}

	// Everything listed above the running release is newer than it.
	const at = list.findIndex((e) => e.id === currentId);
	const newer = (at < 0 ? list : list.slice(0, at)).slice(0, MAX_CANDIDATES);
	if (newer.length === 0) return { kind: "none" };
	if (!signer) {
		const manifest = await fetchReleaseManifest(newer[0].id);
		return { kind: "found", manifest, base: releaseBase(manifest.id), verification: idle };
	}

	// An approved release is taken only upwards: the list is the server's word, and the server must
	// not be able to walk the app back to an old approved release with a known flaw.
	const { currentVersion } = useUpdateStore.getState();
	for (const entry of newer) {
		if (compareVersions(entry.version, currentVersion) <= 0) continue;
		const outcome = await approved(entry.id, entry.version);
		if (outcome === "pending") return { kind: "retry" };
		if (outcome === "failed") continue;
		const manifest = await fetchReleaseManifest(entry.id);
		// The version that counts is the one the approved id commits to, not the one the list claims.
		if (compareVersions(manifest.version, currentVersion) <= 0) continue;
		return { kind: "found", manifest, base: releaseBase(manifest.id), verification: "verified" };
	}
	return { kind: "unsigned", id: newer[0].id, version: newer[0].version };
};

let retryTimer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;

const doCheck = async (manual: boolean): Promise<void> => {
	if (!supported()) return;
	const { currentId, status: before } = useUpdateStore.getState();
	// A background re-check must not make an already offered update flicker.
	const quiet = !manual && before === "ready";
	if (!quiet) set({ status: "checking", error: undefined, progress: undefined });

	const known = await readMeta<PendingRecord>(PENDING_URL);
	let found: Search;
	try {
		found = await findRelease(currentId, known, quiet);
	} catch (e) {
		// Being offline is the normal state of this app – never an error on automatic checks.
		const key = !navigator.onLine || e instanceof TypeError ? "update.error.offline" : errorText(e);
		await restore(manual ? key : undefined);
		return;
	}
	const lastCheckedAt = Date.now();
	localStorage.setItem(LAST_CHECK_KEY, String(lastCheckedAt));
	set({ lastCheckedAt });

	if (found.kind === "none") {
		await deleteMeta(PENDING_URL);
		await deleteReleaseCaches([currentId]);
		showIdle();
		return;
	}
	if (found.kind === "unsigned") {
		// Nothing is downloaded, nothing is offered; settings mention that a test version exists.
		set({ status: "unverified", newId: found.id, newVersion: found.version, verification: "failed" });
		return;
	}
	if (found.kind === "retry") {
		set({ status: "idle", verification: "pending" });
		clearTimeout(retryTimer);
		retryTimer = setTimeout(() => void checkForUpdate(false), RETRY_VERIFY_MS);
		return;
	}
	const { manifest, base, verification } = found;
	if (known?.manifest.id === manifest.id && pendingAllowed(known) && (await isComplete(manifest))) {
		await restore();
		return;
	}

	set({ status: "downloading", newId: manifest.id, newVersion: manifest.version, verification, progress: 0 });
	try {
		await downloadRelease(manifest, base, currentId, (progress) => set({ progress }));
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
		await downloadRelease(manifest, BASE, undefined, () => undefined);
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
