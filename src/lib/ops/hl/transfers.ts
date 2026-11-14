import { ArrowDownUp, ArrowUpFromLine, Landmark, Send } from "lucide-react";
import { getChain, HL_BRIDGE_CHAIN, HL_EVM_CHAIN } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { ClassTransferForm } from "@/components/ops/hl/ClassTransferForm";
import { SendAssetForm, sendOptions } from "@/components/ops/hl/SendAssetForm";
import { SpotWithdrawForm } from "@/components/ops/hl/SpotWithdrawForm";
import { WithdrawForm } from "@/components/ops/hl/WithdrawForm";
import { formatAmount, isDecimal, trimDecimal } from "@/lib/format";
import { useT } from "@/i18n";
import { HL_WITHDRAW_FEE, hlSystemAddress } from "@/lib/hl/account";
import { assertEvmWithdrawable } from "@/lib/hl/evm";
import { recipientError, requireRecipient } from "@/lib/recipient";
import { mergeNotices, useContractRecipient, useHlNewRecipient } from "../recipientNotices";
import type { OpDefinition, OpErrors, OpNotices } from "../types";
import { unlessUnchecked, useCheck } from "../useCheck";

/** What the HyperEVM look throws when it could not look. */
const EVM_UNCHECKED = ["hl.spotWithdraw.error.unchecked"];
import { amountError } from "./common";

export interface UsdParams {
	destination: string;
	amount: string;
}

export const withdrawOp: OpDefinition<UsdParams> = {
	type: "hl.withdraw",
	kind: "hl",
	icon: ArrowUpFromLine,
	available: (env) => !!env.hl,
	defaults: () => ({ destination: "", amount: "" }),
	Form: WithdrawForm,
	useNotices: (p, env) => useContractRecipient(HL_BRIDGE_CHAIN[env.account.env], p.destination, env),
	validate: (p, env, t) => {
		const errors: Record<string, string> = {};
		const d = recipientError(p.destination, t);
		if (d) errors.destination = d;
		const a = amountError(p.amount, t, {
			decimals: 6,
			max: env.hl?.withdrawable,
			min: HL_WITHDRAW_FEE,
			minExclusive: true,
			symbol: "USDC",
		});
		if (a) errors.amount = a;
		return errors;
	},
	buildHl: (p) => ({
		type: "withdraw3",
		destination: requireRecipient(p.destination).toLowerCase(),
		amount: trimDecimal(p.amount),
	}),
	summary: (p, { t, lang, account }) => [
		{ label: t("ops.amount"), value: `${formatAmount(p.amount, lang)} USDC` },
		{ label: t("ops.fee"), value: `${HL_WITHDRAW_FEE} USDC` },
		{ label: t("ops.receives"), value: `${formatAmount(Number(p.amount) - HL_WITHDRAW_FEE, lang)} USDC` },
		{ label: t("ops.recipient"), address: p.destination as never, chainId: HL_BRIDGE_CHAIN[account.env] },
		{ label: t("common.network"), value: getChain(HL_BRIDGE_CHAIN[account.env]).name },
	],
};

export interface SendParams {
	destination: string;
	/** `perp` – USDC of the perp balance; otherwise the spot token's index. */
	asset: string;
	/** `NAME:0xTokenId`. */
	tokenRef: string;
	coin: string;
	amount: string;
}

const TOKEN_REF = /^[A-Za-z0-9]{1,20}:0x[0-9a-f]{32}$/;

/**
 * Any asset to another Hyperliquid account, in one operation: `sendAsset`, the exchange's general
 * transfer, from a balance to the same kind of balance of the recipient – perp USDC to perp, spot to
 * spot. It works in every account mode (in a unified one `usdSend` is refused), and is what the
 * exchange's own app sends.
 */
export const sendOp: OpDefinition<SendParams> = {
	type: "hl.send",
	kind: "hl",
	icon: Send,
	available: (env) => !!env.hl,
	defaults: () => ({ destination: "", asset: "", tokenRef: "", coin: "", amount: "" }),
	Form: SendAssetForm,
	useNotices: (p, env) => useHlNewRecipient(p.destination, env),
	validate: (p, env, t) => {
		const errors: Record<string, string> = {};
		const option = sendOptions(env, t).find((o) => o.id === p.asset);
		if (!p.asset || !option) errors.asset = t("error.required");
		const d = recipientError(p.destination, t, { self: env.account.address, hyperliquid: true });
		if (d) errors.destination = d;
		const a = amountError(p.amount, t, { decimals: p.asset === "perp" ? 6 : 8, max: option?.balance });
		if (a) errors.amount = a;
		return errors;
	},
	buildHl: (p) => {
		const destination = requireRecipient(p.destination, { hyperliquid: true }).toLowerCase();
		const perp = p.asset === "perp";
		// The token is what the operation says it sends; the perp balance holds USDC only.
		if (!TOKEN_REF.test(p.tokenRef) || !p.tokenRef.startsWith(`${p.coin}:`) || (perp && p.coin !== "USDC")) {
			throw new AppError("ops.error.mismatch");
		}
		const dex = perp ? "" : "spot";
		return {
			type: "sendAsset",
			destination,
			sourceDex: dex,
			destinationDex: dex,
			token: p.tokenRef,
			amount: trimDecimal(p.amount),
			fromSubAccount: "",
		};
	},
	summary: (p, { t, lang }) => [
		{
			label: t("ops.amount"),
			value: `${formatAmount(p.amount, lang, 8)} ${p.coin}${p.asset === "perp" ? ` (${t("hl.perps")})` : ""}`,
		},
		{ label: t("ops.recipient"), address: p.destination as never },
		{ label: t("common.network"), value: "Hyperliquid" },
	],
};

export interface SpotParams {
	destination: string;
	/** Token index on HyperCore. */
	token: number | null;
	/** `NAME:0xTokenId` – resolved when the token is picked. */
	tokenRef: string;
	coin: string;
	amount: string;
}

const spotErrors: OpDefinition<SpotParams>["validate"] = (p, env, t) => {
	const errors: Record<string, string> = {};
	const held = env.hl?.spot.find((s) => s.token === p.token);
	if (p.token === null || !p.tokenRef) errors.token = t("error.required");
	const a = amountError(p.amount, t, { decimals: 8, max: held?.available });
	if (a) errors.amount = a;
	return errors;
};

/** Spot token → HyperEVM: a spot transfer to the token's system address credits the same address on HyperEVM. */
export const spotWithdrawOp: OpDefinition<SpotParams> = {
	type: "hl.spotWithdraw",
	kind: "hl",
	icon: Landmark,
	available: (env) => !!env.hl && env.hl.spot.some((s) => s.evm && s.token !== 0),
	defaults: () => ({ destination: "", token: null, tokenRef: "", coin: "", amount: "" }),
	Form: SpotWithdrawForm,
	useNotices: (p, env) => {
		const t = useT();
		const { account } = env;
		// The exchange debits the account whether or not HyperEVM can pay the token out: look first.
		const ready = p.token !== null && !!p.coin && isDecimal(p.amount, 8) && Number(p.amount) > 0;
		const payout = useCheck(
			ready ? `evm-payout:${account.env}:${account.address}:${p.token}:${trimDecimal(p.amount)}` : null,
			() => assertEvmWithdrawable(account.env, p.token as number, p.coin, p.amount, account.address),
			EVM_UNCHECKED,
			{ unchecked: t("hl.spotWithdraw.uncheckedNote", { coin: p.coin }) },
		);
		// The tokens arrive at the account's own address on HyperEVM, and a multi-sig has no say there.
		const key: OpNotices = {
			notices: env.hl?.multiSig ? [{ id: "evm-key", text: t("hl.evmKeyNote"), confirm: t("hl.evmKeyConfirm") }] : [],
		};
		return mergeNotices(payout, key);
	},
	validate: spotErrors,
	// The same look, by the engine: a problem found stops the signing and, days later, the sending.
	// "Could not look" does not: the card asked about that.
	prepare: async (p, env) => {
		await unlessUnchecked(
			assertEvmWithdrawable(env.account.env, p.token as number, p.coin, p.amount, env.account.address),
			EVM_UNCHECKED,
		);
		return p;
	},
	recheck: (p, account) =>
		unlessUnchecked(
			assertEvmWithdrawable(account.env, p.token as number, p.coin, p.amount, account.address),
			EVM_UNCHECKED,
		),
	// `sendAsset` to the token's system address, as the exchange documents the transfer to HyperEVM.
	buildHl: (p) => ({
		type: "sendAsset",
		destination: hlSystemAddress(p.token as number, p.coin).toLowerCase(),
		sourceDex: "spot",
		destinationDex: "spot",
		token: p.tokenRef,
		amount: trimDecimal(p.amount),
		fromSubAccount: "",
	}),
	summary: (p, { t, lang, account }) => [
		{ label: t("ops.amount"), value: `${formatAmount(p.amount, lang, 8)} ${p.coin}` },
		{ label: t("ops.recipient"), address: account.address, chainId: HL_EVM_CHAIN[account.env] },
		{ label: t("common.network"), value: getChain(HL_EVM_CHAIN[account.env]).name },
		{ label: t("hl.evmKeyNote.label"), value: t("hl.evmKeyNote"), tone: "warning" },
	],
};

export interface ClassTransferParams {
	amount: string;
	toPerp: boolean;
}

export const classTransferOp: OpDefinition<ClassTransferParams> = {
	type: "hl.classTransfer",
	kind: "hl",
	icon: ArrowDownUp,
	available: (env) => !!env.hl && !env.hl.unified,
	defaults: () => ({ amount: "", toPerp: true }),
	Form: ClassTransferForm,
	validate: (p, env, t): OpErrors => {
		const max = p.toPerp ? (env.hl?.spot.find((s) => s.token === 0)?.available ?? "0") : env.hl?.withdrawable;
		const a = amountError(p.amount, t, { decimals: 6, max });
		return a ? { amount: a } : {};
	},
	buildHl: (p) => ({ type: "usdClassTransfer", amount: trimDecimal(p.amount), toPerp: p.toPerp }),
	summary: (p, { t, lang }) => [
		{ label: t("ops.amount"), value: `${formatAmount(p.amount, lang)} USDC` },
		{ label: t("ops.direction"), value: t(p.toPerp ? "hl.spotToPerp" : "hl.perpToSpot") },
	],
};
