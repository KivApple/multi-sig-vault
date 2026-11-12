import { KeyRound, KeySquare, LogIn } from "lucide-react";
import { ApproveAgentForm } from "@/components/ops/hl/ApproveAgentForm";
import { AgentKeyResult } from "@/components/ops/hl/AgentKeyResult";
import { LoginForm } from "@/components/ops/hl/LoginForm";
import { LoginResult } from "@/components/ops/hl/LoginResult";
import { RevokeAgentForm } from "@/components/ops/hl/RevokeAgentForm";
import { ZERO_ADDRESS } from "@/config/constants";
import type { TFunc } from "@/i18n";
import { formatDateTime, parseAddress } from "@/lib/format";
import type { OpDefinition, OpErrors, SummaryCtx, SummaryRow } from "../types";
import { ensureAgentKey, nameError } from "./common";

/** The exchange refuses an agent that would stay valid for longer. */
export const AGENT_MAX_DAYS = 180;
export const AGENT_DEFAULT_DAYS = 90;
export const AGENT_DAY_PRESETS = [1, 7, 30, 90, 180];
const DAY_MS = 86_400_000;

/** Validity of an approved agent. */
interface Validity {
	/** Whole days, 1…180. Missing in drafts made before the field existed. */
	days?: number;
	/** Expiry in ms, fixed at the first signature so that every signer signs the same action. */
	validUntil?: number;
}

export interface AgentParams extends Validity {
	/** `generate` – the app creates the key and keeps it until the result card is deleted. */
	mode: "generate" | "manual";
	agentAddress: string;
	name: string;
}

export const agentDays = (p: Validity): number => p.days ?? AGENT_DEFAULT_DAYS;

const daysError = (p: Validity, t: TFunc): string | undefined => {
	const days = agentDays(p);
	return Number.isInteger(days) && days >= 1 && days <= AGENT_MAX_DAYS
		? undefined
		: t("hl.agent.validityError", { max: AGENT_MAX_DAYS });
};

const withExpiry = <P extends Validity>(p: P): P => ({ ...p, validUntil: Date.now() + agentDays(p) * DAY_MS });

/**
 * The exchange reads the expiry from the name, exactly as its own front end writes it:
 * `<name> valid_until <ms>`. Without an expiry (operations frozen before the field existed) the name is plain.
 */
const agentAction = (address: string, name: string, validUntil?: number): Record<string, unknown> => ({
	type: "approveAgent",
	agentAddress: address.toLowerCase(),
	agentName: validUntil ? `${name.trim()} valid_until ${validUntil}` : name.trim(),
});

const validityRow = (p: Validity, { t, lang }: SummaryCtx): SummaryRow => ({
	label: t("hl.agent.validity"),
	value: p.validUntil
		? `${t("hl.agent.days", { count: agentDays(p) })} · ${t("hl.agent.validUntil", { date: formatDateTime(p.validUntil, lang) })}`
		: t("hl.agent.days", { count: agentDays(p) }),
});

export const approveAgentOp: OpDefinition<AgentParams> = {
	type: "hl.approveAgent",
	kind: "hl",
	icon: KeyRound,
	available: (env) => !!env.hl,
	defaults: () => ({ mode: "generate", agentAddress: "", name: "", days: AGENT_DEFAULT_DAYS }),
	init: async (opId) => ({ agentAddress: await ensureAgentKey(opId) }),
	Form: ApproveAgentForm,
	validate: (p, _env, t) => {
		const errors: Record<string, string> = {};
		const n = nameError(p.name, t);
		if (n) errors.name = n;
		if (!parseAddress(p.agentAddress))
			errors.agentAddress = t(p.mode === "manual" ? "error.invalidAddress" : "hl.agent.noKey");
		const d = daysError(p, t);
		if (d) errors.days = d;
		return errors;
	},
	prepare: async (p) => withExpiry(p),
	buildHl: (p) => agentAction(p.agentAddress, p.name, p.validUntil),
	summary: (p, ctx) => [
		{ label: ctx.t("common.name"), value: p.name.trim() },
		{ label: ctx.t("hl.agent.address"), value: p.agentAddress, mono: true },
		{
			label: ctx.t("hl.agent.key"),
			value: ctx.t(p.mode === "generate" ? "hl.agent.keyGenerated" : "hl.agent.keyManual"),
		},
		validityRow(p, ctx),
	],
	Result: AgentKeyResult,
	hasSecret: (p) => p.mode === "generate",
	deleteWarning: (op) =>
		(op.params as unknown as AgentParams).mode === "generate" ? "hl.agent.deleteWarning" : undefined,
};

export interface LoginParams extends Validity {
	agentAddress: string;
	name: string;
}

/** Web login = approving a named agent whose key the app generated; the result card builds the login link. */
export const loginOp: OpDefinition<LoginParams> = {
	type: "hl.login",
	kind: "hl",
	icon: LogIn,
	available: (env) => !!env.hl,
	defaults: () => ({ agentAddress: "", name: "Vault login", days: AGENT_DEFAULT_DAYS }),
	init: async (opId) => ({ agentAddress: await ensureAgentKey(opId) }),
	Form: LoginForm,
	validate: (p, _env, t) => {
		const errors: Record<string, string> = {};
		const n = nameError(p.name, t);
		if (n) errors.name = n;
		if (!parseAddress(p.agentAddress)) errors.agentAddress = t("hl.agent.noKey");
		const d = daysError(p, t);
		if (d) errors.days = d;
		return errors;
	},
	prepare: async (p) => withExpiry(p),
	buildHl: (p) => agentAction(p.agentAddress, p.name, p.validUntil),
	summary: (p, ctx) => [
		{ label: ctx.t("hl.login.agentName"), value: p.name.trim() },
		{ label: ctx.t("hl.agent.address"), value: p.agentAddress, mono: true },
		validityRow(p, ctx),
	],
	Result: LoginResult,
	hasSecret: () => true,
	deleteWarning: () => "hl.login.deleteWarning",
};

export interface RevokeParams {
	name: string;
	address: string;
}

export const revokeAgentOp: OpDefinition<RevokeParams> = {
	type: "hl.revokeAgent",
	kind: "hl",
	icon: KeySquare,
	available: (env) => (env.hlExtras?.agents.length ?? 0) > 0,
	defaults: (env) => {
		const first = env.hlExtras?.agents[0];
		return { name: first?.name ?? "", address: first?.address ?? "" };
	},
	Form: RevokeAgentForm,
	validate: (p, _env, t): OpErrors => (p.name ? {} : { name: t("error.required") }),
	// Same as the exchange's own front end (API page → Remove): approving the zero address under
	// the agent's name removes that named agent.
	buildHl: (p) => agentAction(ZERO_ADDRESS, p.name),
	summary: (p, { t }) => [
		{ label: t("common.name"), value: p.name },
		{ label: t("hl.agent.address"), value: p.address, mono: true },
	],
};
