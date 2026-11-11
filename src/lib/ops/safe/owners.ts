import { Users } from "lucide-react";
import { encodeFunctionData, getAddress, type Address } from "viem";
import { SafeOwnersForm } from "@/components/ops/safe/SafeOwnersForm";
import { parseAddress, sameAddress } from "@/lib/format";
import { SAFE_ABI } from "@/lib/safe/abis";
import type { MetaTx } from "@/lib/safe/tx";
import type { OpDefinition } from "../types";

export interface SafeOwnersParams {
	owners: string[];
	threshold: number;
	/** Snapshot of the on-chain owner list (order matters) and threshold the change is computed from. */
	current: string[];
	currentThreshold: number;
}

const SENTINEL: Address = "0x0000000000000000000000000000000000000001";

/**
 * Turns "current owners → target owners + threshold" into Safe owner-management calls.
 * Owners form a linked list on-chain, so every call needs the previous owner at that moment.
 */
export const planOwnerChanges = (safe: Address, p: SafeOwnersParams): MetaTx[] => {
	const list = p.current.map((o) => getAddress(o));
	const target = p.owners.map((o) => getAddress(o));
	const removals = list.filter((o) => !target.some((x) => sameAddress(x, o)));
	const additions = target.filter((o) => !list.some((x) => sameAddress(x, o)));
	const calls: MetaTx[] = [];
	let threshold = p.currentThreshold;
	const prevOf = (owner: Address): Address => {
		const i = list.findIndex((o) => sameAddress(o, owner));
		return i <= 0 ? SENTINEL : list[i - 1];
	};
	const push = (data: `0x${string}`): void => {
		calls.push({ to: safe, value: 0n, data });
	};

	while (removals.length > 0 && additions.length > 0) {
		const oldOwner = removals.shift() as Address;
		const newOwner = additions.shift() as Address;
		push(
			encodeFunctionData({ abi: SAFE_ABI, functionName: "swapOwner", args: [prevOf(oldOwner), oldOwner, newOwner] }),
		);
		list[list.findIndex((o) => sameAddress(o, oldOwner))] = newOwner;
	}
	for (const owner of additions) {
		// Keep the threshold valid at every step; the final value is set below.
		push(
			encodeFunctionData({ abi: SAFE_ABI, functionName: "addOwnerWithThreshold", args: [owner, BigInt(threshold)] }),
		);
		list.unshift(owner);
	}
	for (const owner of removals) {
		const next = Math.min(threshold, list.length - 1, p.threshold);
		push(
			encodeFunctionData({ abi: SAFE_ABI, functionName: "removeOwner", args: [prevOf(owner), owner, BigInt(next)] }),
		);
		list.splice(
			list.findIndex((o) => sameAddress(o, owner)),
			1,
		);
		threshold = next;
	}
	if (threshold !== p.threshold) {
		push(encodeFunctionData({ abi: SAFE_ABI, functionName: "changeThreshold", args: [BigInt(p.threshold)] }));
	}
	return calls;
};

export const safeOwnersOp: OpDefinition<SafeOwnersParams> = {
	type: "safe.owners",
	kind: "safe",
	icon: Users,
	available: (env) => !!env.safe,
	defaults: (env) => ({
		owners: [...(env.safe?.owners ?? [])],
		threshold: env.safe?.threshold ?? 1,
		current: [...(env.safe?.owners ?? [])],
		currentThreshold: env.safe?.threshold ?? 1,
	}),
	Form: SafeOwnersForm,
	validate: (p, env, t) => {
		const errors: Record<string, string> = {};
		p.owners.forEach((o, i) => {
			if (!o) errors[`owner${i}`] = t("error.required");
			else if (!parseAddress(o)) errors[`owner${i}`] = t("error.invalidAddress");
			else if (sameAddress(o, env.account.address) || BigInt(o) <= 1n)
				errors[`owner${i}`] = t("safe.owners.invalidOwner");
			else if (p.owners.findIndex((x) => sameAddress(x, o)) !== i) errors[`owner${i}`] = t("owners.duplicate");
		});
		if (p.owners.length === 0) errors.owners = t("error.required");
		if (p.threshold < 1 || p.threshold > p.owners.length) errors.threshold = t("owners.badThreshold");
		if (Object.keys(errors).length === 0 && env.safe) {
			const same =
				p.threshold === env.safe.threshold &&
				p.owners.length === env.safe.owners.length &&
				p.owners.every((o) => env.safe?.owners.some((x) => sameAddress(x, o)));
			if (same) errors.owners = t("safe.owners.noChange");
		}
		return errors;
	},
	// The change is computed against the owner list as it is right before signing.
	prepare: async (p, env) => ({
		...p,
		current: [...(env.safe?.owners ?? p.current)],
		currentThreshold: env.safe?.threshold ?? p.currentThreshold,
	}),
	buildSafe: (p, { safe }) => planOwnerChanges(safe, p),
	summary: (p, { t, account }) => {
		const added = p.owners.filter((o) => !p.current.some((x) => sameAddress(x, o)));
		const removed = p.current.filter((o) => !p.owners.some((x) => sameAddress(x, o)));
		return [
			{
				label: t("owners.mode"),
				value:
					p.threshold === p.currentThreshold && p.owners.length === p.current.length
						? t("owners.mOfN", { m: p.threshold, n: p.owners.length })
						: `${t("owners.mOfN", { m: p.currentThreshold, n: p.current.length })} → ${t("owners.mOfN", { m: p.threshold, n: p.owners.length })}`,
			},
			...added.map((o) => ({ label: t("safe.owners.added"), address: getAddress(o), chainId: account.chainId })),
			...removed.map((o) => ({ label: t("safe.owners.removed"), address: getAddress(o), chainId: account.chainId })),
		];
	},
};
