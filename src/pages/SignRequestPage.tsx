import { useCallback, useEffect, useMemo, useState } from "react";
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
	| ({ step: "ready"; error?: string } & Verified)
	| ({ step: "working" } & Verified)
	| { step: "finished"; key: string };

/** A wallet account is all the direct adapter needs from a signer. */
const signerOf = (address: string): Signer => ({ address }) as Signer;

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
	}, [token]);

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

	const answer = useCallback(
		async (pairKey: Bytes, response: HandoffResponse, doneKey: string) => {
			if (!token) return;
			const body = await seal(await sessionKey(pairKey, token.id), token.id, "res", response);
			const delivered = await putHandoffResponse(token.id, body).catch(() => false);
			setPhase({ step: "finished", key: delivered ? doneKey : "handoff.page.lost" });
		},
		[token],
	);

	const handleConfirm = useCallback(async () => {
		if (phase.step !== "ready") return;
		const { request, pairKey } = phase;
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
			await answer(pairKey, { ok: true, result }, "handoff.page.done");
		} catch (e) {
			// Stay on the request: the user may fix the cause (wrong account, locked wallet) and try again.
			setPhase({ step: "ready", request, pairKey, error: describeError(e, t) });
		}
	}, [phase, answer, t]);

	const handleDecline = useCallback(() => {
		if (phase.step === "ready") void answer(phase.pairKey, { ok: false, code: "rejected" }, "handoff.page.declined");
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
					<button
						type="button"
						className="btn btn-primary"
						disabled={phase.step === "working"}
						onClick={() => void handleConfirm()}
					>
						{phase.step === "working" && <Spinner size="xs" />}
						{t("handoff.page.confirm")}
					</button>
					<button type="button" className="btn btn-ghost" disabled={phase.step === "working"} onClick={handleDecline}>
						{t("handoff.page.decline")}
					</button>
				</>
			)}
		</div>
	);
};
