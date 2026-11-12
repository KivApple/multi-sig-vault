import type { LucideIcon } from "lucide-react";
import type { Address } from "viem";
import type { TFunc } from "@/i18n";
import type { HlAccountData, HlAccountExtras } from "@/lib/hl/account";
import type { SafeAccountData } from "@/lib/safe/account";
import type { MetaTx } from "@/lib/safe/tx";
import type { Account, AccountKind, NetworkEnv, Operation, Signer } from "@/types/domain";

/** Everything forms, validation and availability checks may look at. Live data can be missing offline. */
export interface OpEnv {
	account: Account;
	hl?: HlAccountData;
	hlExtras?: HlAccountExtras;
	safe?: SafeAccountData;
	accounts: Account[];
	signers: Signer[];
}

/** Field name → message shown under the field. */
export type OpErrors = Record<string, string>;

export interface SummaryRow {
	label: string;
	value?: string;
	/** Rendered with the known name/icon of the address. */
	address?: Address;
	/** Scope for resolving the address to a known Safe. */
	chainId?: number;
	mono?: boolean;
	/** Emphasise (e.g. warnings). */
	tone?: "warning";
}

export interface SummaryCtx {
	t: TFunc;
	lang: string;
	account: Account;
}

export interface OpFormProps<P> {
	/** Operation id – key for secrets the form may create (agent keys). */
	opId: string;
	value: P;
	onChange: (patch: Partial<P>) => void;
	env: OpEnv;
	errors: OpErrors;
}

export interface OpResultProps {
	op: Operation;
	account: Account;
}

export interface HlBuildCtx {
	env: NetworkEnv;
	nonce: number;
	user: Address;
}

export interface SafeBuildCtx {
	chainId: number;
	safe: Address;
}

/**
 * One kind of operation. `build*` must be pure and deterministic: the app re-runs it to prove that
 * the parameters shown to the user are exactly what the signed payload does.
 */
// biome-ignore lint: params differ per operation
export interface OpDefinition<P = any> {
	type: string;
	kind: AccountKind;
	icon: LucideIcon;
	/** Hyperliquid: how the action is signed. L1 actions cannot be signed with MetaMask. */
	hlSigning?: "user" | "l1";
	available: (env: OpEnv) => boolean;
	defaults: (env: OpEnv) => P;
	/** Async part of creation (e.g. generating an agent key); returns a params patch. */
	init?: (opId: string, params: P) => Promise<Partial<P>>;
	Form: React.FC<OpFormProps<P>>;
	validate: (params: P, env: OpEnv, t: TFunc) => OpErrors;
	/** Resolves network-dependent values right before the first signature (quotes, current owners…). */
	prepare?: (params: P, env: OpEnv) => Promise<P>;
	buildHl?: (params: P, ctx: HlBuildCtx) => Record<string, unknown>;
	buildSafe?: (params: P, ctx: SafeBuildCtx) => MetaTx[];
	summary: (params: P, ctx: SummaryCtx) => SummaryRow[];
	/** Extra content of the "sent" card (login link, bridge progress…). */
	Result?: React.FC<OpResultProps>;
	/** The transaction is mined, but the operation still has a leg to finish (a bridge delivery). */
	unfinished?: (op: Operation) => boolean;
	/** Translation key of the warning shown before deleting a sent card; `undefined` – delete silently. */
	deleteWarning?: (op: Operation) => string | undefined;
	/** The operation owns an agent key in the secure store (travels with exports). */
	hasSecret?: (params: P) => boolean;
}
