import type { Address, Hex } from "viem";
import { AppError } from "@/lib/errors";
import { getPublicClient } from "@/lib/rpc";
import { simulateSafeTx, type SimulationResult } from "@/lib/safe/simulate";

/**
 * Dry-run used by `prepare` of the advanced operations. A definite revert blocks signing with the
 * decoded reason; an unreachable RPC does not (operations must stay signable offline).
 */
export const simulateOrSkip = async (
	chainId: number,
	safe: Address,
	tx: { to: Address; value: bigint; data: Hex; operation: 0 | 1 },
): Promise<SimulationResult | undefined> => {
	let result: SimulationResult;
	try {
		result = await simulateSafeTx(chainId, safe, { ...tx, value: tx.value.toString() });
	} catch {
		return undefined;
	}
	if (!result.success) throw new AppError("advanced.err.simulation", { reason: result.reason || "—" });
	return result;
};

/** `true`/`false` when known, `undefined` when the network is unavailable. */
export const hasCode = async (chainId: number, address: Address): Promise<boolean | undefined> => {
	try {
		const code = await getPublicClient(chainId).getCode({ address });
		return !!code && code !== "0x";
	} catch {
		return undefined;
	}
};
