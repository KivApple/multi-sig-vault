import { encodeFunctionData, getAddress, isHex, pad, parseAbi, size, slice, type Address, type Hex } from "viem";
import { getChain, IRIS_API } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { getPublicClient } from "@/lib/rpc";

/**
 * Circle CCTP V2: burn USDC on the source chain, Circle attests the burn, USDC is minted on the
 * destination. With the Forwarding Service Circle submits the mint itself and takes its cost from
 * the transferred amount; without it anyone can submit `receiveMessage` on the destination.
 */
export const TOKEN_MESSENGER_ABI = parseAbi([
	"function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
	"function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
	"event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)",
]);

export const MESSAGE_TRANSMITTER_ABI = parseAbi([
	"function receiveMessage(bytes message, bytes attestation) returns (bool success)",
	"function usedNonces(bytes32 nonce) view returns (uint256)",
]);

/** `cctp-forward` right-padded to 24 bytes + uint32 version 0 + uint32 length 0. */
export const FORWARD_HOOK_DATA: Hex = "0x636374702d666f72776172640000000000000000000000000000000000000000";

export const FINALITY_FAST = 1000;
export const FINALITY_STANDARD = 2000;
export type Finality = typeof FINALITY_FAST | typeof FINALITY_STANDARD;
export type ForwardLevel = "low" | "med" | "high";

/** `burnLimitsPerMessage(USDC)` on every supported chain: 10M USDC. */
export const CCTP_BURN_LIMIT = 10_000_000_000_000n;
/** Forwarding fee above this (USDC units) is treated as a broken API answer, not as a price. */
const MAX_SANE_FORWARD_FEE = 100_000_000n;
const ZERO_BYTES32: Hex = `0x${"00".repeat(32)}`;

export const addressToBytes32 = (address: Address): Hex => pad(getAddress(address).toLowerCase() as Hex, { size: 32 });

export const bytes32ToAddress = (value: Hex): Address => getAddress(slice(value, 12, 32));

/**
 * Percentage fee in USDC units, rounded up. `bps` may be fractional (the API returns e.g. 1.4):
 * it is taken with 4 decimal places so the arithmetic stays in integers.
 */
export const bpsFee = (amount: bigint, bps: number): bigint => {
	if (!Number.isFinite(bps) || bps < 0) throw new Error("Invalid fee rate");
	const scaled = BigInt(Math.round(bps * 10_000));
	if (scaled === 0n) return 0n;
	const denominator = 100_000_000n;
	return (amount * scaled + denominator - 1n) / denominator;
};

export interface CctpFees {
	/** Minimum fee, basis points of the amount, for the requested finality. */
	minimumFeeBps: number;
	/** Cost of Circle submitting the mint (USDC units) per priority level. */
	forwardFee?: Record<ForwardLevel, bigint>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const toFeeUnits = (v: unknown): bigint => {
	if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new AppError("swap.error.feeApi");
	const fee = BigInt(v);
	if (fee > MAX_SANE_FORWARD_FEE) throw new AppError("swap.error.feeApi");
	return fee;
};

/** Validates the fees endpoint answer (untrusted input) and picks the entry for `finality`. */
export const parseCctpFees = (json: unknown, finality: Finality): CctpFees => {
	if (!Array.isArray(json)) throw new AppError("swap.error.feeApi");
	const entry = json.find((e) => isObject(e) && e.finalityThreshold === finality) as
		| Record<string, unknown>
		| undefined;
	if (!entry) throw new AppError("swap.error.feeApi");
	const bps = entry.minimumFee;
	// More than 1% would be an absurd bridge fee – refuse rather than sign it.
	if (typeof bps !== "number" || !Number.isFinite(bps) || bps < 0 || bps > 100) throw new AppError("swap.error.feeApi");
	const fees: CctpFees = { minimumFeeBps: bps };
	if (entry.forwardFee !== undefined) {
		if (!isObject(entry.forwardFee)) throw new AppError("swap.error.feeApi");
		fees.forwardFee = {
			low: toFeeUnits(entry.forwardFee.low),
			med: toFeeUnits(entry.forwardFee.med),
			high: toFeeUnits(entry.forwardFee.high),
		};
	}
	return fees;
};

const irisBase = (chainId: number): string => IRIS_API[getChain(chainId).env];

const cctpOf = (chainId: number): NonNullable<ReturnType<typeof getChain>["cctp"]> => {
	const cctp = getChain(chainId).cctp;
	if (!cctp) throw new AppError("swap.error.noBridge");
	return cctp;
};

export const fetchCctpFees = async (
	srcChainId: number,
	dstChainId: number,
	finality: Finality,
	forward: boolean,
): Promise<CctpFees> => {
	const url = `${irisBase(srcChainId)}/v2/burn/USDC/fees/${cctpOf(srcChainId).domain}/${cctpOf(dstChainId).domain}${
		forward ? "?forward=true" : ""
	}`;
	const res = await fetch(url, { referrerPolicy: "no-referrer" });
	if (!res.ok) throw new AppError("swap.error.feeApi");
	const fees = parseCctpFees(await res.json(), finality);
	if (forward && !fees.forwardFee) throw new AppError("swap.error.noForward");
	return fees;
};

export interface BurnArgs {
	amount: bigint;
	dstChainId: number;
	recipient: Address;
	usdc: Address;
	maxFee: bigint;
	finality: Finality;
	forward: boolean;
}

/** Calldata of the burn on TokenMessengerV2. `destinationCaller` is zero so anyone can relay. */
export const encodeBurn = (a: BurnArgs): Hex => {
	const common = [
		a.amount,
		cctpOf(a.dstChainId).domain,
		addressToBytes32(a.recipient),
		a.usdc,
		ZERO_BYTES32,
		a.maxFee,
		a.finality,
	] as const;
	return a.forward
		? encodeFunctionData({
				abi: TOKEN_MESSENGER_ABI,
				functionName: "depositForBurnWithHook",
				args: [...common, FORWARD_HOOK_DATA],
			})
		: encodeFunctionData({ abi: TOKEN_MESSENGER_ABI, functionName: "depositForBurn", args: common });
};

export interface CctpMessage {
	/** Attested message bytes; `undefined` until Circle has signed it. */
	message?: Hex;
	attestation?: Hex;
	nonce?: Hex;
	complete: boolean;
	forwardState?: string;
	mintTxHash?: Hex;
	/** Fast transfers expire; `0n` – never. */
	expirationBlock: bigint;
}

export interface ExpectedTransfer {
	srcChainId: number;
	dstChainId: number;
	sender: Address;
	recipient: Address;
}

const HEADER_LENGTH = 148;
const BODY_MIN_LENGTH = 228;

/**
 * Checks attested message bytes against what the operation signed: route, sender and recipient.
 * Returns the burn body fields, or `undefined` when the message is some other transfer.
 */
export const matchMessage = (message: Hex, expected: ExpectedTransfer): { expirationBlock: bigint } | undefined => {
	if (!isHex(message) || size(message) < HEADER_LENGTH + BODY_MIN_LENGTH) return undefined;
	const u32 = (start: number): number => Number.parseInt(slice(message, start, start + 4).slice(2), 16);
	if (u32(4) !== cctpOf(expected.srcChainId).domain || u32(8) !== cctpOf(expected.dstChainId).domain) return undefined;
	const body = HEADER_LENGTH;
	const mintRecipient = slice(message, body + 36, body + 68);
	const messageSender = slice(message, body + 100, body + 132);
	if (mintRecipient.toLowerCase() !== addressToBytes32(expected.recipient).toLowerCase()) return undefined;
	if (messageSender.toLowerCase() !== addressToBytes32(expected.sender).toLowerCase()) return undefined;
	return { expirationBlock: BigInt(slice(message, body + 196, body + 228)) };
};

const hexOf = (v: unknown, bytes?: number): Hex | undefined =>
	typeof v === "string" && isHex(v) && v.length > 2 && (bytes === undefined || size(v) === bytes) ? v : undefined;

/** Picks our transfer out of the messages endpoint answer (untrusted input). */
export const parseCctpMessages = (json: unknown, expected: ExpectedTransfer): CctpMessage | undefined => {
	if (!isObject(json) || !Array.isArray(json.messages)) return undefined;
	let pending: CctpMessage | undefined;
	for (const m of json.messages) {
		if (!isObject(m)) continue;
		const message = hexOf(m.message);
		const attestation = hexOf(m.attestation);
		const matched = message ? matchMessage(message, expected) : undefined;
		if (message && !matched) continue;
		const entry: CctpMessage = {
			message: matched ? message : undefined,
			attestation: matched ? attestation : undefined,
			nonce: hexOf(m.eventNonce, 32),
			complete: m.status === "complete" && !!matched && !!attestation,
			forwardState: typeof m.forwardState === "string" ? m.forwardState.slice(0, 32) : undefined,
			mintTxHash: hexOf(m.destinationMintTxHash, 32) ?? hexOf(m.forwardTxHash, 32),
			expirationBlock: matched?.expirationBlock ?? 0n,
		};
		if (matched) return entry;
		pending ??= entry;
	}
	return pending;
};

/** Attestation state of the burn made in `txHash`; `undefined` – Circle has not indexed it yet. */
export const fetchCctpMessage = async (txHash: Hex, expected: ExpectedTransfer): Promise<CctpMessage | undefined> => {
	const url = `${irisBase(expected.srcChainId)}/v2/messages/${cctpOf(expected.srcChainId).domain}?transactionHash=${txHash}`;
	const res = await fetch(url, { referrerPolicy: "no-referrer" });
	if (res.status === 404) return undefined;
	if (!res.ok) throw new AppError("swap.error.attestationApi");
	return parseCctpMessages(await res.json(), expected);
};

/** Asks Circle to re-sign an expired fast-transfer attestation. */
export const requestReattest = async (srcChainId: number, nonce: Hex): Promise<void> => {
	const res = await fetch(`${irisBase(srcChainId)}/v2/reattest/${nonce}`, {
		method: "POST",
		referrerPolicy: "no-referrer",
	});
	if (!res.ok) throw new AppError("swap.error.attestationApi");
};

export const isNonceUsed = async (dstChainId: number, nonce: Hex): Promise<boolean> => {
	const used = await getPublicClient(dstChainId).readContract({
		address: cctpOf(dstChainId).messageTransmitter,
		abi: MESSAGE_TRANSMITTER_ABI,
		functionName: "usedNonces",
		args: [nonce],
	});
	return used !== 0n;
};

export const encodeReceiveMessage = (message: Hex, attestation: Hex): Hex =>
	encodeFunctionData({ abi: MESSAGE_TRANSMITTER_ABI, functionName: "receiveMessage", args: [message, attestation] });

export const messageTransmitterOf = (chainId: number): Address => cctpOf(chainId).messageTransmitter;
export const tokenMessengerOf = (chainId: number): Address => cctpOf(chainId).tokenMessenger;
