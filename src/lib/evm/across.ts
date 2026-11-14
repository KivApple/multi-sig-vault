import { concat, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { getChain, type AcrossAsset, type AcrossToken, type ChainConfig } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { sameAddress } from "@/lib/format";
import { addressToBytes32 } from "./cctp";

/**
 * Across: the Safe escrows a token in the SpokePool of the source network and names the amount the
 * recipient must get on the destination; a relayer pays that out within seconds and is repaid from
 * the escrow. A deposit nobody fills before its deadline is refunded to the Safe on the source network.
 *
 * The deposit is made with `depositNow`: the contract takes the quote time and the deadline from the
 * block that executes it, so a transaction signed over hours or days is as valid as a fresh one.
 * That is why the calldata the bridge's API offers is not used: it carries a quote time that the
 * contract accepts for one hour only.
 */
export const SPOKE_POOL_ABI = parseAbi([
	"function depositNow(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 fillDeadlineOffset, uint32 exclusivityParameter, bytes message) payable",
	"event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)",
]);

export const ACROSS_API = "https://app.across.to/api";
/** Seconds a relayer has to fill after the deposit is mined; the contracts refuse more than six hours. */
export const ACROSS_MIN_FILL_SECONDS = 1800;
export const ACROSS_MAX_FILL_SECONDS = 21_600;
/** What the bridge itself gives its deposits: two hours. */
export const ACROSS_FILL_SECONDS = 7200;
const ZERO_BYTES32: Hex = `0x${"00".repeat(32)}`;
/**
 * The quote endpoint wants to know who deposits, to report that address' balance and allowance.
 * Neither is used here, so the Safe's address is not sent with a mere quote.
 */
const QUOTE_DEPOSITOR: Address = "0x000000000000000000000000000000000000dEaD";

/**
 * An API key raises the bridge's rate limits. It is optional, set at build time, and – this being
 * a web page – readable by anyone who looks: it identifies the app, it does not protect anything.
 */
const API_KEY = import.meta.env.PUBLIC_ACROSS_API_KEY?.trim();

/** The two bytes Across gave the app to mark its transfers with. */
export const isIntegratorId = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-f]{4}$/.test(v);
/** Marker Across looks for at the very end of a deposit's calldata, right before the id. */
const INTEGRATOR_MARKER: Hex = "0x1dc0de";

/** The integrator id of this build, if it was given one. */
export const acrossIntegrator = (): Hex | undefined => {
	const id = import.meta.env.PUBLIC_ACROSS_INTEGRATOR_ID?.trim().toLowerCase();
	return isIntegratorId(id) ? id : undefined;
};
const request = (path: string): Promise<Response> =>
	fetch(`${ACROSS_API}${path}`, {
		referrerPolicy: "no-referrer",
		headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
	});

export const spokePoolOf = (chainId: number): Address => {
	const across = getChain(chainId).across;
	if (!across) throw new AppError("swap.error.noBridge");
	return across.spokePool;
};

/** The token an asset is on a network. */
export const acrossToken = (chainId: number, asset: AcrossAsset): AcrossToken => {
	const token = getChain(chainId).across?.tokens[asset];
	if (!token) throw new AppError("swap.error.noBridge");
	return token;
};

/** `amount` of a token with `from` decimals in units of one with `to` decimals, rounded down. */
export const scaleUnits = (amount: bigint, from: number, to: number): bigint =>
	to >= from ? amount * 10n ** BigInt(to - from) : amount / 10n ** BigInt(from - to);

/** What the bridge keeps, in units of the token sent: the amount sent minus what the recipient gets. */
export const acrossFee = (amount: bigint, output: bigint, src: AcrossToken, dst: AcrossToken): bigint =>
	amount - scaleUnits(output, dst.decimals, src.decimals);

/** About five dollars of each asset, as a fraction of one unit: what a relayer's gas may cost on a busy day. */
const FEE_FLOOR: Record<AcrossAsset, [bigint, bigint]> = {
	USDT: [5n, 1n],
	WETH: [2n, 1000n],
	WBTC: [5n, 100_000n],
};

/**
 * The most the bridge may keep: 1% of the amount plus about five dollars for the relayer's gas. The
 * quote comes from an API; an answer above this is treated as broken, and a transaction above it is never built.
 */
export const acrossFeeCap = (amount: bigint, asset: AcrossAsset, src: AcrossToken): bigint => {
	const [n, d] = FEE_FLOOR[asset];
	return amount / 100n + (n * 10n ** BigInt(src.decimals)) / d;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const toUnits = (v: unknown): bigint | undefined =>
	typeof v === "string" && /^\d{1,60}$/.test(v) ? BigInt(v) : undefined;
const sameToken = (v: unknown, address: Address, decimals: number): boolean =>
	isObject(v) && typeof v.address === "string" && sameAddress(v.address, address) && v.decimals === decimals;

/**
 * What the recipient gets, in units of the destination token, from the Swap API's answer (untrusted
 * input). Only that one number is taken from it, after checking that the answer is about this very
 * route: the transaction itself is built here, not copied from the API (see `encodeAcrossDeposit`).
 */
export const parseAcrossQuote = (
	json: unknown,
	src: ChainConfig,
	dst: ChainConfig,
	asset: AcrossAsset,
	amount: bigint,
): bigint => {
	const a = src.across?.tokens[asset];
	const b = dst.across?.tokens[asset];
	const pool = src.across?.spokePool;
	if (!a || !b || !pool) throw new AppError("swap.error.noBridge");
	const bad = (): never => {
		throw new AppError("swap.error.acrossApi");
	};
	if (!isObject(json) || !isObject(json.steps)) return bad();
	// A plain transfer of the token through Across' own pools: no swap on either side, no other bridge.
	const steps = Object.keys(json.steps);
	const bridge = json.steps.bridge;
	if (steps.length !== 1 || !isObject(bridge)) return bad();
	// Above what its relayers hold the API offers a slower bridge of another kind: not this route.
	if (bridge.provider !== "across") throw new AppError("swap.error.acrossLimit");
	if (toUnits(bridge.inputAmount) !== amount) return bad();
	if (!sameToken(bridge.tokenIn, a.address, a.decimals) || !sameToken(bridge.tokenOut, b.address, b.decimals)) {
		return bad();
	}
	// The API's own transaction goes to the pool this app knows; an answer about another contract is not about this route.
	const tx = json.swapTx;
	if (!isObject(tx) || typeof tx.to !== "string" || !sameAddress(tx.to, pool)) return bad();
	const output = toUnits(bridge.outputAmount);
	if (output === undefined) return bad();
	if (output <= 0n) throw new AppError("swap.error.belowFee");
	const fee = acrossFee(amount, output, a, b);
	if (fee < 0n || fee > acrossFeeCap(amount, asset, a)) return bad();
	return output;
};

/** Asks the bridge what the recipient would get for `amount` right now. */
export const fetchAcrossQuote = async (
	srcChainId: number,
	dstChainId: number,
	asset: AcrossAsset,
	amount: bigint,
): Promise<bigint> => {
	const src = getChain(srcChainId);
	const dst = getChain(dstChainId);
	const query = new URLSearchParams({
		tradeType: "exactInput",
		amount: amount.toString(),
		inputToken: acrossToken(srcChainId, asset).address,
		outputToken: acrossToken(dstChainId, asset).address,
		originChainId: String(srcChainId),
		destinationChainId: String(dstChainId),
		depositor: QUOTE_DEPOSITOR,
	});
	const integrator = acrossIntegrator();
	if (integrator) query.set("integratorId", integrator);
	const res = await request(`/swap/approval?${query.toString()}`);
	const json: unknown = await res.json().catch(() => undefined);
	if (!res.ok) {
		// The API refuses what the route cannot carry with a 400 and a code.
		const code = isObject(json) ? json.code : undefined;
		if (code === "AMOUNT_TOO_LOW") throw new AppError("swap.error.belowFee");
		const message = isObject(json) && typeof json.message === "string" ? json.message : "";
		// Said in two ways: a code, or a relayer that "doesn't have enough funds".
		if (code === "AMOUNT_TOO_HIGH" || /enough funds|liquidity/i.test(message)) {
			throw new AppError("swap.error.acrossLimit");
		}
		throw new AppError("swap.error.acrossApi");
	}
	return parseAcrossQuote(json, src, dst, asset, amount);
};

export interface AcrossDepositArgs {
	safe: Address;
	recipient: Address;
	srcChainId: number;
	dstChainId: number;
	asset: AcrossAsset;
	amount: bigint;
	output: bigint;
	fillDeadlineOffset: number;
	/** Appended after the call's own data, where the contract does not look and Across' indexer does. */
	integrator?: Hex;
}

/**
 * Calldata of the deposit. No exclusive relayer and no message: anyone may fill, and the recipient just
 * gets the token. The native coin is deposited as its wrapped token, with the amount sent as the call's value.
 */
export const encodeAcrossDeposit = (a: AcrossDepositArgs): Hex => {
	const call = encodeFunctionData({
		abi: SPOKE_POOL_ABI,
		functionName: "depositNow",
		args: [
			// The depositor is who gets the refund of a deposit nobody filled.
			addressToBytes32(a.safe),
			addressToBytes32(a.recipient),
			addressToBytes32(acrossToken(a.srcChainId, a.asset).address),
			addressToBytes32(acrossToken(a.dstChainId, a.asset).address),
			a.amount,
			a.output,
			BigInt(a.dstChainId),
			ZERO_BYTES32,
			a.fillDeadlineOffset,
			0,
			"0x",
		],
	});
	return a.integrator ? concat([call, INTEGRATOR_MARKER, a.integrator]) : call;
};

export type AcrossState = "pending" | "filled" | "expired" | "refunded";

export interface AcrossStatus {
	state: AcrossState;
	fillTxHash?: Hex;
	refundTxHash?: Hex;
}

const txHash = (v: unknown): Hex | undefined =>
	typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v) ? (v as Hex) : undefined;

/** Reads the status endpoint's answer (untrusted input); `undefined` when it is not about this transfer. */
export const parseAcrossStatus = (json: unknown, srcChainId: number, dstChainId: number): AcrossStatus | undefined => {
	if (!isObject(json)) return undefined;
	if (Number(json.originChainId) !== srcChainId || Number(json.destinationChainId) !== dstChainId) return undefined;
	const state = json.status;
	if (state !== "pending" && state !== "filled" && state !== "expired" && state !== "refunded") return undefined;
	return {
		state,
		fillTxHash: txHash(json.fillTxnRef) ?? txHash(json.fillTx),
		refundTxHash: txHash(json.depositRefundTxnRef) ?? txHash(json.depositRefundTxHash),
	};
};

/** Where a deposit is, by the transaction that made it; `undefined` until the bridge has indexed it. */
export const fetchAcrossStatus = async (
	depositTxHash: Hex,
	srcChainId: number,
	dstChainId: number,
): Promise<AcrossStatus | undefined> => {
	const res = await request(`/deposit/status?depositTxnRef=${depositTxHash}`);
	if (res.status === 404) return undefined;
	if (!res.ok) throw new Error(`Across status: HTTP ${res.status}`);
	return parseAcrossStatus(await res.json(), srcChainId, dstChainId);
};
