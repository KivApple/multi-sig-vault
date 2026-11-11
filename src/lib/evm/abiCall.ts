import { parseEther, type Hex } from "viem";
import { AppError } from "@/lib/errors";
import { encodeCall, normalizeHex, parseFragment } from "./abi";

export interface CallParams {
	to: string;
	/** Native coin amount sent with the call (decimal string, empty = 0). */
	value: string;
	mode: "abi" | "raw";
	/** Pasted ABI – editing convenience only, dropped when signing starts. */
	abiText: string;
	/** JSON of the selected function (ABI mode). */
	fragment: string;
	/** One string per argument, exactly as entered. */
	args: string[];
	/** Raw mode: calldata as typed. After `prepare`: the final calldata in both modes. */
	data: string;
}

export const callValueWei = (p: CallParams): bigint => (p.value.trim() ? parseEther(p.value.trim()) : 0n);

/** Calldata the parameters describe. ABI mode always re-encodes from the function and arguments. */
export const callData = (p: CallParams): Hex => {
	if (p.mode === "raw") {
		const hex = normalizeHex(p.data);
		if (!hex) throw new AppError("advanced.err.hex");
		return hex;
	}
	const fn = parseFragment(p.fragment);
	if (!fn) throw new AppError("advanced.err.noFunction");
	return encodeCall(fn, p.args);
};

