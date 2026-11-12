import { Check, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatUnits, type Address } from "viem";
import { AddressLabel } from "@/components/common/AddressLabel";
import { Notice } from "@/components/common/Notice";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { getChain } from "@/config/chains";
import { useCached } from "@/hooks/useCached";
import { useLang, useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { WalletError } from "@/lib/errors";
import { formatAmount, sameAddress } from "@/lib/format";
import type { AddressScope } from "@/lib/known";
import { fetchNativeBalances } from "@/lib/safe/account";
import { metamaskUsesApp } from "@/lib/wallets/metamask";
import { useAppStore } from "@/store/appStore";
import type { Signer } from "@/types/domain";

export interface SignerPickerDialogProps {
	open: boolean;
	onClose: () => void;
	title: string;
	hint?: ReactNode;
	/** Rows, in display order. Addresses the app has no signer for are shown dimmed and cannot be picked. */
	addresses: Address[];
	/** Addresses that already signed – shown with a check mark. */
	signed?: Address[];
	/** Returns why a known signer cannot be used here (shown under its name). */
	disabledReason?: (signer: Signer) => string | undefined;
	/** Show each address' native coin balance on this chain (the picked signer pays gas). */
	balanceChainId?: number;
	/** Estimated network fee in wei; `null` – being estimated. */
	feeWei?: bigint | null;
	scope?: AddressScope;
	/** Runs the wallet interaction; the dialog shows progress, closes on success and shows the error otherwise. */
	onPick: (signer: Signer) => Promise<void>;
}

/** The one dialog for "which signer does this?" – signing, sending and paying gas. */
export const SignerPickerDialog: React.FC<SignerPickerDialogProps> = ({
	open,
	onClose,
	title,
	hint,
	addresses,
	signed,
	disabledReason,
	balanceChainId,
	feeWei,
	scope,
	onPick,
}) => {
	const t = useT();
	const lang = useLang();
	const signers = useAppStore((s) => s.signers);
	const [busy, setBusy] = useState<string>();
	const [error, setError] = useState<string>();
	const [nextStep, setNextStep] = useState<string>();

	useEffect(() => {
		if (open) {
			setBusy(undefined);
			setError(undefined);
			setNextStep(undefined);
		}
	}, [open]);

	const balanceKey =
		open && balanceChainId !== undefined ? `native:${balanceChainId}:${addresses.join(",").toLowerCase()}` : null;
	const fetchBalances = useCallback(
		() => fetchNativeBalances(balanceChainId as number, addresses),
		[balanceChainId, addresses],
	);
	const balances = useCached(balanceKey, fetchBalances, 20_000).data;
	const chain = balanceChainId !== undefined ? getChain(balanceChainId) : undefined;

	const rows = useMemo(
		() =>
			addresses.map((address) => {
				const signer = signers.find((s) => sameAddress(s.address, address));
				const done = !!signed?.some((a) => sameAddress(a, address));
				const reason = signer && !done ? disabledReason?.(signer) : undefined;
				return { address, signer, done, reason };
			}),
		[addresses, signers, signed, disabledReason],
	);

	const handlePick = useCallback(
		async (signer: Signer) => {
			setBusy(signer.id);
			setError(undefined);
			setNextStep(undefined);
			try {
				await onPick(signer);
				onClose();
			} catch (e) {
				// Not a failure: the wallet finished one step and the next needs another tap.
				if (e instanceof WalletError && e.code === "continue") setNextStep(describeError(e, t));
				else setError(describeError(e, t));
			} finally {
				setBusy(undefined);
			}
		},
		[onPick, onClose, t],
	);

	const busySigner = signers.find((s) => s.id === busy);

	return (
		<Dialog open={open} onClose={onClose} title={title}>
			{hint && <div className="text-base-content/70 mb-3 text-sm">{hint}</div>}
			{chain && feeWei !== undefined && (
				<div className="bg-base-200 rounded-field mb-3 flex items-center justify-between px-3 py-2 text-sm">
					<span className="text-base-content/70">{t("ops.networkFee")}</span>
					{feeWei === null ? (
						<Spinner size="xs" />
					) : (
						<span className="tabular font-medium">
							≈ {formatAmount(formatUnits(feeWei, 18), lang, 6)} {chain.nativeSymbol}
						</span>
					)}
				</div>
			)}
			<ul className="-mx-2 flex flex-col">
				{rows.map(({ address, signer, done, reason }) => {
					const disabled = !signer || done || !!reason || !!busy;
					const balance = balances?.[address.toLowerCase()];
					return (
						<li key={address}>
							<button
								type="button"
								className={`flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left ${
									disabled ? "" : "hover:bg-base-200"
								} ${!signer || done || reason ? "opacity-50" : ""}`}
								disabled={disabled}
								onClick={() => signer && void handlePick(signer)}
							>
								<span className="flex min-w-0 flex-1 flex-col">
									<AddressLabel address={address} scope={scope ?? {}} size={32} />
									{(reason || (!signer && !done)) && (
										<span className="text-base-content/70 mt-0.5 text-xs">{reason ?? t("ops.unknownSigner")}</span>
									)}
								</span>
								{chain && (
									<span className="tabular text-base-content/80 shrink-0 text-sm">
										{balance === undefined
											? ""
											: `${formatAmount(formatUnits(BigInt(balance), 18), lang, 5)} ${chain.nativeSymbol}`}
									</span>
								)}
								{signer && busy === signer.id ? (
									<Spinner />
								) : done ? (
									<Check className="text-success size-5 shrink-0" aria-label={t("ops.signed")} />
								) : (
									!disabled && <ChevronRight className="text-base-content/40 size-4 shrink-0" />
								)}
							</button>
						</li>
					);
				})}
			</ul>
			{rows.length === 0 && <p className="text-base-content/60 py-4 text-center text-sm">{t("ops.noSigners")}</p>}
			{busySigner && (
				<Notice className="mt-3">
					{t(`ops.confirmIn.${busySigner.wallet}`)}
					{busySigner.wallet === "metamask" && metamaskUsesApp() && (
						<>
							{" "}
							<a className="link font-medium" href="metamask://">
								{t("wallets.openMetaMask")}
							</a>
						</>
					)}
				</Notice>
			)}
			{nextStep && <Notice className="mt-3">{nextStep}</Notice>}
			{error && (
				<Notice tone="error" className="mt-3">
					{error}
				</Notice>
			)}
		</Dialog>
	);
};
