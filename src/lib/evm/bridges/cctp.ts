import { encodeFunctionData } from "viem";
import { ERC20_ABI } from "@/lib/safe/abis";
import { AppError } from "@/lib/errors";
import {
	bpsFee,
	CCTP_BURN_LIMIT,
	encodeBurn,
	fetchCctpFees,
	FINALITY_FAST,
	FINALITY_STANDARD,
	type Finality,
} from "../cctp";
import { mismatch } from "../mismatch";
import type { BridgeProvider } from "./types";

export const USDC_DECIMALS = 6;

/** USDC burned here and minted there by Circle. Kept in `SwapResolved.bridge`. */
export interface BridgeLeg {
	/** USDC burned on the source chain, raw units. */
	amount: string;
	/** Exact `maxFee` of the burn: forwarding fee + percentage fee. */
	maxFee: string;
	forwardFee: string;
	percentFee: string;
	finality: Finality;
	forward: boolean;
	/** USDC the recipient gets on the destination chain (amount − maxFee). */
	receive: string;
}

/** Circle does not offer fast transfers for burns on HyperEVM and on Polygon. */
export const fastAvailable = (chainKey: string): boolean => chainKey !== "hyperevm" && chainKey !== "polygon";

export const cctpBridge: BridgeProvider<BridgeLeg> = {
	id: "cctp",
	name: "Circle CCTP",
	legKey: "bridge",
	lanes: (src, dst) =>
		src.cctp && dst.cctp && src.usdc && dst.usdc
			? [
					{
						receive: "USDC",
						token: src.usdc,
						decimals: USDC_DECIMALS,
						destToken: dst.usdc,
						destDecimals: USDC_DECIMALS,
					},
				]
			: [],
	resolve: async ({ src, dst, amount }, p) => {
		const finality = fastAvailable(src.key) && p.speed === "fast" ? FINALITY_FAST : FINALITY_STANDARD;
		const fees = await fetchCctpFees(src.id, dst.id, finality, p.forward);
		const percentFee = bpsFee(amount, fees.minimumFeeBps);
		const forwardFee = p.forward && fees.forwardFee ? fees.forwardFee[p.forwardLevel] : 0n;
		// Exactly what the API quotes: with forwarding the whole maxFee is consumed, so no buffer.
		const maxFee = percentFee + forwardFee;
		if (amount > CCTP_BURN_LIMIT) throw new AppError("swap.error.burnLimit");
		if (amount <= maxFee) throw new AppError("swap.error.belowFee");
		return {
			amount: amount.toString(),
			maxFee: maxFee.toString(),
			forwardFee: forwardFee.toString(),
			percentFee: percentFee.toString(),
			finality,
			forward: p.forward,
			receive: (amount - maxFee).toString(),
		};
	},
	build: ({ src, dst, lane, amount: crossing, recipient }, leg, p) => {
		const messenger = src.cctp?.tokenMessenger;
		if (!messenger) return mismatch();
		const amount = BigInt(leg.amount);
		const maxFee = BigInt(leg.maxFee);
		if (amount !== crossing || maxFee >= amount || maxFee < 0n) return mismatch();
		if (maxFee !== BigInt(leg.forwardFee) + BigInt(leg.percentFee)) return mismatch();
		if ((amount - maxFee).toString() !== leg.receive || leg.forward !== p.forward) return mismatch();
		if (leg.finality !== FINALITY_FAST && leg.finality !== FINALITY_STANDARD) return mismatch();
		if (!leg.forward && BigInt(leg.forwardFee) !== 0n) return mismatch();
		return [
			{
				to: lane.token,
				value: 0n,
				data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [messenger, amount] }),
			},
			{
				to: messenger,
				value: 0n,
				data: encodeBurn({
					amount,
					dstChainId: dst.id,
					recipient,
					usdc: lane.token,
					maxFee,
					finality: leg.finality,
					forward: leg.forward,
				}),
			},
		];
	},
	receiveOf: () => "USDC",
	view: (leg, t) => ({
		amount: leg.amount,
		fee: leg.maxFee,
		feeNote: `${t(leg.finality === FINALITY_FAST ? "swap.speed.fast" : "swap.speed.standard")}${
			leg.forward ? "" : ` · ${t("swap.sum.selfMint")}`
		}`,
		output: leg.receive,
	}),
	unfinished: (progress) => progress?.stage !== "credited",
	// Deleting the card loses the button that credits the transfer by hand.
	deleteWarning: (progress) => (progress?.stage === "credited" ? undefined : "swap.deleteWarning"),
	target: (chain) => chain.cctp?.tokenMessenger,
	historyToken: (chain) => chain.usdc,
};
