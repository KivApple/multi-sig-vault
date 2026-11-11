import { FileCode2 } from "lucide-react";
import { getAddress, keccak256, size, type Address, type Hex } from "viem";
import { CallForm } from "@/components/ops/safe/CallForm";
import { getChain } from "@/config/chains";
import { argErrors, argKind, argLabel, functionSelector, functionSignature, normalizeHex, parseFragment } from "@/lib/evm/abi";
import { callData, callValueWei as valueWei, type CallParams } from "@/lib/evm/abiCall";
import { hasCode, simulateOrSkip } from "@/lib/evm/abiSim";
import { AppError } from "@/lib/errors";
import { isDecimal, parseAddress, trimDecimal } from "@/lib/format";
import type { OpDefinition, OpErrors, SummaryRow } from "../types";

export type { CallParams } from "@/lib/evm/abiCall";

export const callOp: OpDefinition<CallParams> = {
	type: "safe.call",
	kind: "safe",
	icon: FileCode2,
	available: () => true,
	defaults: () => ({ to: "", value: "", mode: "abi", abiText: "", fragment: "", args: [], data: "" }),
	Form: CallForm,
	validate: (p, env, t) => {
		const errors: OpErrors = {};
		if (!parseAddress(p.to)) errors.to = t("error.invalidAddress");
		if (p.value.trim() && !isDecimal(p.value.trim(), 18)) errors.value = t("advanced.err.amount");
		if (p.mode === "raw") {
			const hex = normalizeHex(p.data);
			if (!hex) errors.data = t("advanced.err.hex");
			else if (hex === "0x" && !errors.value && valueWei(p) === 0n) errors.data = t("advanced.err.emptyCall");
		} else {
			const fn = parseFragment(p.fragment);
			if (!fn) errors.fragment = t("advanced.err.noFunction");
			else {
				for (const [i, e] of Object.entries(argErrors(fn.inputs, p.args))) errors[`arg${i}`] = t(e.key, e.vars);
				if (fn.stateMutability !== "payable" && !errors.value && valueWei(p) > 0n) errors.value = t("advanced.err.notPayable");
			}
		}
		if (!errors.value && env.safe && valueWei(p) > BigInt(env.safe.holdings[0]?.balance ?? "0")) {
			errors.value = t("advanced.err.balance");
		}
		return errors;
	},
	prepare: async (p, env) => {
		const chainId = env.account.chainId as number;
		const to = getAddress(p.to.trim());
		const data = callData(p);
		if (p.mode === "abi" && (await hasCode(chainId, to)) === false) throw new AppError("advanced.err.noCode");
		await simulateOrSkip(chainId, env.account.address, { to, value: valueWei(p), data, operation: 0 });
		return { ...p, to, value: trimDecimal(p.value.trim()), abiText: "", data };
	},
	buildSafe: (p) => {
		const data = callData(p);
		// The stored calldata must be exactly what the function and arguments shown to signers encode to.
		if (p.mode === "abi" && p.data && p.data !== data) throw new AppError("ops.error.mismatch");
		return [{ to: getAddress(p.to), value: valueWei(p), data }];
	},
	summary: (p, { t, account }) => {
		const chainId = account.chainId as number;
		const rows: SummaryRow[] = [{ label: t("advanced.contract"), address: p.to as Address, chainId }];
		const fn = p.mode === "abi" ? parseFragment(p.fragment) : undefined;
		let data: Hex = "0x";
		try {
			data = callData(p);
		} catch {
			// Draft with incomplete input – nothing to show yet.
		}
		if (fn) {
			rows.push({ label: t("advanced.function"), value: functionSignature(fn), mono: true });
			fn.inputs.forEach((input, i) => {
				const raw = p.args[i] ?? "";
				const address = argKind(input) === "address" ? parseAddress(raw) : undefined;
				rows.push(
					address
						? { label: argLabel(input, i), address, chainId }
						: { label: argLabel(input, i), value: raw, mono: input.type !== "string" },
				);
			});
			rows.push({ label: t("advanced.selector"), value: `${functionSelector(fn)} · ${t("advanced.bytes", { count: size(data) })}`, mono: true });
		} else if (data !== "0x") {
			rows.push({ label: t("advanced.data"), value: data.length <= 138 ? data : `${data.slice(0, 74)}…`, mono: true });
			rows.push({ label: t("advanced.dataHash"), value: `${keccak256(data)} · ${t("advanced.bytes", { count: size(data) })}`, mono: true });
		}
		if (p.value.trim() && valueWei(p) > 0n) {
			rows.push({ label: t("advanced.value"), value: `${trimDecimal(p.value.trim())} ${getChain(chainId).nativeSymbol}` });
		}
		return rows;
	},
};
