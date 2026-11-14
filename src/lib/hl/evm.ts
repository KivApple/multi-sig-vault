import { formatUnits, parseUnits, type Address } from "viem";
import { HL_EVM_CHAIN } from "@/config/chains";
import { AppError } from "@/lib/errors";
import { isDecimal, trimDecimal } from "@/lib/format";
import { getPublicClient } from "@/lib/rpc";
import { ERC20_ABI } from "@/lib/safe/abis";
import type { NetworkEnv } from "@/types/domain";
import { fetchHlMarket, hlSystemAddress } from "./account";

/**
 * A spot token leaves for HyperEVM by a transfer to its system address, and the same amount is paid
 * out by that address on HyperEVM – a plain `transfer` to the account. The exchange does not check
 * that this transfer can succeed: it debits the account either way, and where it fails the tokens are
 * gone. So the app makes that very call first, without sending it, and refuses a withdrawal that
 * HyperEVM would not pay. (A balance is not asked for: some linked contracts mint on such a transfer.)
 */
export const assertEvmWithdrawable = async (
	env: NetworkEnv,
	tokenIndex: number,
	coin: string,
	amount: string,
	account: Address,
): Promise<void> => {
	const client = getPublicClient(HL_EVM_CHAIN[env]);
	const system = hlSystemAddress(tokenIndex, coin);
	const unchecked = (): never => {
		throw new AppError("hl.spotWithdraw.error.unchecked", { coin });
	};
	if (coin === "HYPE") {
		// The coin of HyperEVM itself: the system address pays it from its balance.
		const balance = await client.getBalance({ address: system }).catch(unchecked);
		if (balance < parseUnits(trimDecimal(amount), 18)) {
			throw new AppError("hl.spotWithdraw.error.noSupply", { coin, available: formatUnits(balance, 18) });
		}
		return;
	}
	const token = (await fetchHlMarket(env).catch(unchecked)).tokens.find((t) => t.index === tokenIndex);
	const contract = token?.evmContract;
	if (!token || !contract) return unchecked();
	const decimals = token.weiDecimals + contract.evm_extra_wei_decimals;
	// Where the token has fewer decimals on HyperEVM than on the exchange, the remainder would be dropped on the way.
	if (!isDecimal(amount, Math.max(0, decimals))) {
		throw new AppError("hl.spotWithdraw.error.precision", { coin, decimals });
	}
	const units = parseUnits(trimDecimal(amount), decimals);
	try {
		await client.simulateContract({
			address: contract.address,
			abi: ERC20_ABI,
			functionName: "transfer",
			args: [account, units],
			account: system,
		});
	} catch {
		// Why it would fail, where that can be told: an empty system address is the usual reason.
		const balance = await client
			.readContract({ address: contract.address, abi: ERC20_ABI, functionName: "balanceOf", args: [system] })
			.catch(unchecked);
		if (balance < units) {
			throw new AppError("hl.spotWithdraw.error.noSupply", { coin, available: formatUnits(balance, decimals) });
		}
		return unchecked();
	}
};
