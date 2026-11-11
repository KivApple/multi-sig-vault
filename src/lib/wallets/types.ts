import type { Address, Hex } from "viem";
import type { Signer, WalletKind } from "@/types/domain";

export interface TypedDataPayload {
	domain: { name?: string; version?: string; chainId?: number; verifyingContract?: Address; salt?: Hex };
	/** Without EIP712Domain – adapters derive it from the domain fields present. */
	types: Record<string, { name: string; type: string }[]>;
	primaryType: string;
	message: Record<string, unknown>;
}

export interface TxRequest {
	chainId: number;
	to: Address;
	data: Hex;
	value?: bigint;
	gas?: bigint;
}

export interface DiscoveredAccount {
	address: Address;
	path?: string;
	name?: string;
}

export interface DerivationScheme {
	id: string;
	labelKey: string;
	path: (index: number) => string;
}

export interface ListAccountsOptions {
	scheme?: string;
	offset?: number;
	count?: number;
	/** MetaMask: re-open the account permission prompt. */
	reselect?: boolean;
}

export interface WalletAdapter {
	kind: WalletKind;
	/** Empty for MetaMask; the first scheme is the default. */
	schemes: DerivationScheme[];
	listAccounts(opts: ListAccountsOptions): Promise<DiscoveredAccount[]>;
	/** 65 bytes r||s||v. */
	signTypedData(signer: Signer, data: TypedDataPayload): Promise<Hex>;
	/** Returns the transaction hash after broadcast. */
	sendTransaction(signer: Signer, tx: TxRequest): Promise<Hex>;
}
