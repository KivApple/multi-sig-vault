import { AppError } from "@/lib/errors";
import type { NetworkEnv } from "@/types/domain";

/** Public endpoints that answer a browser. Unit's testnet pays out on Solana Devnet. */
const SOLANA_RPC: Record<NetworkEnv, string[]> = {
	mainnet: ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com", "https://solana.drpc.org"],
	testnet: ["https://api.devnet.solana.com"],
};
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

/** What kind of account an address is; `null` – nothing exists there yet. */
export const parseSolanaAccount = (json: unknown): { owner: string; executable: boolean } | null | undefined => {
	const result = (json as { result?: { value?: unknown } } | null)?.result;
	if (!result || !("value" in result)) return undefined;
	if (result.value === null) return null;
	const v = result.value as { owner?: unknown; executable?: unknown };
	return typeof v.owner === "string" ? { owner: v.owner, executable: v.executable === true } : undefined;
};

/** A wallet: an address with no account yet, or an account that belongs to the System Program and is not a program. */
export const isSolanaWallet = (account: { owner: string; executable: boolean } | null): boolean =>
	account === null || (account.owner === SYSTEM_PROGRAM && !account.executable);

/**
 * A Solana address is 32 bytes whatever it is: a wallet, a token account, a program. Only a wallet
 * can receive a payout and spend it; sent to a token account or to a program, it is out of reach.
 * So the kind of the account is looked up before anything is signed.
 */
export const assertSolanaWallet = async (env: NetworkEnv, address: string): Promise<void> => {
	for (const url of SOLANA_RPC[env]) {
		let account: ReturnType<typeof parseSolanaAccount>;
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				referrerPolicy: "no-referrer",
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "getAccountInfo",
					// The account's data is not needed, only whose it is.
					params: [address, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }],
				}),
				signal: AbortSignal.timeout(10_000),
			});
			account = res.ok ? parseSolanaAccount(await res.json()) : undefined;
		} catch {
			account = undefined;
		}
		// This endpoint did not answer usably: ask the next one.
		if (account === undefined) continue;
		if (!isSolanaWallet(account)) throw new AppError("hl.unit.error.solanaNotWallet");
		return;
	}
	throw new AppError("hl.unit.error.solanaUnchecked");
};
