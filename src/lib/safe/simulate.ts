import {
	BaseError,
	decodeAbiParameters,
	decodeErrorResult,
	decodeFunctionResult,
	encodeFunctionData,
	hexToString,
	type Address,
	type Hex,
} from "viem";
import { getPublicClient } from "@/lib/rpc";
import type { SafeTxData } from "@/types/domain";
import { SAFE_ABI, SIMULATE_ACCESSOR_ABI } from "./abis";
import { SAFE_LIBS } from "./deployments";

export interface SimulationResult {
	success: boolean;
	/** Gas used by the inner call(s). */
	gas: bigint;
	returnData: Hex;
	/** Decoded revert reason when the call fails. */
	reason?: string;
}

/** Best-effort decoding of revert data: Error(string), Panic(uint256) or raw selector. */
export const decodeRevert = (data: Hex): string => {
	if (!data || data === "0x") return "";
	try {
		const err = decodeErrorResult({ data });
		return err.errorName === "Error" || err.errorName === "Panic"
			? String(err.args?.[0] ?? err.errorName)
			: err.errorName;
	} catch {
		// Uniswap-style contracts revert with a short ASCII string encoded as Error(string) – handled above.
		const text = data.length <= 2 + 64 ? "" : hexToString(data).replace(/[^\x20-\x7e]/g, "");
		return text.length >= 3 ? text : data.slice(0, 10);
	}
};

const findRevertData = (e: unknown): Hex | undefined => {
	if (!(e instanceof BaseError)) return undefined;
	const hit = e.walk((x) => typeof (x as { data?: unknown }).data === "string") as { data?: Hex } | null;
	if (hit?.data?.startsWith("0x")) return hit.data;
	const nested = e.walk((x) => typeof (x as { data?: { data?: unknown } }).data?.data === "string") as {
		data?: { data?: Hex };
	} | null;
	return nested?.data?.data;
};

/**
 * Dry-runs the Safe transaction exactly as the Safe would execute it (including delegatecalls to MultiSend),
 * without signatures, through `SimulateTxAccessor`. Nothing is sent on-chain.
 */
export const simulateSafeTx = async (
	chainId: number,
	safe: Address,
	tx: Pick<SafeTxData, "to" | "value" | "data" | "operation">,
): Promise<SimulationResult> => {
	const client = getPublicClient(chainId);
	const accessorCall = encodeFunctionData({
		abi: SIMULATE_ACCESSOR_ABI,
		functionName: "simulate",
		args: [tx.to, BigInt(tx.value), tx.data, tx.operation],
	});

	let response: Hex | undefined;
	try {
		// Preferred path: the fallback handler turns the revert-with-result into a normal return value.
		const { data } = await client.call({
			to: safe,
			data: encodeFunctionData({
				abi: SAFE_ABI,
				functionName: "simulate",
				args: [SAFE_LIBS.simulateTxAccessor, accessorCall],
			}),
		});
		if (data && data !== "0x") {
			response = decodeFunctionResult({ abi: SAFE_ABI, functionName: "simulate", data });
		}
	} catch {
		// Safe without the compatibility fallback handler – use the raw revert data below.
	}

	if (!response) {
		try {
			await client.call({
				to: safe,
				data: encodeFunctionData({
					abi: SAFE_ABI,
					functionName: "simulateAndRevert",
					args: [SAFE_LIBS.simulateTxAccessor, accessorCall],
				}),
			});
			throw new Error("Simulation did not revert");
		} catch (e) {
			const data = findRevertData(e);
			if (!data || data.length < 2 + 128) throw e;
			// revert(success ++ length ++ response)
			const ok = BigInt(`0x${data.slice(2, 66)}`) === 1n;
			response = `0x${data.slice(2 + 128)}`;
			if (!ok) return { success: false, gas: 0n, returnData: response, reason: decodeRevert(response) };
		}
	}

	const [gas, success, returnData] = decodeAbiParameters(
		[{ type: "uint256" }, { type: "bool" }, { type: "bytes" }],
		response,
	);
	return { success, gas, returnData, reason: success ? undefined : decodeRevert(returnData) };
};
