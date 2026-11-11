import { Rocket } from "lucide-react";
import { keccak256, size, type Address, type Hex } from "viem";
import { DeployForm } from "@/components/ops/safe/DeployForm";
import { DeployResult } from "@/components/ops/safe/DeployResult";
import { getChain } from "@/config/chains";
import { argErrors, argKind, argLabel, functionSignature, normalizeHex, parseCtorFragment } from "@/lib/evm/abi";
import {
	buildDeploy,
	deployAddress,
	deployInitCode,
	deploySalt,
	deployValueWei as valueWei,
	fetchCreateAddress,
	MAX_INITCODE_BYTES,
	type DeployParams,
} from "@/lib/evm/abiDeploy";
import { simulateOrSkip } from "@/lib/evm/abiSim";
import { AppError } from "@/lib/errors";
import { isDecimal, parseAddress, trimDecimal } from "@/lib/format";
import { getPublicClient } from "@/lib/rpc";
import type { OpDefinition, OpErrors, SummaryRow } from "../types";

const HYPEREVM_SMALL_BLOCK_GAS = 2_000_000n;

export type { DeployParams } from "@/lib/evm/abiDeploy";

export const deployOp: OpDefinition<DeployParams> = {
	type: "safe.deploy",
	kind: "safe",
	icon: Rocket,
	available: () => true,
	defaults: () => ({ bytecodeText: "", bytecode: "", ctor: "", args: [], rawArgs: "", value: "", method: "create", salt: "" }),
	Form: DeployForm,
	validate: (p, env, t) => {
		const errors: OpErrors = {};
		const bytecode = normalizeHex(p.bytecode);
		if (!p.bytecodeText.trim()) errors.bytecode = t("error.required");
		else if (!bytecode || bytecode === "0x") errors.bytecode = t("advanced.err.bytecode");
		const ctor = parseCtorFragment(p.ctor);
		if (ctor) {
			for (const [i, e] of Object.entries(argErrors(ctor.inputs, p.args))) errors[`arg${i}`] = t(e.key, e.vars);
		} else if (!normalizeHex(p.rawArgs)) errors.rawArgs = t("advanced.err.hex");
		if (p.value.trim() && !isDecimal(p.value.trim(), 18)) errors.value = t("advanced.err.amount");
		else if (env.safe && valueWei(p) > BigInt(env.safe.holdings[0]?.balance ?? "0")) errors.value = t("advanced.err.balance");
		else if (ctor && ctor.stateMutability !== "payable" && valueWei(p) > 0n) errors.value = t("advanced.err.ctorNotPayable");
		if (p.method === "create2" && !deploySalt(p.salt)) errors.salt = t("error.required");
		if (Object.keys(errors).length === 0 && size(deployInitCode(p)) > MAX_INITCODE_BYTES) {
			errors.bytecode = t("advanced.err.initcodeSize", { max: MAX_INITCODE_BYTES });
		}
		return errors;
	},
	prepare: async (p, env) => {
		const chainId = env.account.chainId as number;
		const safe = env.account.address;
		const bytecode = normalizeHex(p.bytecode) as Hex;
		const next: DeployParams = {
			...p,
			bytecodeText: bytecode,
			bytecode,
			value: trimDecimal(p.value.trim()),
			rawArgs: parseCtorFragment(p.ctor) ? "" : (normalizeHex(p.rawArgs) ?? "0x"),
			args: parseCtorFragment(p.ctor) ? p.args : [],
			expectedAddress: undefined,
			warnings: [],
		};
		if (next.method === "create") {
			next.salt = "";
			next.expectedAddress = await fetchCreateAddress(chainId, safe).catch(() => undefined);
		} else {
			const predicted = deployAddress(next, safe);
			if (predicted) {
				const code = await getPublicClient(chainId).getCode({ address: predicted }).catch(() => undefined);
				if (code && code !== "0x") throw new AppError("advanced.err.alreadyDeployed");
			}
		}
		const [call] = buildDeploy(next);
		const sim = await simulateOrSkip(chainId, safe, { ...call, operation: 1 });
		if (sim && getChain(chainId).key === "hyperevm" && sim.gas > HYPEREVM_SMALL_BLOCK_GAS) {
			next.warnings = ["advanced.warn.bigBlock"];
		}
		return next;
	},
	buildSafe: (p) => buildDeploy(p),
	summary: (p, { t, account }) => {
		const chainId = account.chainId as number;
		const rows: SummaryRow[] = [];
		let initCode: Hex | undefined;
		try {
			initCode = deployInitCode(p);
		} catch {
			// Incomplete draft.
		}
		if (initCode) {
			rows.push({ label: t("advanced.initCode"), value: `${t("advanced.bytes", { count: size(initCode) })} · ${keccak256(initCode)}`, mono: true });
		}
		const ctor = parseCtorFragment(p.ctor);
		if (ctor && ctor.inputs.length > 0) {
			rows.push({ label: t("advanced.constructor"), value: functionSignature(ctor), mono: true });
			ctor.inputs.forEach((input, i) => {
				const raw = p.args[i] ?? "";
				const address = argKind(input) === "address" ? parseAddress(raw) : undefined;
				rows.push(address ? { label: argLabel(input, i), address, chainId } : { label: argLabel(input, i), value: raw, mono: input.type !== "string" });
			});
		}
		rows.push({ label: t("advanced.method"), value: p.method === "create2" ? "CREATE2" : "CREATE" });
		if (p.method === "create2") {
			const salt = deploySalt(p.salt);
			if (salt) rows.push({ label: t("advanced.salt"), value: salt, mono: true });
			const address = deployAddress(p, account.address);
			if (address) rows.push({ label: t("advanced.contractAddress"), address, chainId });
		} else if (p.expectedAddress) {
			rows.push({ label: t("advanced.expectedAddress"), address: p.expectedAddress as Address, chainId });
			rows.push({ label: "", value: t("advanced.expectedAddressHint") });
		}
		if (p.value.trim() && valueWei(p) > 0n) {
			rows.push({ label: t("advanced.value"), value: `${trimDecimal(p.value.trim())} ${getChain(chainId).nativeSymbol}` });
		}
		for (const key of p.warnings ?? []) rows.push({ label: "", value: t(key), tone: "warning" });
		return rows;
	},
	Result: DeployResult,
};

