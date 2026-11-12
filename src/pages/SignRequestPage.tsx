import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { Notice } from "@/components/common/Notice";
import { RequestView } from "@/components/handoff/RequestView";
import { AppLogo } from "@/components/icons/AppLogo";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { fetchHandoffRequest, putHandoffResponse } from "@/lib/handoff/client";
import { open, pairingKey, parseKey, parseLinkToken, seal, sessionKey } from "@/lib/handoff/crypto";
import { addPagePairKey, loadPagePairKeys } from "@/lib/handoff/pairing";
import { fromWireTx, parseRequest, type HandoffRequest, type HandoffResponse } from "@/lib/handoff/protocol";
import { hasInjectedMetaMask, metamaskDirect } from "@/lib/wallets/metamask";
import type { Signer } from "@/types/domain";

type Bytes = Uint8Array<ArrayBuffer>;

/** A decrypted request and the pair key that proved where it came from. */
interface Verified {
	request: HandoffRequest;
	pairKey: Bytes;
}

type Phase =
	| { step: "loading" }
	| { step: "problem"; key: string }
	| { step: "code"; body: Bytes; wrong?: boolean }
	| ({ step: "ready"; error?: string; asked?: boolean } & Verified)
	| ({ step: "working" } & Verified)
	| { step: "finished"; key: string };

/** A wallet account is all the direct adapter needs from a signer. */
const signerOf = (address: string): Signer => ({ address }) as Signer;

/** The address a finished page moves to, so that reloading or going back never reopens the request. */
const CLOSED = "closed";

/**
 * Leaves nothing of the request behind and asks the browser to close the tab. A page may only close a
 * tab it opened itself, so MetaMask's browser can ignore this – then the "done" note stays on screen.
 */
const closePage = (): void => {
	window.history.replaceState(null, "", `${window.location.pathname}#/sign/${CLOSED}`);
	window.close();
};

const requestOf = (value: unknown): HandoffRequest | undefined =>
	typeof value === "object" && value !== null ? parseRequest((value as { request?: unknown }).request) : undefined;

/**
 * The signing side of a hand-off, opened inside MetaMask's own browser. It only ever shows a request it
 * could decrypt with the key of a paired app instance (or, on first connection, with the code the user
 * typed from that app) – a link made by anybody else ends in an error. Then it asks the injected wallet
 * and leaves the encrypted answer.
 */
export const SignRequestPage: React.FC = () => {
	const t = useT();
	const { token: raw } = useParams();
	const token = useMemo(() => parseLinkToken(raw ?? ""), [raw]);
	const [phase, setPhase] = useState<Phase>({ step: "loading" });
	const [code, setCode] = useState("");

	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<Phase> => {
			if (raw === CLOSED) return { step: "finished", key: "handoff.page.closed" };
			if (!token) return { step: "problem", key: "handoff.page.badLink" };
			if (!(await hasInjectedMetaMask())) return { step: "problem", key: "handoff.page.noWallet" };
			const body = await fetchHandoffRequest(token.id);
			if (!body) return { step: "problem", key: "handoff.page.expired" };
			if (token.linkKey) return { step: "code", body };
			for (const pairKey of await loadPagePairKeys()) {
				try {
					const request = requestOf(await open(await sessionKey(pairKey, token.id), token.id, "req", body));
					if (request) return { step: "ready", request, pairKey };
				} catch {
					// Not from this app instance – try the next one.
				}
			}
			return { step: "problem", key: "handoff.page.unpaired" };
		};
		load()
			.catch((): Phase => ({ step: "problem", key: "handoff.page.expired" }))
			.then((next) => !cancelled && setPhase(next));
		return () => {
			cancelled = true;
		};
	}, [token, raw]);

	const handleCode = useCallback(async () => {
		if (phase.step !== "code" || !token?.linkKey) return;
		try {
			const value = (await open(await pairingKey(token.linkKey, code, token.id), token.id, "req", phase.body)) as {
				pairKey?: unknown;
			};
			const pairKey = typeof value.pairKey === "string" ? parseKey(value.pairKey) : undefined;
			const request = requestOf(value);
			if (!pairKey || !request) throw new Error("malformed");
			await addPagePairKey(pairKey);
			setPhase({ step: "ready", request, pairKey });
		} catch {
			setPhase({ step: "code", body: phase.body, wrong: true });
		}
	}, [phase, token, code]);

	/** Number of the latest wallet request; the outcome of an older one no longer changes the page. */
	const attempt = useRef(0);
	const answered = useRef(false);

	const answer = useCallback(
		async (pairKey: Bytes, response: HandoffResponse, doneKey: string) => {
			if (!token || answered.current) return;
			answered.current = true;
			const body = await seal(await sessionKey(pairKey, token.id), token.id, "res", response);
			const delivered = await putHandoffResponse(token.id, body).catch(() => false);
			setPhase({ step: "finished", key: delivered ? doneKey : "handoff.page.lost" });
			closePage();
		},
		[token],
	);

	/**
	 * Asks the wallet. It may be called again while an earlier request is still open: MetaMask does not
	 * always report that its prompt was dismissed, and the user must not be left without a way forward.
	 */
	const handleConfirm = useCallback(async () => {
		if (phase.step !== "ready" && phase.step !== "working") return;
		const { request, pairKey } = phase;
		const mine = ++attempt.current;
		setPhase({ step: "working", request, pairKey });
		try {
			let result: unknown;
			if (request.method === "accounts") {
				result = (await metamaskDirect.listAccounts({ reselect: true })).map((a) => a.address);
			} else if (request.method === "signTypedData") {
				result = await metamaskDirect.signTypedData(signerOf(request.address), request.data);
			} else {
				result = await metamaskDirect.sendTransaction(signerOf(request.address), fromWireTx(request.tx));
			}
			// Any confirmed request is a valid answer, also one the user had asked for earlier.
			await answer(pairKey, { ok: true, result }, "handoff.page.done");
		} catch (e) {
			if (attempt.current !== mine || answered.current) return;
			setPhase({ step: "ready", request, pairKey, asked: true, error: describeError(e, t) });
		}
	}, [phase, answer, t]);

	// A request that got this far is known to come from the user's own app, so MetaMask is asked right
	// away – the button below is for asking again.
	useEffect(() => {
		if (phase.step === "ready" && !phase.asked) void handleConfirm();
	}, [phase, handleConfirm]);

	const handleDecline = useCallback(() => {
		if (phase.step !== "ready" && phase.step !== "working") return;
		attempt.current += 1;
		void answer(phase.pairKey, { ok: false, code: "rejected" }, "handoff.page.declined");
	}, [phase, answer]);

	return (
		<div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 py-6">
			<div className="flex items-center gap-3">
				<AppLogo className="size-7 shrink-0" />
				<h1 className="text-lg font-semibold">{t("handoff.page.title")}</h1>
			</div>
			{phase.step === "loading" && (
				<div className="text-base-content/60 flex items-center gap-2 text-sm">
					<Spinner size="xs" />
					{t("handoff.page.loading")}
				</div>
			)}
			{phase.step === "problem" && <Notice tone="error">{t(phase.key)}</Notice>}
			{phase.step === "finished" && <Notice>{t(phase.key)}</Notice>}
			{phase.step === "code" && (
				<form
					className="flex flex-col gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						void handleCode();
					}}
				>
					<p className="text-sm">{t("handoff.page.codeText")}</p>
					<Notice tone="warning">{t("handoff.page.codeWarning")}</Notice>
					<input
						className="input mono w-full text-center text-2xl tracking-widest"
						inputMode="numeric"
						autoComplete="off"
						maxLength={6}
						value={code}
						onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
						aria-label={t("handoff.code")}
						aria-invalid={phase.wrong}
					/>
					{phase.wrong && <p className="text-error text-sm">{t("handoff.page.codeWrong")}</p>}
					<button type="submit" className="btn btn-primary" disabled={code.length !== 6}>
						{t("handoff.page.codeSubmit")}
					</button>
				</form>
			)}
			{(phase.step === "ready" || phase.step === "working") && (
				<>
					<Notice>{t("handoff.page.verified")}</Notice>
					<div className="card-surface flex flex-col gap-3 p-4">
						<h2 className="font-semibold">{t(`handoff.method.${phase.request.method}`)}</h2>
						<RequestView request={phase.request} />
					</div>
					{phase.step === "ready" && phase.error && <Notice tone="error">{phase.error}</Notice>}
					{phase.step === "working" && (
						<div className="text-base-content/70 flex items-center gap-2 text-sm">
							<Spinner size="xs" />
							{t("handoff.page.waiting")}
						</div>
					)}
					<button
						type="button"
						className={`btn ${phase.step === "working" ? "" : "btn-primary"}`}
						onClick={() => void handleConfirm()}
					>
						{t(phase.step === "working" ? "handoff.page.again" : "handoff.page.confirm")}
					</button>
					<button type="button" className="btn btn-ghost" onClick={handleDecline}>
						{t("handoff.page.decline")}
					</button>
				</>
			)}
		</div>
	);
};
