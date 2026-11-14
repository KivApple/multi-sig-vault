import type { Address } from "viem";
import type { BridgeKind, ChainConfig } from "@/config/chains";
import type { TFunc } from "@/i18n";
import type { SummaryRow } from "@/lib/ops/types";
import type { MetaTx } from "@/lib/safe/tx";
import type { SwapParams } from "../swapBuild";

/**
 * What a transfer arrives as on the other network, as the user names the choice: "USDC", "USDT",
 * "WETH"… The name is the same on both sides of a lane even where the tokens are called differently.
 */
export type ReceiveAsset = string;

/** One thing a bridge carries between two networks: a token here, and what it is over there. */
export interface Lane {
	receive: ReceiveAsset;
	/** The token that crosses, as it is on the source network. Anything else is swapped into it first. */
	token: Address;
	decimals: number;
	destToken: Address;
	destDecimals: number;
}

/** A lane and the bridge that offers it. */
export interface BridgeRoute extends Lane {
	kind: BridgeKind;
}

/** Everything a bridge needs to know about one transfer. */
export interface LegCtx {
	src: ChainConfig;
	dst: ChainConfig;
	lane: Lane;
	/** What crosses, raw units of `lane.token`. */
	amount: bigint;
	safe: Address;
	recipient: Address;
	/** The native coin itself is what crosses (it was not swapped): it can go as the value of a call. */
	coin: boolean;
}

/** A leg in the terms every bridge shares, for the quote and for the summary signers read. */
export interface LegView {
	/** What leaves the Safe into the bridge, raw units of the source token. */
	amount: string;
	/** What the bridge keeps, raw units of the source token. */
	fee: string;
	/** Shown next to the fee: the bridge's name, a speed, a mode. */
	feeNote: string;
	/** What the recipient gets, raw units of the destination token. */
	output: string;
	/** The destination's coin arrives as its wrapped token (the recipient is a contract). */
	wrapped?: boolean;
}

/** Progress of the cross-chain leg after sending, kept in `op.result.extra.bridge`. */
export interface BridgeProgress {
	stage: "burned" | "attested" | "credited";
	nonce?: string;
	attestedAt?: number;
	mintTxHash?: string;
	claimTxHash?: string;
	/** Nobody delivered the transfer: the funds are coming back (or are back) on the source network. */
	refund?: "expired" | "refunded";
	refundTxHash?: string;
}

/**
 * One bridge. To add a bridge: implement this, add it to `BRIDGES` (bridges/index.ts), give its leg
 * a field in `SwapResolved`, and its sent card and form options an entry in `BRIDGE_UI`.
 *
 * A bridge fits only if the app can build its transaction itself from the stored leg, and that
 * transaction stays valid for as long as signatures take: a quote that expires within the hour, or
 * calldata that only the bridge's API can produce, does not.
 */
// biome-ignore lint/suspicious/noExplicitAny: every bridge has its own leg, known to itself alone
export interface BridgeProvider<Leg = any> {
	id: BridgeKind;
	name: string;
	/** Where its leg is kept in `SwapResolved`. Never renamed: stored operations carry it. */
	legKey: "bridge" | "across";
	/** What it carries from `src` to `dst`. */
	lanes: (src: ChainConfig, dst: ChainConfig) => Lane[];
	/**
	 * Key of the error `resolve` throws when the bridge cannot carry the amount right now. The planner
	 * then looks for another bridge; without it such an error is final.
	 */
	limitError?: string;
	/** Network part: fees, limits, allowances – everything the transaction depends on, fixed in the leg. */
	resolve: (ctx: LegCtx, p: SwapParams) => Promise<Leg>;
	/**
	 * Pure. The calls the Safe makes for this leg; throws when the leg contradicts the transfer
	 * (another amount, a fee that does not add up or is beyond what the bridge may ask).
	 */
	build: (ctx: LegCtx, leg: Leg, p: SwapParams) => MetaTx[];
	/** What the leg makes arrive: the lane it was resolved for. */
	receiveOf: (leg: Leg) => ReceiveAsset;
	view: (leg: Leg, t: TFunc) => LegView;
	/** Rows of the summary only this bridge has, shown after the recipient. */
	summaryRows?: (leg: Leg, ctx: { src: ChainConfig; dst: ChainConfig; t: TFunc }) => SummaryRow[];
	/** The transfer still has something ahead of it on the other network. */
	unfinished: (progress: BridgeProgress | undefined) => boolean;
	/** Translation key of the warning before deleting the sent card, when deleting loses something. */
	deleteWarning?: (progress: BridgeProgress | undefined) => string | undefined;
	/** The contract the Safe calls, and the token that leaves through it: how history names a transfer. */
	target: (chain: ChainConfig) => Address | undefined;
	historyToken: (chain: ChainConfig) => Address | undefined;
}
