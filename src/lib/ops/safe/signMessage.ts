import { Signature } from "lucide-react";
import type { Hex } from "viem";
import { isBytes32, safeMessageHash, signMessageCalldata } from "@/lib/evm/abiSignMessage";
import { SignMessageForm } from "@/components/ops/safe/SignMessageForm";
import { SAFE_141 } from "@/lib/safe/deployments";
import type { OpDefinition, OpErrors } from "../types";

export interface SignMessageParams {
	/** 32-byte hash the Safe approves for EIP-1271. */
	hash: string;
}

export const signMessageOp: OpDefinition<SignMessageParams> = {
	type: "safe.signMessage",
	kind: "safe",
	icon: Signature,
	available: () => true,
	defaults: () => ({ hash: "" }),
	Form: SignMessageForm,
	validate: (p, _env, t): OpErrors => (isBytes32(p.hash) ? {} : { hash: t("advanced.err.bytes32") }),
	prepare: async (p) => ({ hash: p.hash.trim().toLowerCase() }),
	buildSafe: (p) => {
		if (!isBytes32(p.hash)) throw new Error("Invalid hash");
		return [
			{
				to: SAFE_141.signMessageLib,
				value: 0n,
				data: signMessageCalldata(p.hash.trim().toLowerCase() as Hex),
				operation: 1,
			},
		];
	},
	summary: (p, { t, account }) =>
		isBytes32(p.hash)
			? [
					{ label: t("advanced.hash"), value: p.hash.trim().toLowerCase(), mono: true },
					{
						label: t("advanced.safeMessageHash"),
						value: safeMessageHash(account.chainId as number, account.address, p.hash.trim().toLowerCase() as Hex),
						mono: true,
					},
				]
			: [],
};
