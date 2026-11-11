import { encodeFunctionData, hashTypedData, isHex, parseAbi, type Address, type Hex } from "viem";

const SIGN_MESSAGE_ABI = parseAbi(["function signMessage(bytes _data)"]);

export const isBytes32 = (value: string): value is Hex => isHex(value.trim()) && value.trim().length === 66;

/**
 * `SignMessageLib.signMessage(abi.encode(hash))` – after the Safe delegatecalls it,
 * `isValidSignature(hash, "")` on the Safe returns the EIP-1271 magic value.
 */
export const signMessageCalldata = (hash: Hex): Hex =>
	encodeFunctionData({ abi: SIGN_MESSAGE_ABI, functionName: "signMessage", args: [hash] });

/** Hash under which the Safe records the approval (`getMessageHashForSafe`). */
export const safeMessageHash = (chainId: number, safe: Address, hash: Hex): Hex =>
	hashTypedData({
		domain: { chainId, verifyingContract: safe },
		types: { SafeMessage: [{ name: "message", type: "bytes" }] },
		primaryType: "SafeMessage",
		message: { message: hash },
	});
