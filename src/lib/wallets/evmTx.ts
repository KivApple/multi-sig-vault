import {
	recoverTransactionAddress,
	serializeTransaction,
	type Address,
	type Hex,
	type TransactionSerializable,
	type TransactionSerialized,
} from "viem";
import { findChain } from "@/config/chains";
import { errorText, WalletError } from "@/lib/errors";
import { sameAddress } from "@/lib/format";
import { getBroadcastClient, getPublicClient } from "@/lib/rpc";
import type { TxRequest } from "./types";

/**
 * Transaction building and broadcasting shared by hardware wallets
 * (MetaMask builds and broadcasts by itself).
 */
export type PreparedTx = TransactionSerializable & {
	chainId: number;
	nonce: number;
	gas: bigint;
	to: Address;
	data: Hex;
	value: bigint;
};

const GAS_BUFFER_NUM = 125n;
const GAS_BUFFER_DEN = 100n;

const shortMessage = (e: unknown): string =>
	(e as { shortMessage?: string }).shortMessage ?? (e as { details?: string }).details ?? errorText(e);

/** Fills nonce, gas and fees. EIP-1559 when the chain supports it, legacy otherwise. */
export const prepareTx = async (from: Address, tx: TxRequest): Promise<PreparedTx> => {
	const client = getPublicClient(tx.chainId);
	const value = tx.value ?? 0n;
	try {
		const [nonce, gas] = await Promise.all([
			client.getTransactionCount({ address: from, blockTag: "pending" }),
			tx.gas !== undefined
				? Promise.resolve(tx.gas)
				: client
						.estimateGas({ account: from, to: tx.to, data: tx.data, value })
						.then((g) => (g * GAS_BUFFER_NUM) / GAS_BUFFER_DEN),
		]);
		const base = { chainId: tx.chainId, nonce, gas, to: tx.to, data: tx.data, value };
		if (!findChain(tx.chainId)?.legacyTx) {
			try {
				const fees = await client.estimateFeesPerGas({ type: "eip1559" });
				return {
					...base,
					type: "eip1559",
					maxFeePerGas: fees.maxFeePerGas,
					maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
				};
			} catch {
				// Chain without EIP-1559 – fall back to a legacy transaction.
			}
		}
		const gasPrice = await client.getGasPrice();
		return { ...base, type: "legacy", gasPrice: (gasPrice * 110n) / 100n };
	} catch (e) {
		if (e instanceof WalletError) throw e;
		throw new WalletError("unknown", shortMessage(e));
	}
};

export const serializeUnsigned = (tx: PreparedTx): Hex => serializeTransaction(tx);

/**
 * Attaches a device signature. The recovery bit reported by devices is unreliable for
 * legacy transactions on chains with large ids, so both parities are tried and the one
 * that recovers to `from` wins. Throws 'wrong-device' when neither does.
 */
export const assembleSigned = async (tx: PreparedTx, from: Address, r: string, s: string): Promise<Hex> => {
	const hex = (h: string): Hex => `0x${h.replace(/^0x/, "").padStart(64, "0")}` as Hex;
	for (const yParity of [0, 1]) {
		const serialized = serializeTransaction(tx, {
			r: hex(r),
			s: hex(s),
			yParity,
			...(tx.type === "legacy" ? { v: BigInt(tx.chainId * 2 + 35 + yParity) } : {}),
		}) as TransactionSerialized;
		const signer = await recoverTransactionAddress({ serializedTransaction: serialized });
		if (sameAddress(signer, from)) return serialized;
	}
	throw new WalletError("wrong-device", undefined, { address: from });
};

/** Broadcasts a signed transaction (through the private endpoint when MEV protection is on). */
export const broadcast = async (chainId: number, serialized: Hex): Promise<Hex> => {
	try {
		return await getBroadcastClient(chainId).sendRawTransaction({ serializedTransaction: serialized });
	} catch (e) {
		throw new WalletError("unknown", shortMessage(e));
	}
};

/** Decimal/bigint → minimal 0x hex as expected by Trezor Connect. */
export const toRpcHex = (value: bigint | number): Hex => `0x${BigInt(value).toString(16)}` as Hex;
