import { ArrowUpRight } from "lucide-react";
import { encodeFunctionData, getAddress, parseUnits } from "viem";
import { SafeSendForm } from "@/components/ops/safe/SafeSendForm";
import { findChain, getChain } from "@/config/chains";
import { formatAmount, isDecimal, sameAddress, trimDecimal } from "@/lib/format";
import { ERC20_ABI } from "@/lib/safe/abis";
import { formatUnits } from "viem";
import { knownContracts, recipientError, requireRecipient } from "@/lib/recipient";
import { useContractRecipient } from "../recipientNotices";
import type { OpDefinition } from "../types";

export interface SafeSendParams {
	/** Token contract; empty string – native coin. */
	token: string;
	symbol: string;
	decimals: number;
	recipient: string;
	amount: string;
}

/**
 * Contracts that cannot be the recipient of this send: the token itself and everything the app works
 * with on the network. One exception: the coin sent to its wrapped-token contract is not lost – the
 * contract credits the sender with the same amount of the wrapped token. That is how a coin is wrapped,
 * and it holds on every supported network (checked on forks). A token sent there would stay there.
 */
const notRecipients = (p: SafeSendParams, chainId: number | undefined): (string | undefined)[] => {
	const wrapped = findChain(chainId)?.wrappedNative;
	return [p.token, ...knownContracts(chainId).filter((c) => p.token !== "" || !sameAddress(c, wrapped))];
};

/** The send is the coin going to its wrapped-token contract: the Safe gets the wrapped token for it. */
const isWrap = (p: SafeSendParams, chainId: number | undefined): boolean =>
	p.token === "" && sameAddress(p.recipient, findChain(chainId)?.wrappedNative);

export const safeSendOp: OpDefinition<SafeSendParams> = {
	type: "safe.send",
	kind: "safe",
	icon: ArrowUpRight,
	available: (env) => !!env.safe,
	defaults: (env) => ({
		token: "",
		symbol: getChain(env.account.chainId as number).nativeSymbol,
		decimals: 18,
		recipient: "",
		amount: "",
	}),
	Form: SafeSendForm,
	// Wrapping aside, a contract as the recipient is worth a word.
	useNotices: (p, env) =>
		useContractRecipient(env.account.chainId, isWrap(p, env.account.chainId) ? "" : p.recipient, env),
	validate: (p, env, t) => {
		const errors: Record<string, string> = {};
		const r = recipientError(p.recipient, t, {
			self: env.account.address,
			contracts: notRecipients(p, env.account.chainId),
		});
		if (r) errors.recipient = r;
		const holding = env.safe?.holdings.find((h) => (h.token?.address ?? "") === p.token);
		if (!p.amount) errors.amount = t("error.required");
		else if (!isDecimal(p.amount, p.decimals) || Number(p.amount) <= 0) {
			errors.amount = t("amount.invalid", { decimals: p.decimals });
		} else if (holding && parseUnits(p.amount, p.decimals) > BigInt(holding.balance)) {
			errors.amount = t("amount.exceeds");
		}
		return errors;
	},
	buildSafe: (p, { chainId }) => {
		const amount = parseUnits(trimDecimal(p.amount), p.decimals);
		const recipient = requireRecipient(p.recipient, { contracts: notRecipients(p, chainId) });
		return p.token
			? [
					{
						to: getAddress(p.token),
						value: 0n,
						data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [recipient, amount] }),
					},
				]
			: [{ to: recipient, value: amount, data: "0x" }];
	},
	summary: (p, { t, lang, account }) => [
		{ label: t("ops.amount"), value: `${formatAmount(p.amount, lang, 8)} ${p.symbol}` },
		...(p.token ? [{ label: t("ops.tokenContract"), value: p.token, mono: true }] : []),
		{ label: t("ops.recipient"), address: getAddress(p.recipient), chainId: account.chainId },
		{ label: t("common.network"), value: getChain(account.chainId as number).name },
		...(isWrap(p, account.chainId)
			? [{ label: t("safe.send.wrap"), value: t("safe.send.wrapValue", { symbol: `W${p.symbol}` }) }]
			: []),
	],
};

export const holdingAmount = (balance: string, decimals: number): string => formatUnits(BigInt(balance), decimals);
