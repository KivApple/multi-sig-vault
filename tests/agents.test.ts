import { describe, expect, it } from "vitest";
import { tNow } from "@/i18n";
import { AGENT_DEFAULT_DAYS, approveAgentOp, loginOp, type AgentParams, type LoginParams } from "@/lib/ops/hl/agents";
import type { HlBuildCtx, OpEnv } from "@/lib/ops/types";

const A = "0x9999999999999999999999999999999999999999";
const env = {} as OpEnv;
const ctx = {} as HlBuildCtx;
const DAY = 86_400_000;

describe("agent validity", () => {
	it("defaults to 90 days", () => {
		expect(AGENT_DEFAULT_DAYS).toBe(90);
		expect((loginOp.defaults(env) as LoginParams).days).toBe(90);
		expect((approveAgentOp.defaults(env) as AgentParams).days).toBe(90);
	});

	it("fixes the expiry at the first signature and writes it into the name like the exchange front end", async () => {
		const draft: LoginParams = { agentAddress: A, name: " Vault login ", days: 30 };
		const before = Date.now();
		const frozen = await loginOp.prepare?.(draft, env);
		expect(frozen?.validUntil).toBeGreaterThanOrEqual(before + 30 * DAY);
		expect(frozen?.validUntil).toBeLessThanOrEqual(Date.now() + 30 * DAY);
		const action = loginOp.buildHl?.(frozen as LoginParams, ctx);
		expect(action).toEqual({
			type: "approveAgent",
			agentAddress: A,
			agentName: `Vault login valid_until ${frozen?.validUntil}`,
		});
		// Rebuilding from the frozen parameters gives the same action – every signer signs one payload.
		expect(loginOp.buildHl?.(frozen as LoginParams, ctx)).toEqual(action);
	});

	it("keeps operations frozen before the field existed unchanged", () => {
		const old = { mode: "manual", agentAddress: A, name: "bot" } as AgentParams;
		expect(approveAgentOp.buildHl?.(old, ctx)).toEqual({ type: "approveAgent", agentAddress: A, agentName: "bot" });
		expect(approveAgentOp.validate(old, env, tNow).days).toBeUndefined();
	});

	it("accepts 1 to 180 whole days only", () => {
		const check = (days: number): string | undefined =>
			approveAgentOp.validate({ mode: "manual", agentAddress: A, name: "bot", days }, env, tNow).days;
		for (const days of [1, 7, 30, 90, 180, 45]) expect(check(days)).toBeUndefined();
		for (const days of [0, 181, -1, 1.5, Number.NaN]) expect(check(days)).toBeTruthy();
		expect(loginOp.validate({ agentAddress: A, name: "x", days: 365 }, env, tNow).days).toBeTruthy();
	});
});
