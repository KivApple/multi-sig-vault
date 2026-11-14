import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Hex } from "viem";
import { explorerTx, findChain, getChain } from "@/config/chains";
import { useT } from "@/i18n";
import { fetchAcrossStatus } from "@/lib/evm/across";
import {
	bridgeAssetOf,
	bridgeProgressOf,
	receivedSymbol,
	type BridgeProgress,
	type SwapParams,
} from "@/lib/evm/swapBuild";
import { patchResultExtra } from "@/lib/ops/engine";
import type { OpResultProps } from "@/lib/ops/types";
import { SwapStepper } from "./SwapStepper";

const POLL_MIN_MS = 5_000;
const POLL_MAX_MS = 30_000;
/** A refund takes hours: once the deposit has expired there is no reason to ask often. */
const POLL_REFUND_MS = 120_000;

/**
 * A transfer through Across: follows deposit → delivery through the bridge's API. Nothing is left
 * to do by hand here: a relayer delivers, and a transfer nobody delivered comes back on its own.
 */
export const SwapAcrossResult: React.FC<OpResultProps> = ({ op, account }) => {
	const t = useT();
	const params = op.params as unknown as SwapParams;
	const srcChainId = account.chainId as number;
	const src = getChain(srcChainId);
	const leg = params.resolved?.across;
	const dest = findChain(params.destChainId);
	const txHash = op.result?.txHash;
	const reverted = op.result?.extra?.txStatus === "reverted";
	const progress = bridgeProgressOf(op);
	const stage = progress?.stage ?? "burned";
	const refund = progress?.refund;
	const progressRef = useRef(progress);
	progressRef.current = progress;

	const save = useCallback(
		(patch: Partial<BridgeProgress>) => {
			const current = progressRef.current ?? { stage: "burned" as const };
			patchResultExtra(op.id, { bridge: { ...current, ...patch } });
		},
		[op.id],
	);

	const destId = dest?.id;
	const active =
		!!leg && destId !== undefined && !!txHash && !reverted && stage !== "credited" && refund !== "refunded";

	useEffect(() => {
		if (!active || !txHash || destId === undefined) return undefined;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let delay = POLL_MIN_MS;

		const poll = async (): Promise<void> => {
			if (document.visibilityState === "visible" && navigator.onLine) {
				try {
					const status = await fetchAcrossStatus(txHash as Hex, srcChainId, destId);
					if (stopped) return;
					if (status?.state === "filled") {
						save({ stage: "credited", mintTxHash: status.fillTxHash, refund: undefined });
						return;
					}
					if (status?.state === "refunded") {
						save({ refund: "refunded", refundTxHash: status.refundTxHash });
						return;
					}
					if (status?.state === "expired" && progressRef.current?.refund !== "expired") save({ refund: "expired" });
				} catch {
					// Transient API failure – try again later.
				}
			}
			if (stopped) return;
			delay =
				progressRef.current?.refund === "expired" ? POLL_REFUND_MS : Math.min(POLL_MAX_MS, Math.round(delay * 1.25));
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
	}, [active, txHash, srcChainId, destId, save]);

	const steps = useMemo(
		() => [
			{ label: t("swap.step.sent"), done: true },
			{ label: t("swap.step.delivered"), done: stage === "credited" },
		],
		[t, stage],
	);

	if (!leg || !dest || !txHash || reverted) return null;
	const asset = bridgeAssetOf(srcChainId, dest.id, params.tokenIn, leg.asset);
	const symbol = asset?.symbol ?? leg.asset;
	const received = asset ? receivedSymbol(asset, leg.unwrap === false) : symbol;
	const fillHash = progress?.mintTxHash;
	const refundHash = progress?.refundTxHash;

	return (
		<div className="mt-3 flex flex-col gap-2">
			{!refund && <SwapStepper steps={steps} />}
			<p className={`text-sm ${refund ? "text-warning" : "text-base-content/70"}`}>
				{stage === "credited"
					? t("swap.across.credited", { network: dest.name, symbol: received })
					: refund === "refunded"
						? t("swap.across.refunded", { network: src.name, symbol })
						: refund === "expired"
							? t("swap.across.expired", { network: src.name, symbol })
							: t("swap.across.waiting", { network: dest.name, symbol: received })}
			</p>
			{stage === "credited" && fillHash && (
				<a
					className="link link-primary inline-flex items-center gap-1 self-start text-sm"
					href={explorerTx(dest.id, fillHash)}
					target="_blank"
					rel="noopener noreferrer"
				>
					{t("swap.viewMint", { network: dest.name })}
					<ExternalLink className="size-3.5" />
				</a>
			)}
			{refund === "refunded" && refundHash && (
				<a
					className="link link-primary inline-flex items-center gap-1 self-start text-sm"
					href={explorerTx(srcChainId, refundHash)}
					target="_blank"
					rel="noopener noreferrer"
				>
					{t("swap.across.viewRefund", { network: src.name })}
					<ExternalLink className="size-3.5" />
				</a>
			)}
		</div>
	);
};
