import { ShieldOff, Users } from "lucide-react";
import { getAddress } from "viem";
import { DisableMultiSigForm } from "@/components/ops/hl/DisableMultiSigForm";
import { MultiSigForm } from "@/components/ops/hl/MultiSigForm";
import { AppError } from "@/lib/errors";
import { parseAddress, sameAddress, shortAddress } from "@/lib/format";
import { hlRoleOf } from "@/lib/hl/account";
import type { OpDefinition } from "../types";
import { useUnknownSigners } from "../useUnknownSigners";

export interface MultiSigParams {
	owners: string[];
	threshold: number;
}

export const HL_MAX_SIGNERS = 10;

export const multiSigOp: OpDefinition<MultiSigParams> = {
	type: "hl.multiSig",
	kind: "hl",
	icon: Users,
	available: (env) => !!env.hl,
	defaults: (env) =>
		env.hl?.multiSig
			? { owners: env.hl.multiSig.authorizedUsers.map((a) => getAddress(a)), threshold: env.hl.multiSig.threshold }
			: { owners: [""], threshold: 1 },
	Form: MultiSigForm,
	// Every signer the account is about to depend on that the app has no key for.
	useNotices: (p, env) => useUnknownSigners(p.owners, env),
	validate: (p, env, t) => {
		const errors: Record<string, string> = {};
		p.owners.forEach((o, i) => {
			if (!o) errors[`owner${i}`] = t("error.required");
			else if (!parseAddress(o)) errors[`owner${i}`] = t("error.invalidAddress");
			else if (sameAddress(o, env.account.address)) errors[`owner${i}`] = t("hl.multiSig.selfOwner");
			else if (p.owners.findIndex((x) => sameAddress(x, o)) !== i) errors[`owner${i}`] = t("owners.duplicate");
		});
		if (p.owners.length === 0 || p.owners.length > HL_MAX_SIGNERS) errors.owners = t("hl.multiSig.count");
		if (p.threshold < 1 || p.threshold > p.owners.length) errors.threshold = t("owners.badThreshold");
		return errors;
	},
	prepare: async (p, env) => {
		// Authorised users must already exist on Hyperliquid, otherwise the exchange rejects the action –
		// and be ordinary accounts: an agent key, a vault or a sub-account does not sign for a multi-sig.
		const missing: string[] = [];
		const other: string[] = [];
		for (const owner of p.owners) {
			const role = await hlRoleOf(env.account.env, getAddress(owner));
			if (role === "missing") missing.push(shortAddress(owner));
			else if (role !== "user") other.push(shortAddress(owner));
		}
		if (missing.length > 0) throw new AppError("hl.multiSig.missingUsers", { list: missing.join(", ") });
		if (other.length > 0) throw new AppError("hl.multiSig.notUsers", { list: other.join(", ") });
		return p;
	},
	buildHl: (p) => ({
		type: "convertToMultiSigUser",
		signers: JSON.stringify({
			authorizedUsers: p.owners.map((o) => o.toLowerCase()).sort(),
			threshold: p.threshold,
		}),
	}),
	summary: (p, { t }) => [
		{ label: t("owners.mode"), value: t("owners.mOfN", { m: p.threshold, n: p.owners.length }) },
		...p.owners.map((o, i) => ({ label: t("owners.signerN", { n: i + 1 }), address: getAddress(o) })),
	],
};

export const disableMultiSigOp: OpDefinition<Record<string, never>> = {
	type: "hl.disableMultiSig",
	kind: "hl",
	icon: ShieldOff,
	available: (env) => !!env.hl?.multiSig,
	defaults: () => ({}),
	Form: DisableMultiSigForm,
	validate: () => ({}),
	buildHl: () => ({ type: "convertToMultiSigUser", signers: "null" }),
	summary: (_p, { t, account }) => [
		{ label: t("hl.disable.result"), value: t("hl.disable.resultValue") },
		{ label: t("hl.disable.controlledBy"), address: account.address },
	],
};
