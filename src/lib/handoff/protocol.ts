import { getAddress, isAddress, isHex, size, type Address, type Hex } from "viem";
import type { WalletErrorCode } from "@/lib/errors";
import type { TxRequest, TypedDataPayload } from "@/lib/wallets/types";

/** What the app asks the page inside MetaMask's browser to do. */
export type HandoffRequest =
	| { v: 1; method: "accounts" }
	| { v: 1; method: "signTypedData"; address: Address; data: TypedDataPayload }
	| { v: 1; method: "sendTransaction"; address: Address; tx: WireTx };

/** `TxRequest` with decimal strings instead of bigints. */
export interface WireTx {
	chainId: number;
	to: Address;
	data: Hex;
	value: string;
	gas?: string;
}

export type HandoffResponse = { ok: true; result: unknown } | { ok: false; code: WalletErrorCode; detail?: string };

export const toWireTx = (tx: TxRequest): WireTx => ({
	chainId: tx.chainId,
	to: tx.to,
	data: tx.data,
	value: (tx.value ?? 0n).toString(),
	...(tx.gas !== undefined ? { gas: tx.gas.toString() } : {}),
});

export const fromWireTx = (tx: WireTx): TxRequest => ({
	chainId: tx.chainId,
	to: tx.to,
	data: tx.data,
	value: BigInt(tx.value),
	...(tx.gas !== undefined ? { gas: BigInt(tx.gas) } : {}),
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isDecimal = (v: unknown): v is string => typeof v === "string" && /^\d{1,78}$/.test(v);
const isChainId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** Checks a decrypted request before anything is shown or sent to the wallet. */
export const parseRequest = (value: unknown): HandoffRequest | undefined => {
	if (!isRecord(value) || value.v !== 1) return undefined;
	if (value.method === "accounts") return { v: 1, method: "accounts" };
	if (typeof value.address !== "string" || !isAddress(value.address)) return undefined;
	const address = getAddress(value.address);
	if (value.method === "signTypedData") {
		const data = value.data;
		if (
			!isRecord(data) ||
			!isRecord(data.domain) ||
			!isRecord(data.types) ||
			typeof data.primaryType !== "string" ||
			!isRecord(data.message) ||
			!Object.values(data.types).every(
				(fields) =>
					Array.isArray(fields) &&
					fields.every((f) => isRecord(f) && typeof f.name === "string" && typeof f.type === "string"),
			)
		) {
			return undefined;
		}
		return { v: 1, method: "signTypedData", address, data: data as unknown as TypedDataPayload };
	}
	if (value.method === "sendTransaction") {
		const tx = value.tx;
		if (
			!isRecord(tx) ||
			!isChainId(tx.chainId) ||
			typeof tx.to !== "string" ||
			!isAddress(tx.to) ||
			!isHex(tx.data) ||
			!isDecimal(tx.value) ||
			(tx.gas !== undefined && !isDecimal(tx.gas))
		) {
			return undefined;
		}
		return {
			v: 1,
			method: "sendTransaction",
			address,
			tx: { chainId: tx.chainId, to: getAddress(tx.to), data: tx.data, value: tx.value, gas: tx.gas as string },
		};
	}
	return undefined;
};

/** Checks the shape of a result for the request it answers. */
export const parseResult = (request: HandoffRequest, result: unknown): unknown => {
	if (request.method === "accounts") {
		if (!Array.isArray(result) || result.length > 100 || !result.every((a) => typeof a === "string" && isAddress(a))) {
			return undefined;
		}
		return result.map((a: string) => getAddress(a));
	}
	const bytes = request.method === "signTypedData" ? 65 : 32;
	return isHex(result) && size(result) === bytes ? result : undefined;
};
