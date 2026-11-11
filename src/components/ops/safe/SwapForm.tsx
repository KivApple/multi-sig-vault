import { TriangleAlert } from "lucide-react";
import { useCallback, useMemo } from "react";
import { formatUnits } from "viem";
import { AddressField } from "@/components/common/AddressField";
import { AmountField } from "@/components/common/AmountField";
import { PickerSelect, type PickerOption } from "@/components/common/PickerSelect";
import { NetworkIcon } from "@/components/icons/NetworkIcon";
import { TokenIcon } from "@/components/icons/TokenIcon";
import { Field } from "@/components/ui/Field";
import { chainsOf, getChain } from "@/config/chains";
import { useLang, useT } from "@/i18n";
import { NATIVE, type SwapParams } from "@/lib/evm/swapBuild";
import { useSwapPreview } from "@/lib/evm/useSwapPreview";
import { formatAmount, formatUsd, sameAddress } from "@/lib/format";
import { knownRecipients, type KnownAddress } from "@/lib/known";
import type { OpFormProps } from "@/lib/ops/types";
import { useTokens } from "@/lib/tokens";
import { SwapBridgeOptions } from "./SwapBridgeOptions";
import { SwapQuoteBox } from "./SwapQuoteBox";
import { SwapTradeOptions } from "./SwapTradeOptions";

/** Form of the "Swap / bridge" operation: what to sell, where and what to receive, who receives. */
export const SwapForm: React.FC<OpFormProps<SwapParams>> = ({ value, onChange, env, errors }) => {
	const t = useT();
	const lang = useLang();
	const { account, accounts, signers } = env;
	const chainId = account.chainId as number;
	const chain = getChain(chainId);
	const cross = value.destChainId !== chainId;
	const dest = getChain(value.destChainId);
	const tokens = useTokens(chainId);
	const holdings = env.safe?.holdings;
	const preview = useSwapPreview(value, chainId, account.address);

	const inOptions = useMemo<PickerOption[]>(
		() =>
			(holdings ?? [])
				.filter((h) => h.balance !== "0")
				.sort((a, b) => b.usd - a.usd)
				.map((h) => ({
					value: h.token ? h.token.address : NATIVE,
					title: h.symbol,
					subtitle: h.token?.name ?? chain.nativeName,
					icon: <TokenIcon symbol={h.symbol} chainId={chainId} address={h.token?.address} size={32} />,
					aside: (
						<span className="flex flex-col items-end leading-tight">
							<span>{formatAmount(formatUnits(BigInt(h.balance), h.decimals), lang)}</span>
							{h.usd > 0 && <span className="text-base-content/60 text-xs">{formatUsd(h.usd, lang)}</span>}
						</span>
					),
				})),
		[holdings, chain.nativeName, chainId, lang],
	);

	const holding = useMemo(
		() =>
			holdings?.find((h) => (value.tokenIn === NATIVE ? !h.token : !!h.token && sameAddress(h.token.address, value.tokenIn))),
		[holdings, value.tokenIn],
	);

	const outOptions = useMemo<PickerOption[]>(
		() => [
			{
				value: NATIVE,
				title: chain.nativeSymbol,
				subtitle: chain.nativeName,
				icon: <TokenIcon symbol={chain.nativeSymbol} chainId={chainId} size={32} />,
				disabled: value.tokenIn === NATIVE,
			},
			...tokens.map((tk) => ({
				value: tk.address,
				title: tk.symbol,
				subtitle: tk.name,
				icon: <TokenIcon symbol={tk.symbol} chainId={chainId} address={tk.address} size={32} />,
				disabled: sameAddress(tk.address, value.tokenIn),
			})),
		],
		[tokens, chain.nativeSymbol, chain.nativeName, chainId, value.tokenIn],
	);

	const chainOptions = useMemo<PickerOption[]>(
		() =>
			chainsOf(account.env)
				.filter((c) => c.id === chainId || (!!c.cctp && !!chain.cctp))
				.map((c) => ({
					value: String(c.id),
					title: c.name,
					subtitle: c.id === chainId ? t("swap.thisNetwork") : t("swap.viaBridge"),
					icon: <NetworkIcon chainId={c.id} size={32} />,
				})),
		[account.env, chainId, chain.cctp, t],
	);

	const handleTokenIn = useCallback(
		(v: string) => {
			const h = holdings?.find((x) => (v === NATIVE ? !x.token : !!x.token && sameAddress(x.token.address, v)));
			const patch: Partial<SwapParams> = {
				tokenIn: v,
				tokenInSymbol: h?.symbol ?? chain.nativeSymbol,
				tokenInDecimals: h?.decimals ?? 18,
				amount: "",
			};
			if (sameAddress(v, value.tokenOut) || (v === NATIVE && value.tokenOut === NATIVE)) {
				patch.tokenOut = "";
				patch.tokenOutSymbol = "";
			}
			onChange(patch);
		},
		[holdings, chain.nativeSymbol, value.tokenOut, onChange],
	);

	const handleTokenOut = useCallback(
		(v: string) => {
			const tk = tokens.find((x) => sameAddress(x.address, v));
			onChange({
				tokenOut: v,
				tokenOutSymbol: tk?.symbol ?? chain.nativeSymbol,
				tokenOutDecimals: tk?.decimals ?? 18,
			});
		},
		[tokens, chain.nativeSymbol, onChange],
	);

	const handleChain = useCallback(
		// The recipient list depends on the network – start again from this Safe's address.
		(v: string) => onChange({ destChainId: Number(v), recipient: "" }),
		[onChange],
	);
	const handleAmount = useCallback((amount: string) => onChange({ amount }), [onChange]);
	const handleRecipient = useCallback(
		(address: string) => onChange({ recipient: sameAddress(address, account.address) ? "" : address }),
		[onChange, account.address],
	);

	const ownOnDest = useMemo(
		() => accounts.find((a) => a.kind === "safe" && a.chainId === value.destChainId && sameAddress(a.address, account.address)),
		[accounts, value.destChainId, account.address],
	);
	const known = useMemo<KnownAddress[]>(
		() => [
			// The Safe's own address always comes first, even when no Safe is known on the other network.
			{ address: account.address, account: ownOnDest ?? { ...account, chainId: value.destChainId } },
			...knownRecipients(signers, accounts, { chainId: value.destChainId }, account.address),
		],
		[account, ownOnDest, signers, accounts, value.destChainId],
	);

	const toSelf = !value.recipient;
	const recipientHint = !toSelf ? undefined : !cross ? (
		t("swap.toThisSafe")
	) : ownOnDest ? (
		t("swap.toSameSafe", { network: dest.name })
	) : (
		<span className="text-warning flex items-start gap-1">
			<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
			{t("swap.unknownSafeWarning", { network: dest.name })}
		</span>
	);

	const needSwap = !cross || value.tokenIn === NATIVE || !sameAddress(value.tokenIn, chain.usdc);

	return (
		<div className="flex flex-col gap-4">
			<Field label={t("swap.sell")} error={errors.tokenIn}>
				<PickerSelect
					value={value.tokenIn}
					options={inOptions}
					onChange={handleTokenIn}
					title={t("swap.sell")}
					invalid={!!errors.tokenIn}
				/>
			</Field>
			<AmountField
				label={t("swap.amount")}
				value={value.amount}
				onChange={handleAmount}
				symbol={value.tokenInSymbol}
				max={holding ? formatUnits(BigInt(holding.balance), holding.decimals) : undefined}
				error={errors.amount}
			/>
			{chainOptions.length > 1 && (
				<Field label={t("swap.network")} error={errors.destChainId}>
					<PickerSelect
						value={String(value.destChainId)}
						options={chainOptions}
						onChange={handleChain}
						title={t("swap.network")}
						invalid={!!errors.destChainId}
					/>
				</Field>
			)}
			{cross ? (
				<Field label={t("swap.receive")} hint={needSwap ? t("swap.crossHint", { network: dest.name }) : undefined}>
					<div className="input flex h-auto min-h-12 w-full items-center gap-2 py-1.5">
						<TokenIcon symbol="USDC" chainId={dest.id} address={dest.usdc} size={32} />
						<span className="flex flex-col leading-tight">
							<span className="font-medium">USDC</span>
							<span className="text-base-content/60 text-xs">{dest.name}</span>
						</span>
					</div>
				</Field>
			) : (
				<Field label={t("swap.receive")} error={errors.tokenOut}>
					<PickerSelect
						value={value.tokenOut || undefined}
						options={outOptions}
						onChange={handleTokenOut}
						title={t("swap.receive")}
						placeholder={t("swap.chooseToken")}
						invalid={!!errors.tokenOut}
					/>
				</Field>
			)}
			<AddressField
				// Remount when the network changes: the known list and the "Other…" state start over.
				key={value.destChainId}
				label={t("swap.recipient")}
				value={value.recipient || account.address}
				onChange={handleRecipient}
				known={known}
				error={errors.recipient}
				hint={recipientHint}
			/>
			{needSwap && <SwapTradeOptions value={value} onChange={onChange} chainId={chainId} error={errors.slippage} />}
			{cross && <SwapBridgeOptions value={value} onChange={onChange} chainId={chainId} />}
			<SwapQuoteBox params={value} preview={preview} chainId={chainId} />
		</div>
	);
};
