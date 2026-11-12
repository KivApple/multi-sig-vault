import type { Hex } from "viem";
import { WalletError } from "@/lib/errors";
import { sameAddress } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import type { Signer, WalletKind } from "@/types/domain";
import { ledgerAdapter } from "./ledger";
import { metamaskAdapter } from "./metamask";
import { trezorAdapter } from "./trezor";
import { normalizeSignature, recoverTypedDataSigner } from "./typedData";
import type { TxRequest, TypedDataPayload, WalletAdapter } from "./types";

/** Adapters are light; each loads its vendor SDK with a dynamic import on first use. */
const ADAPTERS: Record<WalletKind, WalletAdapter> = {
	metamask: metamaskAdapter,
	trezor: trezorAdapter,
	ledger: ledgerAdapter,
};

export const getWallet = (kind: WalletKind): WalletAdapter => ADAPTERS[kind];

/**
 * Signs with the given adapter and proves the result: the signature must recover to the
 * signer's address for exactly this payload. Split out so tests can inject an adapter.
 */
export const signAndVerify = async (adapter: WalletAdapter, signer: Signer, data: TypedDataPayload): Promise<Hex> => {
	let signature: Hex;
	try {
		signature = normalizeSignature(await adapter.signTypedData(signer, data));
	} catch (e) {
		throw e instanceof WalletError ? e : new WalletError("unknown", (e as Error).message);
	}
	const recovered = await recoverTypedDataSigner(data, signature).catch(() => undefined);
	if (!sameAddress(recovered, signer.address)) {
		throw new WalletError("wrong-account", undefined, { address: signer.address });
	}
	return signature;
};

export const signTypedDataWith = (signer: Signer, data: TypedDataPayload): Promise<Hex> =>
	signAndVerify(getWallet(signer.wallet), signer, data);

export const sendTransactionWith = async (signer: Signer, tx: TxRequest): Promise<Hex> => {
	try {
		const speed = tx.speed ?? useAppStore.getState().settings.feeSpeed;
		const hash = await getWallet(signer.wallet).sendTransaction(signer, { ...tx, speed });
		if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new WalletError("unknown", `Unexpected response: ${String(hash)}`);
		return hash;
	} catch (e) {
		throw e instanceof WalletError ? e : new WalletError("unknown", (e as Error).message);
	}
};

export * from "./types";
