import { ArrowLeftRight, FolderPen, FolderPlus } from "lucide-react";
import { CreateSubForm } from "@/components/ops/hl/CreateSubForm";
import { RenameSubForm } from "@/components/ops/hl/RenameSubForm";
import { SubTransferForm } from "@/components/ops/hl/SubTransferForm";
import { formatAmount, trimDecimal } from "@/lib/format";
import { SUB_ACCOUNT_MIN_VOLUME } from "@/lib/hl/account";
import type { OpDefinition, OpErrors } from "../types";
import { amountError, nameError } from "./common";

export interface CreateSubParams {
	name: string;
}

export const createSubOp: OpDefinition<CreateSubParams> = {
	type: "hl.createSub",
	kind: "hl",
	icon: FolderPlus,
	hlSigning: "l1",
	available: (env) => (env.hlExtras?.volume ?? 0) >= SUB_ACCOUNT_MIN_VOLUME,
	defaults: () => ({ name: "" }),
	Form: CreateSubForm,
	validate: (p, _env, t): OpErrors => {
		const n = nameError(p.name, t);
		return n ? { name: n } : {};
	},
	buildHl: (p) => ({ type: "createSubAccount", name: p.name.trim() }),
	summary: (p, { t }) => [{ label: t("common.name"), value: p.name.trim() }],
};

export interface RenameSubParams {
	subAccountUser: string;
	oldName: string;
	name: string;
}

export const renameSubOp: OpDefinition<RenameSubParams> = {
	type: "hl.renameSub",
	kind: "hl",
	icon: FolderPen,
	hlSigning: "l1",
	available: (env) => (env.hlExtras?.subAccounts.length ?? 0) > 0,
	defaults: (env) => {
		const first = env.hlExtras?.subAccounts[0];
		return { subAccountUser: first?.address ?? "", oldName: first?.name ?? "", name: "" };
	},
	Form: RenameSubForm,
	validate: (p, _env, t) => {
		const errors: Record<string, string> = {};
		if (!p.subAccountUser) errors.subAccountUser = t("error.required");
		const n = nameError(p.name, t);
		if (n) errors.name = n;
		return errors;
	},
	buildHl: (p) => ({ type: "subAccountModify", subAccountUser: p.subAccountUser.toLowerCase(), name: p.name.trim() }),
	summary: (p, { t }) => [
		{ label: t("hl.sub.account"), value: p.oldName },
		{ label: t("hl.sub.newName"), value: p.name.trim() },
	],
};

export interface SubTransferParams {
	subAccountUser: string;
	subName: string;
	/** `true` – main → sub-account. */
	deposit: boolean;
	/** `perp` – perp USDC balance; otherwise a spot token index (as string). */
	asset: string;
	/** `NAME:0xTokenId`. */
	tokenRef: string;
	coin: string;
	amount: string;
}

export const subTransferOp: OpDefinition<SubTransferParams> = {
	type: "hl.subTransfer",
	kind: "hl",
	icon: ArrowLeftRight,
	available: (env) => !!env.hl && (env.hlExtras?.subAccounts.length ?? 0) > 0,
	defaults: (env) => {
		const first = env.hlExtras?.subAccounts[0];
		const unified = !!env.hl?.unified;
		return {
			subAccountUser: first?.address ?? "",
			subName: first?.name ?? "",
			deposit: true,
			asset: unified ? "0" : "perp",
			tokenRef: env.hl?.usdcToken ?? "",
			coin: "USDC",
			amount: "",
		};
	},
	Form: SubTransferForm,
	validate: (p, env, t) => {
		const errors: Record<string, string> = {};
		if (!p.subAccountUser) errors.subAccountUser = t("error.required");
		if (!p.tokenRef) errors.asset = t("error.required");
		const sub = env.hlExtras?.subAccounts.find((s) => s.address === p.subAccountUser);
		let max: string | undefined;
		if (p.asset === "perp") max = p.deposit ? env.hl?.withdrawable : sub?.withdrawable;
		else if (p.deposit) max = env.hl?.spot.find((s) => String(s.token) === p.asset)?.available;
		else max = sub?.spot.find((s) => String(s.token) === p.asset)?.total;
		const a = amountError(p.amount, t, { decimals: p.asset === "perp" ? 6 : 8, max });
		if (a) errors.amount = a;
		return errors;
	},
	// `sendAsset` is a user-signed action, so – unlike the legacy sub-account transfer – MetaMask can sign it.
	buildHl: (p, { user }) => {
		const dex = p.asset === "perp" ? "" : "spot";
		return {
			type: "sendAsset",
			destination: (p.deposit ? p.subAccountUser : user).toLowerCase(),
			sourceDex: dex,
			destinationDex: dex,
			token: p.tokenRef,
			amount: trimDecimal(p.amount),
			fromSubAccount: p.deposit ? "" : p.subAccountUser.toLowerCase(),
		};
	},
	summary: (p, { t, lang }) => [
		{
			label: t("ops.amount"),
			value: `${formatAmount(p.amount, lang, 8)} ${p.coin}${p.asset === "perp" ? ` (${t("hl.perps")})` : ""}`,
		},
		{ label: t("ops.direction"), value: t(p.deposit ? "hl.sub.toSub" : "hl.sub.fromSub", { name: p.subName }) },
	],
};
