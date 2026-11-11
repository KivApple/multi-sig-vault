import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { explorerTx, findChain } from "@/config/chains";
import { useT } from "@/i18n";
import { fetchCctpMessage, isNonceUsed, type CctpMessage, type ExpectedTransfer } from "@/lib/evm/cctp";
import { bridgeProgressOf, type BridgeProgress, type SwapParams } from "@/lib/evm/swapBuild";
import { parseAddress } from "@/lib/format";
import { patchResultExtra } from "@/lib/ops/engine";
import type { OpResultProps } from "@/lib/ops/types";
import { SwapClaimDialog } from "./SwapClaimDialog";
import { SwapStepper } from "./SwapStepper";

/** Circle normally mints within a couple of minutes after attesting; later than this we offer the manual way. */
const FORWARD_GRACE_MS = 10 * 60 * 1000;
const POLL_MIN_MS = 6_000;
const POLL_MAX_MS = 30_000;

/**
 * Sent card of a cross-chain transfer: follows burn → attestation → mint through Circle's API and,
 * if the mint does not arrive, lets any signer pay for it on the destination network.
 */
export const SwapResult: React.FC<OpResultProps> = ({ op, account }) => {
	const t = useT();
	const params = op.params as unknown as SwapParams;
	const srcChainId = account.chainId as number;
	const bridge = params.resolved?.bridge;
	const dest = findChain(params.destChainId);
	const txHash = op.result?.txHash;
	const reverted = op.result?.extra?.txStatus === "reverted";
	const progress = bridgeProgressOf(op);
	const stage = progress?.stage ?? "burned";
	const [attested, setAttested] = useState<CctpMessage>();
	const [claiming, setClaiming] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const progressRef = useRef(progress);
	progressRef.current = progress;

	const expected = useMemo<ExpectedTransfer>(
		() => ({
			srcChainId,
			dstChainId: params.destChainId,
			sender: account.address,
			recipient: (parseAddress(params.recipient) ?? account.address) as Address,
		}),
		[srcChainId, params.destChainId, params.recipient, account.address],
	);

	const save = useCallback(
		(patch: Partial<BridgeProgress>) => {
			const current = progressRef.current ?? { stage: "burned" as const };
			patchResultExtra(op.id, { bridge: { ...current, ...patch } });
		},
		[op.id],
	);

	const active = !!bridge && !!dest && !!txHash && !reverted && stage !== "credited";

	useEffect(() => {
		if (!active || !txHash) return undefined;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let delay = POLL_MIN_MS;

		const poll = async (): Promise<void> => {
			if (document.visibilityState === "visible" && navigator.onLine) {
				try {
					const msg = await fetchCctpMessage(txHash, expected);
					if (stopped) return;
					if (msg) {
						const nonce = msg.nonce ?? (progressRef.current?.nonce as Hex | undefined);
						if (msg.mintTxHash || msg.forwardState === "COMPLETE") {
							save({ stage: "credited", nonce, mintTxHash: msg.mintTxHash });
							return;
						}
						if (msg.complete && msg.message && msg.attestation) {
							setAttested(msg);
							// The mint may have been submitted by anyone – the chain is the source of truth.
							if (nonce && (await isNonceUsed(expected.dstChainId, nonce).catch(() => false))) {
								if (!stopped) save({ stage: "credited", nonce });
								return;
							}
							if (!stopped && progressRef.current?.stage !== "attested") {
								save({ stage: "attested", nonce, attestedAt: Date.now() });
							}
						}
					}
				} catch {
					// Transient API/RPC failure – try again later.
				}
			}
			if (stopped) return;
			delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.25));
			timer = setTimeout(() => void poll(), delay);
		};

		void poll();
		const wake = (): void => {
			if (document.visibilityState !== "visible") return;
			clearTimeout(timer);
			delay = POLL_MIN_MS;
			void poll();
		};
		document.addEventListener("visibilitychange", wake);
		window.addEventListener("online", wake);
		return () => {
			stopped = true;
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", wake);
			window.removeEventListener("online", wake);
		};
	}, [active, txHash, expected, save]);

	const manualAt = bridge?.forward ? (progress?.attestedAt ?? Number.POSITIVE_INFINITY) + FORWARD_GRACE_MS : 0;
	useEffect(() => {
		if (stage !== "attested" || !Number.isFinite(manualAt) || manualAt <= Date.now()) return undefined;
		const timer = setTimeout(() => setNow(Date.now()), manualAt - Date.now() + 500);
		return () => clearTimeout(timer);
	}, [stage, manualAt]);

	const handleSent = useCallback((claimTxHash: Hex) => save({ claimTxHash }), [save]);
	const handleOpenClaim = useCallback(() => setClaiming(true), []);
	const handleCloseClaim = useCallback(() => setClaiming(false), []);

	const steps = useMemo(
		() => [
			{ label: t("swap.step.sent"), done: true },
			{ label: t("swap.step.attested"), done: stage !== "burned" },
			{ label: t("swap.step.credited"), done: stage === "credited" },
		],
		[t, stage],
	);

	if (!bridge || !dest || !txHash || reverted) return null;
	const canClaim = stage === "attested" && !!attested?.message && !!attested.attestation && now >= manualAt;
	const mintHash = progress?.mintTxHash ?? progress?.claimTxHash;

	return (
		<div className="mt-3 flex flex-col gap-2">
			<SwapStepper steps={steps} />
			<p className="text-base-content/70 text-sm">
				{stage === "credited"
					? t("swap.status.credited", { network: dest.name })
					: stage === "attested"
						? progress?.claimTxHash
							? t("swap.status.claimSent")
							: bridge.forward
								? t("swap.status.forwarding", { network: dest.name })
								: t("swap.status.needClaim", { network: dest.name })
						: t("swap.status.waiting")}
			</p>
			{mintHash && (
				<a
					className="link link-primary inline-flex items-center gap-1 self-start text-sm"
					href={explorerTx(dest.id, mintHash)}
					target="_blank"
					rel="noopener noreferrer"
				>
					{t("swap.viewMint", { network: dest.name })}
					<ExternalLink className="size-3.5" />
				</a>
			)}
			{canClaim && (
				<button
					type="button"
					className={`btn btn-sm self-start ${progress?.claimTxHash ? "btn-outline" : "btn-primary"}`}
					onClick={handleOpenClaim}
				>
					{t(progress?.claimTxHash ? "swap.claim.again" : "swap.claim.button")}
				</button>
			)}
			{attested?.message && attested.attestation && (
				<SwapClaimDialog
					open={claiming}
					onClose={handleCloseClaim}
					srcChainId={srcChainId}
					dstChainId={dest.id}
					message={attested.message}
					attestation={attested.attestation}
					nonce={attested.nonce}
					expirable={attested.expirationBlock > 0n}
					onSent={handleSent}
				/>
			)}
		</div>
	);
};
