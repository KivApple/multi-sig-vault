import { encodeFunctionData, getAddress } from "viem";
import { ACROSS_ASSETS, type AcrossAsset } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { sameAddress } from "@/lib/format";
import { getPublicClient } from "@/lib/rpc";
import { ERC20_ABI } from "@/lib/safe/abis";
import type { MetaTx } from "@/lib/safe/tx";
import {
	ACROSS_FILL_SECONDS,
	ACROSS_MAX_FILL_SECONDS,
	ACROSS_MIN_FILL_SECONDS,
	ACROSS_GAS_RESERVE,
	acrossFee,
	acrossFeeLimit,
	acrossGasCost,
	acrossIntegrator,
	encodeAcrossDeposit,
	fetchAcrossQuote,
	isIntegratorId,
	scaleUnits,
} from "../across";
import { mismatch } from "../mismatch";
import type { BridgeProvider, Lane } from "./types";

/** A token sent through Across, arriving as the same asset. Kept in `SwapResolved.across`. */
export interface AcrossLeg {
	asset: AcrossAsset;
	/** What is escrowed on the source chain, raw units of the source token. */
	amount: string;
	/** What the recipient gets, raw units of the destination token (its decimals may differ). */
	output: string;
	/** What the bridge keeps, raw units of the source token. */
	fee: string;
	/** Seconds relayers have to fill, counted from the block that executes the deposit. */
	fillDeadlineOffset: number;
	/**
	 * Part of `fee`, raw units of the source token: left to the relayer on top of the quote, so that the
	 * transfer is still worth delivering if gas grows while signatures are collected.
	 */
	reserve?: string;
	/** The token needs its allowance zeroed first (USDT-style approve). */
	resetAllowance: boolean;
	/**
	 * ETH only, and only for display: the recipient had no code on the destination network when the
	 * operation was prepared, so the bridge pays it the coin itself; a contract gets the wrapped token.
	 */
	unwrap?: boolean;
	/**
	 * Two bytes that mark the deposit as made by this app, appended to its calldata. Kept with the
	 * operation, so that any build of the app rebuilds the same transaction.
	 */
	integrator?: string;
}

const assetOf = (lane: Lane): AcrossAsset | undefined => ACROSS_ASSETS.find((a) => a === lane.receive);
const sides = (lane: Lane) => ({
	src: { address: lane.token, decimals: lane.decimals },
	dst: { address: lane.destToken, decimals: lane.destDecimals },
});

export const acrossBridge: BridgeProvider<AcrossLeg> = {
	id: "across",
	name: "Across",
	legKey: "across",
	// An asset both networks list crosses as itself.
	lanes: (src, dst) => {
		const a = src.across?.tokens;
		const b = dst.across?.tokens;
		if (!a || !b) return [];
		return ACROSS_ASSETS.flatMap((asset) => {
			const from = a[asset];
			const to = b[asset];
			return from && to
				? [
						{
							receive: asset,
							token: from.address,
							decimals: from.decimals,
							destToken: to.address,
							destDecimals: to.decimals,
						},
					]
				: [];
		});
	},
	// Across carries what its relayers hold on the destination.
	limitError: "swap.error.acrossLimit",
	resolve: async ({ src, dst, lane, amount, safe, recipient, coin }, p) => {
		const asset = assetOf(lane);
		const pool = src.across?.spokePool;
		if (!asset || !pool) return mismatch();
		const side = sides(lane);
		const [quoted, gas] = await Promise.all([
			fetchAcrossQuote(src.id, dst.id, asset, amount),
			acrossGasCost(dst.id, side.dst, side.src),
		]);
		// The bridge's quote is judged against the gas price of the destination as the app reads it.
		const quotedFee = acrossFee(amount, quoted, side.src, side.dst);
		if (quotedFee > acrossFeeLimit(amount, gas)) {
			throw new AppError("swap.error.acrossFee", { network: dst.name });
		}
		// The quote fits today's gas. Signatures take time and gas may rise meanwhile: unless asked not
		// to, the relayer is left room for twice more – cents on most networks.
		const reserve = p.acrossReserve === false ? 0n : gas * (ACROSS_GAS_RESERVE - 1n);
		const output = quoted - scaleUnits(reserve, side.src.decimals, side.dst.decimals);
		if (output <= 0n) throw new AppError("swap.error.belowFee");
		const fee = acrossFee(amount, output, side.src, side.dst);
		// The coin itself is deposited as the value of the call: nothing to approve.
		let resetAllowance = false;
		if (!coin) {
			const allowance = await getPublicClient(src.id).readContract({
				address: lane.token,
				abi: ERC20_ABI,
				functionName: "allowance",
				args: [safe, pool],
			});
			resetAllowance = allowance > 0n;
		}
		// Where the token is the destination's wrapped coin, the bridge unwraps it for a plain address.
		let unwrap: boolean | undefined;
		if (sameAddress(lane.destToken, dst.wrappedNative)) {
			unwrap = await getPublicClient(dst.id)
				.getCode({ address: recipient })
				.then(
					// A plain address, or one that only delegates (EIP-7702): the pool tells them apart the same way.
					(code) => !code || code === "0x" || code.toLowerCase().startsWith("0xef0100"),
					() => undefined,
				);
		}
		return {
			asset,
			amount: amount.toString(),
			output: output.toString(),
			fee: fee.toString(),
			reserve: fee > quotedFee ? (fee - quotedFee).toString() : undefined,
			fillDeadlineOffset: ACROSS_FILL_SECONDS,
			resetAllowance,
			unwrap,
			integrator: acrossIntegrator(),
		};
	},
	build: ({ src, dst, lane, amount: crossing, safe, recipient, coin }, leg) => {
		const pool = src.across?.spokePool;
		if (!pool || leg.asset !== assetOf(lane)) return mismatch();
		const side = sides(lane);
		const amount = BigInt(leg.amount);
		const output = BigInt(leg.output);
		if (amount !== crossing || output <= 0n) return mismatch();
		// The fee shown is the fee taken. Whether it is a fair one was judged against the gas price when it
		// was quoted, and is judged again by every signer's card – not here, where nothing can be asked.
		const fee = acrossFee(amount, output, side.src, side.dst);
		if (fee < 0n || fee.toString() !== leg.fee) return mismatch();
		if (leg.reserve !== undefined && !(/^\d{1,60}$/.test(leg.reserve) && BigInt(leg.reserve) <= fee)) {
			return mismatch();
		}
		const offset = leg.fillDeadlineOffset;
		if (!Number.isInteger(offset) || offset < ACROSS_MIN_FILL_SECONDS || offset > ACROSS_MAX_FILL_SECONDS) {
			return mismatch();
		}
		if (leg.integrator !== undefined && !isIntegratorId(leg.integrator)) return mismatch();
		const calls: MetaTx[] = [];
		// The coin goes in as the value of the call and the pool wraps it; a token is approved first.
		if (coin) {
			if (leg.resetAllowance) return mismatch();
		} else {
			const approve = (value: bigint): MetaTx => ({
				to: lane.token,
				value: 0n,
				data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [pool, value] }),
			});
			if (leg.resetAllowance) calls.push(approve(0n));
			calls.push(approve(amount));
		}
		calls.push({
			to: pool,
			value: coin ? amount : 0n,
			data: encodeAcrossDeposit({
				safe: getAddress(safe),
				recipient,
				srcChainId: src.id,
				dstChainId: dst.id,
				asset: leg.asset,
				amount,
				output,
				fillDeadlineOffset: offset,
				integrator: leg.integrator,
			}),
		});
		return calls;
	},
	receiveOf: (leg) => leg.asset,
	view: (leg, t) => ({
		amount: leg.amount,
		fee: leg.fee,
		feeNote: leg.reserve ? `Across · ${t("swap.across.withReserve")}` : "Across",
		output: leg.output,
		wrapped: leg.unwrap === false,
	}),
	summaryRows: (_leg, { src, t }) => [
		{ label: t("swap.sum.undelivered"), value: t("swap.sum.undeliveredValue", { network: src.name }) },
	],
	// A transfer nobody delivered ends with the refund on the source network.
	unfinished: (progress) => progress?.stage !== "credited" && progress?.refund !== "refunded",
	target: (chain) => chain.across?.spokePool,
	historyToken: (chain) => chain.across?.tokens.USDT?.address,
};
