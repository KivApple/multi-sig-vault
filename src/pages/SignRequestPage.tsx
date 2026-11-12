import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Notice } from "@/components/common/Notice";
import { RequestView } from "@/components/handoff/RequestView";
import { AppLogo } from "@/components/icons/AppLogo";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { fetchHandoffRequest, putHandoffResponse } from "@/lib/handoff/client";
import { open, parseToken, seal, sessionCode } from "@/lib/handoff/crypto";
import { fromWireTx, parseRequest, type HandoffRequest, type HandoffResponse } from "@/lib/handoff/protocol";
import { hasInjectedMetaMask, metamaskDirect } from "@/lib/wallets/metamask";
import type { Signer } from "@/types/domain";

type Phase =
	| { step: "loading" }
	| { step: "problem"; key: string }
	| { step: "ready"; request: HandoffRequest; code: string; error?: string }
	| { step: "working"; request: HandoffRequest; code: string }
	| { step: "finished"; key: string };

/** A wallet account is all the direct adapter needs from a signer. */
const signerOf = (address: string): Signer => ({ address }) as Signer;

/**
 * The signing side of a hand-off, opened inside MetaMask's own browser: shows the request the app left
 * on the relay, asks the injected wallet and leaves the encrypted answer. Standalone – it uses none of
 * the app's stored data.
 */
export const SignRequestPage: React.FC = () => {
	const t = useT();
	const { token: raw } = useParams();
	const token = useMemo(() => parseToken(raw ?? ""), [raw]);
	const [phase, setPhase] = useState<Phase>({ step: "loading" });

	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<Phase> => {
			if (!token) return { step: "problem", key: "handoff.page.badLink" };
			if (!(await hasInjectedMetaMask())) return { step: "problem", key: "handoff.page.noWallet" };
			const body = await fetchHandoffRequest(token.id);
			if (!body) return { step: "problem", key: "handoff.page.expired" };
			let request: HandoffRequest | undefined;
			try {
				request = parseRequest(await open(token, "req", body));
			} catch {
				request = undefined;
			}
			if (!request) return { step: "problem", key: "handoff.page.tampered" };
			return { step: "ready", request, code: await sessionCode(token) };
		};
		load()
			.catch((): Phase => ({ step: "problem", key: "handoff.page.expired" }))
			.then((next) => !cancelled && setPhase(next));
		return () => {
			cancelled = true;
		};
	}, [token]);

	const answer = useCallback(
		async (response: HandoffResponse, doneKey: string) => {
			if (!token) return;
			const delivered = await putHandoffResponse(token.id, await seal(token, "res", response)).catch(() => false);
			setPhase({ step: "finished", key: delivered ? doneKey : "handoff.page.lost" });
		},
		[token],
	);

	const handleConfirm = useCallback(async () => {
		if (phase.step !== "ready") return;
		const { request, code } = phase;
		setPhase({ step: "working", request, code });
		try {
			let result: unknown;
			if (request.method === "accounts") {
				result = (await metamaskDirect.listAccounts({ reselect: true })).map((a) => a.address);
			} else if (request.method === "signTypedData") {
				result = await metamaskDirect.signTypedData(signerOf(request.address), request.data);
			} else {
				result = await metamaskDirect.sendTransaction(signerOf(request.address), fromWireTx(request.tx));
			}
			await answer({ ok: true, result }, "handoff.page.done");
		} catch (e) {
			// Stay on the request: the user may fix the cause (wrong account, locked wallet) and try again.
			setPhase({ step: "ready", request, code, error: describeError(e, t) });
		}
	}, [phase, answer, t]);

	const handleDecline = useCallback(
		() => void answer({ ok: false, code: "rejected" }, "handoff.page.declined"),
		[answer],
	);

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
			{(phase.step === "ready" || phase.step === "working") && (
				<>
					<div className="bg-base-200 rounded-box px-4 py-3 text-center">
						<div className="field-label mb-0">{t("handoff.code")}</div>
						<div className="mono tabular text-2xl font-semibold tracking-widest">{phase.code}</div>
					</div>
					<Notice tone="warning">{t("handoff.page.warning")}</Notice>
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
