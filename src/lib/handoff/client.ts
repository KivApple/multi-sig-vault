import { create } from "zustand";
import { WalletError } from "@/lib/errors";
import { formatToken, newToken, open, seal, sessionCode } from "./crypto";
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
	code: string;
	cancel: () => void;
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

/** Runs `request` in MetaMask's browser and returns its checked result. */
export const requestInMetaMaskBrowser = async (
	request: HandoffRequest,
	onExpire: () => WalletError = () => new WalletError("timeout"),
): Promise<unknown> => {
	const token = newToken();
	let put: Response;
	try {
		put = await fetch(relayUrl(`v1/${token.id}/req`), { method: "PUT", body: await seal(token, "req", request) });
	} catch (e) {
		throw new WalletError("unavailable", (e as Error).message);
	}
	if (!put.ok) throw new WalletError("unavailable", `relay: HTTP ${put.status}`);

	let cancelled = false;
	const abort = new AbortController();
	const cancel = (): void => {
		cancelled = true;
		abort.abort();
	};
	useHandoffStore.setState({
		pending: { method: request.method, href: signPageLink(formatToken(token)), code: await sessionCode(token), cancel },
	});
	try {
		const deadline = Date.now() + SESSION_MS;
		while (Date.now() < deadline) {
			if (cancelled) throw new WalletError("rejected");
			let res: Response | undefined;
			try {
				// Android freezes this tab while MetaMask is in front; the loop simply resumes afterwards.
				res = await fetch(relayUrl(`v1/${token.id}/res?wait=${POLL_WAIT_S}`), {
					cache: "no-store",
					signal: abort.signal,
				});
			} catch {
				if (!cancelled) await sleep(1500);
				continue;
			}
			if (res.status === 404) {
				await sleep(300);
				continue;
			}
			if (!res.ok) {
				await sleep(1500);
				continue;
			}
			let answer: HandoffResponse;
			try {
				answer = (await open(token, "res", new Uint8Array(await res.arrayBuffer()))) as HandoffResponse;
			} catch {
				// Not written with our key: the relay (or someone in between) changed it.
				throw new WalletError("unknown", "The answer failed authentication");
			}
			if (!answer || answer.ok !== true) {
				throw new WalletError(answer?.code ?? "unknown", answer?.detail);
			}
			const result = parseResult(request, answer.result);
			if (result === undefined) throw new WalletError("unknown", "Unexpected answer");
			return result;
		}
		throw onExpire();
	} finally {
		useHandoffStore.setState({ pending: undefined });
	}
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
