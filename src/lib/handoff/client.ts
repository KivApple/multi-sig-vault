import { create } from "zustand";
import { WalletError } from "@/lib/errors";
import { useUpdateStore } from "@/lib/update/store";
import {
	formatLinkToken,
	newCode,
	newKey,
	newSessionId,
	open,
	pairingKey,
	seal,
	sessionKey,
	toBase64Url,
} from "./crypto";
import { loadAppPairKey, saveAppPairKey } from "./pairing";
import { parseResult, type HandoffRequest, type HandoffResponse } from "./protocol";

/**
 * The requesting side of a hand-off: this page cannot reach MetaMask reliably (Chrome on a phone), so it
 * leaves an encrypted request on the relay, lets the user open the signing page inside MetaMask's own
 * browser and waits for the encrypted answer. See relay/server.mjs and ./crypto.ts.
 */

const relayUrl = (path: string): string => new URL(`relay/${path}`, document.baseURI).href;

/** How long the signing page may take. The relay keeps a session for 10 minutes. */
const SESSION_MS = 9 * 60_000;
const POLL_WAIT_S = 20;

let available: Promise<boolean> | undefined;

/** The relay is optional: a copy of the app hosted without it falls back to the MetaMask SDK. */
export const relayAvailable = (): Promise<boolean> => {
	available ??= fetch(relayUrl("health"), { cache: "no-store", signal: AbortSignal.timeout(4000) })
		.then((res) => res.ok)
		.catch(() => false)
		.then((ok) => {
			if (!ok) available = undefined;
			return ok;
		});
	return available;
};

export interface PendingHandoff {
	method: HandoffRequest["method"];
	/** Link that opens the signing page in MetaMask's browser. */
	href: string;
	/** First connection only: the code the user types into the signing page. */
	code?: string;
	cancel: () => void;
	/** Paired sessions only: MetaMask's browser no longer knows this app – start over with a new pairing. */
	repair?: () => void;
}

interface HandoffState {
	pending?: PendingHandoff;
}

/** The hand-off the user is being asked to continue in MetaMask, if any (shown by HandoffDialog). */
export const useHandoffStore = create<HandoffState>(() => ({}));

export const signPageLink = (token: string): string => {
	const { host, pathname } = window.location;
	return `https://link.metamask.io/dapp/${host}${pathname}#/sign/${token}`;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Outcome = { kind: "result"; value: unknown } | { kind: "repair" };

const attempt = async (
	request: HandoffRequest,
	forcePairing: boolean,
	onExpire: () => WalletError,
): Promise<Outcome> => {
	const id = newSessionId();
	const known = forcePairing ? undefined : await loadAppPairKey();
	const pairKey = known ?? newKey();
	const answerKey = await sessionKey(pairKey, id);

	// The signing page is another installed copy of this app and may be older. Tell it which release the
	// user is running here, so that it can bring itself to the same one before asking the wallet.
	const { currentId, currentVersion } = useUpdateStore.getState();
	const release = currentId ? { id: currentId, version: currentVersion } : undefined;

	let body: Uint8Array<ArrayBuffer>;
	let token: string;
	let code: string | undefined;
	if (known) {
		body = await seal(answerKey, id, "req", { request, release });
		token = formatLinkToken({ id });
	} else {
		const linkKey = newKey();
		code = newCode();
		body = await seal(await pairingKey(linkKey, code, id), id, "req", {
			pairKey: toBase64Url(pairKey),
			request,
			release,
		});
		token = formatLinkToken({ id, linkKey });
	}

	let put: Response;
	try {
		put = await fetch(relayUrl(`v1/${id}/req`), { method: "PUT", body });
	} catch (e) {
		throw new WalletError("unavailable", (e as Error).message);
	}
	if (!put.ok) throw new WalletError("unavailable", `relay: HTTP ${put.status}`);

	let stop: "cancel" | "repair" | undefined;
	let poll: AbortController | undefined;
	const end = (reason: "cancel" | "repair") => (): void => {
		stop = reason;
		poll?.abort();
	};
	// Android freezes this tab while MetaMask is in front, and the connection of a poll that was in flight
	// is dead afterwards without the request ever failing. So a poll never outlives its own deadline, and
	// coming back to the tab drops it and asks again on a fresh connection.
	const refresh = (): void => {
		if (document.visibilityState === "visible") poll?.abort();
	};
	document.addEventListener("visibilitychange", refresh);
	window.addEventListener("pageshow", refresh);
	window.addEventListener("focus", refresh);
	window.addEventListener("online", refresh);
	useHandoffStore.setState({
		pending: {
			method: request.method,
			href: signPageLink(token),
			code,
			cancel: end("cancel"),
			repair: known ? end("repair") : undefined,
		},
	});
	try {
		const deadline = Date.now() + SESSION_MS;
		while (Date.now() < deadline) {
			if (stop === "repair") return { kind: "repair" };
			if (stop === "cancel") throw new WalletError("rejected");
			let res: Response | undefined;
			const current = new AbortController();
			poll = current;
			const overdue = setTimeout(() => current.abort(), (POLL_WAIT_S + 8) * 1000);
			try {
				res = await fetch(relayUrl(`v1/${id}/res?wait=${POLL_WAIT_S}`), { cache: "no-store", signal: current.signal });
			} catch {
				// Dropped on purpose (see `refresh`) – ask again at once; a real network error – after a pause.
				if (!stop && !current.signal.aborted) await sleep(1500);
				continue;
			} finally {
				clearTimeout(overdue);
			}
			if (!res.ok) {
				await sleep(res.status === 404 ? 300 : 1500);
				continue;
			}
			let answer: HandoffResponse;
			try {
				answer = (await open(answerKey, id, "res", new Uint8Array(await res.arrayBuffer()))) as HandoffResponse;
			} catch {
				// Not written with our key: the relay (or someone in between) changed it.
				throw new WalletError("unknown", "The answer failed authentication");
			}
			// Any authentic answer proves the signing page now holds the pair key.
			if (!known) await saveAppPairKey(pairKey);
			if (!answer || answer.ok !== true) throw new WalletError(answer?.code ?? "unknown", answer?.detail);
			const value = parseResult(request, answer.result);
			if (value === undefined) throw new WalletError("unknown", "Unexpected answer");
			return { kind: "result", value };
		}
		throw onExpire();
	} finally {
		document.removeEventListener("visibilitychange", refresh);
		window.removeEventListener("pageshow", refresh);
		window.removeEventListener("focus", refresh);
		window.removeEventListener("online", refresh);
		useHandoffStore.setState({ pending: undefined });
	}
};

/** Runs `request` in MetaMask's browser and returns its checked result. */
export const requestInMetaMaskBrowser = async (
	request: HandoffRequest,
	onExpire: () => WalletError = () => new WalletError("timeout"),
): Promise<unknown> => {
	let outcome = await attempt(request, false, onExpire);
	if (outcome.kind === "repair") outcome = await attempt(request, true, onExpire);
	if (outcome.kind === "repair") throw new WalletError("rejected");
	return outcome.value;
};

/** The signing side: fetch the request left for this session. */
export const fetchHandoffRequest = async (id: string): Promise<Uint8Array<ArrayBuffer> | undefined> => {
	const res = await fetch(relayUrl(`v1/${id}/req`), { cache: "no-store" });
	if (res.status === 404) return undefined;
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
};

/** The signing side: leave the answer. `false` – the session already has one or has expired. */
export const putHandoffResponse = async (id: string, body: Uint8Array<ArrayBuffer>): Promise<boolean> => {
	const res = await fetch(relayUrl(`v1/${id}/res`), { method: "PUT", body });
	return res.ok;
};
