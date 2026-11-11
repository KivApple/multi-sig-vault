import { encode } from "@msgpack/msgpack";
import { concat, keccak256, numberToHex, toHex, type Address, type Hex } from "viem";
import { HL_SIGNATURE_CHAIN } from "@/config/chains";
import { ZERO_ADDRESS } from "@/config/constants";
import type { HlPayload, NetworkEnv, OpSignature } from "@/types/domain";
import type { TypedDataPayload } from "@/lib/wallets/types";

type Field = { name: string; type: string };

/**
 * EIP-712 definitions of user-signed actions, keyed by `action.type`.
 * Field order is part of the protocol – keep in sync with Hyperliquid docs.
 */
export const USER_SIGNED: Record<string, { primaryType: string; fields: Field[] }> = {
	withdraw3: {
		primaryType: "HyperliquidTransaction:Withdraw",
		fields: [
			{ name: "hyperliquidChain", type: "string" },
			{ name: "destination", type: "string" },
			{ name: "amount", type: "string" },
			{ name: "time", type: "uint64" },
		],
	},
	usdSend: {
		primaryType: "HyperliquidTransaction:UsdSend",
		fields: [
			{ name: "hyperliquidChain", type: "string" },
			{ name: "destination", type: "string" },
			{ name: "amount", type: "string" },
			{ name: "time", type: "uint64" },
		],
	},
	spotSend: {
		primaryType: "HyperliquidTransaction:SpotSend",
		fields: [
			{ name: "hyperliquidChain", type: "string" },
			{ name: "destination", type: "string" },
			{ name: "token", type: "string" },
			{ name: "amount", type: "string" },
			{ name: "time", type: "uint64" },
		],
	},
	sendAsset: {
		primaryType: "HyperliquidTransaction:SendAsset",
		fields: [
			{ name: "hyperliquidChain", type: "string" },
			{ name: "destination", type: "string" },
			{ name: "sourceDex", type: "string" },
			{ name: "destinationDex", type: "string" },
			{ name: "token", type: "string" },
			{ name: "amount", type: "string" },
			{ name: "fromSubAccount", type: "string" },
			{ name: "nonce", type: "uint64" },
		],
	},
	usdClassTransfer: {
		primaryType: "HyperliquidTransaction:UsdClassTransfer",
		fields: [
			{ name: "hyperliquidChain", type: "string" },
			{ name: "amount", type: "string" },
			{ name: "toPerp", type: "bool" },
			{ name: "nonce", type: "uint64" },
		],
	},
	approveAgent: {
		primaryType: "HyperliquidTransaction:ApproveAgent",
		fields: [
			{ name: "hyperliquidChain", type: "string" },
			{ name: "agentAddress", type: "address" },
			{ name: "agentName", type: "string" },
			{ name: "nonce", type: "uint64" },
		],
	},
	convertToMultiSigUser: {
		primaryType: "HyperliquidTransaction:ConvertToMultiSigUser",
		fields: [
			{ name: "hyperliquidChain", type: "string" },
			{ name: "signers", type: "string" },
			{ name: "nonce", type: "uint64" },
		],
	},
};

const MULTISIG_FIELDS: Field[] = [
	{ name: "payloadMultiSigUser", type: "address" },
	{ name: "outerSigner", type: "address" },
];

const SEND_MULTISIG_FIELDS: Field[] = [
	{ name: "hyperliquidChain", type: "string" },
	{ name: "multiSigActionHash", type: "bytes32" },
	{ name: "nonce", type: "uint64" },
];

export const hlChainName = (env: NetworkEnv): "Mainnet" | "Testnet" => (env === "mainnet" ? "Mainnet" : "Testnet");
export const hlSignatureChainId = (env: NetworkEnv): Hex => numberToHex(HL_SIGNATURE_CHAIN[env]);

const userDomain = (signatureChainId: string): TypedDataPayload["domain"] => ({
	name: "HyperliquidSignTransaction",
	version: "1",
	chainId: Number.parseInt(signatureChainId, 16),
	verifyingContract: ZERO_ADDRESS,
});

/** keccak256(msgpack(action) ++ nonce(u64 BE) ++ 0x00) – no vault address, no expiry. */
export const l1ActionHash = (action: unknown, nonce: number): Hex => {
	const nonceBytes = new Uint8Array(8);
	new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce));
	return keccak256(concat([toHex(encode(action)), toHex(nonceBytes), "0x00"]));
};

const agentTypedData = (connectionId: Hex, env: NetworkEnv): TypedDataPayload => ({
	domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: ZERO_ADDRESS },
	types: {
		Agent: [
			{ name: "source", type: "string" },
			{ name: "connectionId", type: "bytes32" },
		],
	},
	primaryType: "Agent",
	message: { source: env === "mainnet" ? "a" : "b", connectionId },
});

/**
 * Typed data every signer of the operation signs.
 * Multi-sig: the inner action bound to the multi-sig user and the outer signer (leader).
 * Plain account: the action itself.
 */
export const hlSignerTypedData = (payload: HlPayload, user: Address, env: NetworkEnv): TypedDataPayload => {
	const { action } = payload;
	if (payload.signing === "l1") {
		const hashed = payload.multiSig ? [user.toLowerCase(), payload.leader.toLowerCase(), action] : action;
		return agentTypedData(l1ActionHash(hashed, payload.nonce), env);
	}
	const def = USER_SIGNED[String(action.type)];
	if (!def) throw new Error(`Unknown user-signed action ${String(action.type)}`);
	const fields = payload.multiSig ? [def.fields[0], ...MULTISIG_FIELDS, ...def.fields.slice(1)] : def.fields;
	const message: Record<string, unknown> = {};
	for (const f of fields) {
		if (f.name === "payloadMultiSigUser") message[f.name] = user.toLowerCase();
		else if (f.name === "outerSigner") message[f.name] = payload.leader.toLowerCase();
		else message[f.name] = action[f.name];
	}
	return {
		domain: userDomain(String(action.signatureChainId)),
		types: { [def.primaryType]: fields },
		primaryType: def.primaryType,
		message,
	};
};

export interface HlSig {
	r: Hex;
	s: Hex;
	v: number;
}

export const splitSignature = (sig: Hex): HlSig => {
	const v = Number.parseInt(sig.slice(130, 132), 16);
	return { r: `0x${sig.slice(2, 66)}`, s: `0x${sig.slice(66, 130)}`, v: v < 27 ? v + 27 : v };
};

/** Inner multi-sig signatures are sent with leading zeros of r/s stripped (as the official SDKs do). */
const trimSig = (sig: HlSig): HlSig => ({
	r: sig.r.replace(/^0x0+/, "0x") as Hex,
	s: sig.s.replace(/^0x0+/, "0x") as Hex,
	v: sig.v,
});

export interface MultiSigWrapper {
	type: "multiSig";
	signatureChainId: Hex;
	signatures: HlSig[];
	payload: { multiSigUser: string; outerSigner: string; action: Record<string, unknown> };
}

/** The `multiSig` exchange action wrapping collected inner signatures. */
export const hlMultiSigWrapper = (
	payload: HlPayload,
	user: Address,
	env: NetworkEnv,
	signatures: OpSignature[],
): MultiSigWrapper => ({
	type: "multiSig",
	signatureChainId:
		payload.signing === "user" ? (String(payload.action.signatureChainId) as Hex) : hlSignatureChainId(env),
	signatures: signatures.map((s) => trimSig(splitSignature(s.signature))),
	payload: { multiSigUser: user.toLowerCase(), outerSigner: payload.leader.toLowerCase(), action: payload.action },
});

/** Typed data the leader signs to submit the collected signatures. */
export const hlOuterTypedData = (wrapper: MultiSigWrapper, nonce: number, env: NetworkEnv): TypedDataPayload => {
	const { type: _type, ...withoutType } = wrapper;
	return {
		domain: userDomain(wrapper.signatureChainId),
		types: { "HyperliquidTransaction:SendMultiSig": SEND_MULTISIG_FIELDS },
		primaryType: "HyperliquidTransaction:SendMultiSig",
		message: {
			hyperliquidChain: hlChainName(env),
			multiSigActionHash: l1ActionHash(withoutType, nonce),
			nonce,
		},
	};
};
