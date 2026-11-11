import {
	concat,
	encodeFunctionData,
	getContractAddress,
	isHex,
	keccak256,
	parseEther,
	stringToHex,
	type Address,
	type Hex,
} from "viem";
import { AppError } from "@/lib/errors";
import { getPublicClient } from "@/lib/rpc";
import { CREATE_CALL_ABI } from "@/lib/safe/abis";
import { SAFE_LIBS } from "@/lib/safe/deployments";
import type { MetaTx } from "@/lib/safe/tx";
import { encodeCtorArgs, normalizeHex, parseCtorFragment } from "./abi";

export interface DeployParams {
	/** What the user pasted (hex or artifact JSON) – replaced by the plain bytecode when signing starts. */
	bytecodeText: string;
	/** Creation bytecode extracted from `bytecodeText`. */
	bytecode: string;
	/** JSON of the constructor ABI item when an artifact/ABI provided one. */
	ctor: string;
	args: string[];
	/** ABI-encoded constructor arguments when no constructor ABI is known. */
	rawArgs: string;
	value: string;
	method: "create" | "create2";
	/** CREATE2 salt: 32-byte hex, or any text (hashed with keccak256). */
	salt: string;
	/** CREATE only: address expected from the Safe's nonce when signing started. */
	expectedAddress?: string;
	/** Warning keys resolved by `prepare`. */
	warnings?: string[];
}

/** EIP-3860 */
export const MAX_INITCODE_BYTES = 49_152;
export const deployValueWei = (p: DeployParams): bigint => (p.value.trim() ? parseEther(p.value.trim()) : 0n);

export const deploySalt = (salt: string): Hex | undefined => {
	const s = salt.trim();
	if (!s) return undefined;
	return isHex(s) && s.length === 66 ? (s.toLowerCase() as Hex) : keccak256(stringToHex(s));
};

/** Creation bytecode followed by the encoded constructor arguments. */
export const deployInitCode = (p: DeployParams): Hex => {
	const bytecode = normalizeHex(p.bytecode);
	if (!bytecode || bytecode === "0x") throw new AppError("advanced.err.bytecode");
	const ctor = parseCtorFragment(p.ctor);
	const args = ctor ? encodeCtorArgs(ctor, p.args) : normalizeHex(p.rawArgs);
	if (!args) throw new AppError("advanced.err.hex");
	return concat([bytecode, args]);
};

/** Deterministic address for CREATE2; `undefined` for CREATE (depends on the Safe's nonce). */
export const deployAddress = (p: DeployParams, safe: Address): Address | undefined => {
	if (p.method !== "create2") return undefined;
	const salt = deploySalt(p.salt);
	if (!salt) return undefined;
	try {
		return getContractAddress({ opcode: "CREATE2", from: safe, salt, bytecode: deployInitCode(p) });
	} catch {
		return undefined;
	}
};

/** Address a CREATE deployment gets if it is the Safe's next contract creation. */
export const fetchCreateAddress = async (chainId: number, safe: Address): Promise<Address> => {
	const nonce = await getPublicClient(chainId).getTransactionCount({ address: safe });
	return getContractAddress({ opcode: "CREATE", from: safe, nonce: BigInt(nonce) });
};

/** One delegatecall to Safe's CreateCall library – the Safe itself becomes the deployer. */
export const buildDeploy = (p: DeployParams): MetaTx[] => {
	const initCode = deployInitCode(p);
	const value = deployValueWei(p);
	let data: Hex;
	if (p.method === "create2") {
		const salt = deploySalt(p.salt);
		if (!salt) throw new AppError("advanced.err.salt");
		data = encodeFunctionData({ abi: CREATE_CALL_ABI, functionName: "performCreate2", args: [value, initCode, salt] });
	} else {
		data = encodeFunctionData({ abi: CREATE_CALL_ABI, functionName: "performCreate", args: [value, initCode] });
	}
	return [{ to: SAFE_LIBS.createCall, value: 0n, data, operation: 1 as const }];
};
