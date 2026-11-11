import type { Address, Hex } from "viem";

export type NetworkEnv = "mainnet" | "testnet";
export type AccountKind = "hl" | "safe";
export type WalletKind = "metamask" | "trezor" | "ledger";
export type ThemeSetting = "system" | "light" | "dark";
export type LangSetting = "system" | "en" | "ru";

/** Parameters that fully determine a Safe proxy address (CREATE2). */
export interface SafeCreation {
	factory: Address;
	singleton: Address;
	/** Encoded `setup(...)` call. */
	initializer: Hex;
	/** Decimal string. */
	saltNonce: string;
}

export interface Account {
	/** Deterministic: `hl:<env>:<address>` or `safe:<chainId>:<address>` (lowercase). */
	id: string;
	kind: AccountKind;
	env: NetworkEnv;
	/** Safe accounts only. */
	chainId?: number;
	address: Address;
	name?: string;
	hidden: boolean;
	hideDust: boolean;
	/** Known when the Safe was created by this app or its creation was resolved. */
	creation?: SafeCreation;
	addedAt: number;
}

export interface Signer {
	/** Lowercase address. */
	id: string;
	address: Address;
	name: string;
	wallet: WalletKind;
	/** BIP-32 path for hardware wallets. */
	path?: string;
	addedAt: number;
}

export interface OpSignature {
	signer: Address;
	signature: Hex;
}

export interface SafeTxData {
	to: Address;
	/** Decimal string (wei). */
	value: string;
	data: Hex;
	operation: 0 | 1;
	safeTxGas: string;
	baseGas: string;
	gasPrice: string;
	gasToken: Address;
	refundReceiver: Address;
	/** Decimal string. */
	nonce: string;
}

export interface HlPayload {
	kind: "hl";
	/** True when the account is a multi-sig user and signatures are collected for a `multiSig` action. */
	multiSig: boolean;
	/** Outer signer (lowercase). For a plain account: the account itself. */
	leader: Address;
	nonce: number;
	/** `user` – EIP-712 user-signed action, `l1` – msgpack-hashed L1 action. */
	signing: "user" | "l1";
	/** Inner action exactly as it will be sent to the exchange. */
	action: Record<string, unknown>;
}

export interface SafePayload {
	kind: "safe";
	tx: SafeTxData;
	/** EIP-712 hash of the Safe transaction. */
	safeTxHash: Hex;
}

export type OpPayload = HlPayload | SafePayload;

export type OpStatus = "draft" | "signing" | "sent";

export interface OpResult {
	sentAt: number;
	/** EVM transaction hash (Safe operations). */
	txHash?: Hex;
	/** Address that paid for / submitted the transaction. */
	sender?: Address;
	/** Operation specific extras (bridge progress, deployed address, …). */
	extra?: Record<string, unknown>;
}

export interface Operation {
	/** UUID – used for de-duplication on import. */
	id: string;
	accountId: string;
	type: string;
	/** Editable parameters while `draft`; resolved and immutable afterwards. */
	params: Record<string, unknown>;
	status: OpStatus;
	createdAt: number;
	/** Set together with the first signature. */
	frozenAt?: number;
	payload?: OpPayload;
	signatures: OpSignature[];
	/** Multi-sig configuration snapshot taken when signing started. */
	owners?: Address[];
	threshold?: number;
	result?: OpResult;
}

export interface Settings {
	theme: ThemeSetting;
	lang: LangSetting;
	mevProtection: boolean;
	tokenListAutoUpdate: boolean;
	verifyUpdates: boolean;
	/** Let hardware wallet SDKs fetch clear-signing descriptors from the vendor's servers. */
	clearSigning: boolean;
	/** Custom RPC endpoint per chain id. */
	rpcOverrides: Record<string, string>;
}

export interface TokenInfo {
	chainId: number;
	address: Address;
	symbol: string;
	name: string;
	decimals: number;
	logoURI?: string;
}

/** One line of an account's portfolio. */
export interface AssetRow {
	key: string;
	symbol: string;
	name?: string;
	/** Token units, decimal string (signed for perp positions). */
	amount: string;
	usd: number;
	kind: "native" | "token" | "spot" | "perp";
	/** Icon lookup hints. */
	icon: { chainId?: number; address?: Address; symbol: string; hl?: boolean };
	/** Extra caption, e.g. "Long 5x" / "PnL +12$". */
	note?: string;
}
