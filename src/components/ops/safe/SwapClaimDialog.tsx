import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Hex } from "viem";
import { WalletIcon } from "@/components/icons/WalletIcon";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { getChain } from "@/config/chains";
import { useLang, useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { encodeReceiveMessage, messageTransmitterOf, requestReattest } from "@/lib/evm/cctp";
import { formatAmount, shortAddress } from "@/lib/format";
import { fetchNativeBalances } from "@/lib/safe/account";
import { getPublicClient } from "@/lib/rpc";
import { sendTransactionWith } from "@/lib/wallets";
import { FeeChoice } from "../FeeChoice";
import { useAppStore } from "@/store/appStore";
import type { Signer } from "@/types/domain";

export interface SwapClaimDialogProps {
	open: boolean;
	onClose: () => void;
	srcChainId: number;
	dstChainId: number;
	message: Hex;
	attestation: Hex;
	nonce?: Hex;
	/** Fast transfer: the attestation can expire and be re-requested. */
	expirable: boolean;
	onSent: (txHash: Hex) => void;
}

/** Any known signer pays gas for `receiveMessage` on the destination network; the recipient does not change. */
export const SwapClaimDialog: React.FC<SwapClaimDialogProps> = ({
	open,
	onClose,
	srcChainId,
	dstChainId,
	message,
	attestation,
	nonce,
	expirable,
	onSent,
}) => {
	const t = useT();
	const lang = useLang();
	const signers = useAppStore((s) => s.signers);
	const chain = getChain(dstChainId);
	const [balances, setBalances] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState<string>();
	const [error, setError] = useState<string>();
	const [reattested, setReattested] = useState(false);
	const [gas, setGas] = useState<bigint | null>();

	// Gas of the claim, for the fee shown above the list (any address may send it).
	useEffect(() => {
		const from = signers[0]?.address;
		if (!open || !from) return undefined;
		let cancelled = false;
		setGas(null);
		getPublicClient(dstChainId)
			.estimateGas({
				account: from,
				to: messageTransmitterOf(dstChainId),
				data: encodeReceiveMessage(message, attestation),
			})
			.then((g) => !cancelled && setGas((g * 125n) / 100n))
			.catch(() => !cancelled && setGas(undefined));
		return () => {
			cancelled = true;
		};
	}, [open, dstChainId, message, attestation, signers]);

	useEffect(() => {
		if (!open) return undefined;
		let cancelled = false;
		setError(undefined);
		fetchNativeBalances(
			dstChainId,
			signers.map((s) => s.address),
		)
			.then((b) => {
				if (!cancelled) setBalances(b);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [open, dstChainId, signers]);

	const handlePick = useCallback(
		async (signer: Signer) => {
			setBusy(signer.id);
			setError(undefined);
			try {
				const hash = await sendTransactionWith(signer, {
					chainId: dstChainId,
					to: messageTransmitterOf(dstChainId),
					data: encodeReceiveMessage(message, attestation),
				});
				onSent(hash);
				onClose();
			} catch (e) {
				setError(describeError(e, t));
			} finally {
				setBusy(undefined);
			}
		},
		[dstChainId, message, attestation, onSent, onClose, t],
	);

	const handleReattest = useCallback(async () => {
		if (!nonce) return;
		setError(undefined);
		try {
			await requestReattest(srcChainId, nonce);
			setReattested(true);
		} catch (e) {
			setError(describeError(e, t));
		}
	}, [nonce, srcChainId, t]);

	return (
		<Dialog open={open} onClose={onClose} title={t("swap.claim.title")} dismissable={!busy}>
			<p className="text-base-content/70 mb-3 text-sm">
				{t("swap.claim.text", { network: chain.name, symbol: chain.nativeSymbol })}
			</p>
			{signers.length === 0 && <p className="text-base-content/60 text-sm">{t("swap.claim.noSigners")}</p>}
			{signers.length > 0 && <FeeChoice chainId={dstChainId} gas={gas} />}
			<ul className="-mx-2 flex flex-col">
				{signers.map((s) => {
					const balance = balances[s.address.toLowerCase()];
					return (
						<li key={s.id}>
							<button
								type="button"
								className="hover:bg-base-200 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left disabled:opacity-50"
								onClick={() => void handlePick(s)}
								disabled={!!busy}
							>
								<WalletIcon kind={s.wallet} size={32} />
								<span className="flex min-w-0 flex-1 flex-col leading-tight">
									<span className="truncate font-medium">{s.name}</span>
									<span className="mono text-base-content/60 text-xs">{shortAddress(s.address)}</span>
								</span>
								{busy === s.id ? (
									<Spinner />
								) : (
									balance !== undefined && (
										<span className="tabular text-base-content/70 shrink-0 text-sm">
											{formatAmount(formatUnits(BigInt(balance), 18), lang)} {chain.nativeSymbol}
										</span>
									)
								)}
							</button>
						</li>
					);
				})}
			</ul>
			{busy && <p className="text-base-content/70 mt-2 text-sm">{t("swap.claim.confirm")}</p>}
			{error && <p className="text-error mt-2 text-sm">{error}</p>}
			{error && expirable && nonce && !reattested && (
				<button type="button" className="btn btn-outline btn-sm mt-2" onClick={() => void handleReattest()}>
					{t("swap.claim.reattest")}
				</button>
			)}
			{reattested && <p className="text-base-content/70 mt-2 text-sm">{t("swap.claim.reattested")}</p>}
		</Dialog>
	);
};
