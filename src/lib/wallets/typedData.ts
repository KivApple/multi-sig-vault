import {
	hashDomain,
	hashStruct,
	hexToBigInt,
	recoverTypedDataAddress,
	size,
	slice,
	toHex,
	type Address,
	type Hex,
	type TypedDataDomain,
} from "viem";
import type { TypedDataPayload } from "./types";

export interface TypeField {
	name: string;
	type: string;
}

/** EIP712Domain type for exactly the fields present in the domain (canonical order). */
export const domainTypeFor = (domain: TypedDataPayload["domain"]): TypeField[] => {
	const fields: TypeField[] = [];
	if (domain.name !== undefined) fields.push({ name: "name", type: "string" });
	if (domain.version !== undefined) fields.push({ name: "version", type: "string" });
	if (domain.chainId !== undefined) fields.push({ name: "chainId", type: "uint256" });
	if (domain.verifyingContract !== undefined) fields.push({ name: "verifyingContract", type: "address" });
	if (domain.salt !== undefined) fields.push({ name: "salt", type: "bytes32" });
	return fields;
};

/** JSON-safe deep copy: bigint → decimal string. */
export const jsonSafe = <T>(value: T): T =>
	JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))) as T;

export interface FullTypedData {
	types: Record<string, TypeField[]>;
	primaryType: string;
	domain: TypedDataPayload["domain"];
	message: Record<string, unknown>;
}

/** The `eth_signTypedData_v4` document: EIP712Domain included, no bigints. */
export const toFullTypedData = (data: TypedDataPayload): FullTypedData => {
	const { EIP712Domain: _ignored, ...types } = data.types;
	return {
		types: { EIP712Domain: domainTypeFor(data.domain), ...types },
		primaryType: data.primaryType,
		domain: jsonSafe(data.domain),
		message: jsonSafe(data.message),
	};
};

export const typedDataHashes = (data: TypedDataPayload): { domainSeparator: Hex; messageHash: Hex } => {
	const full = toFullTypedData(data);
	return {
		domainSeparator: hashDomain({ domain: full.domain as TypedDataDomain, types: full.types }),
		messageHash: hashStruct({ data: full.message, primaryType: full.primaryType, types: full.types }),
	};
};

const with0x = (hex: string): Hex => (hex.startsWith("0x") ? (hex as Hex) : (`0x${hex}` as Hex));

/** Joins r, s, v into a 65-byte signature with v = 27/28. */
export const joinSignature = (r: string, s: string, v: number | bigint): Hex => {
	const n = Number(v);
	const parity = n <= 1 ? n : n === 27 || n === 28 ? n - 27 : (n - 35) % 2;
	const pad = (h: string): string => with0x(h).slice(2).padStart(64, "0");
	return `0x${pad(r)}${pad(s)}${(27 + parity).toString(16)}` as Hex;
};

/** Normalizes any 65-byte signature to v = 27/28 (wallets may return 0/1). */
export const normalizeSignature = (signature: string): Hex => {
	const sig = with0x(signature.trim());
	if (!/^0x[0-9a-fA-F]+$/.test(sig) || size(sig) !== 65) throw new Error("Signature must be 65 bytes");
	const v = Number(hexToBigInt(slice(sig, 64, 65)));
	if (v !== 0 && v !== 1 && v !== 27 && v !== 28) throw new Error(`Unexpected signature v=${v}`);
	return `${slice(sig, 0, 64)}${toHex(v < 27 ? v + 27 : v).slice(2)}`.toLowerCase() as Hex;
};

export const recoverTypedDataSigner = (data: TypedDataPayload, signature: Hex): Promise<Address> => {
	const full = toFullTypedData(data);
	return recoverTypedDataAddress({
		domain: full.domain as TypedDataDomain,
		types: full.types,
		primaryType: full.primaryType,
		message: full.message,
		signature,
	});
};
