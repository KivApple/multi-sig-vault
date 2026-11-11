import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import type { TFunc } from "@/i18n";
import { isDecimal, parseAddress, sameAddress } from "@/lib/format";
import { agentKeyId, secureGet, secureSet } from "@/lib/secureStore";

/** Validates a decimal amount against precision and available balance; returns a message or undefined. */
export const amountError = (
	value: string,
	t: TFunc,
	opts: { decimals: number; max?: string; min?: number; minExclusive?: boolean; symbol?: string },
): string | undefined => {
	if (!value) return t("error.required");
	if (!isDecimal(value, opts.decimals) || Number(value) <= 0) return t("amount.invalid", { decimals: opts.decimals });
	const n = Number(value);
	if (opts.min !== undefined && (opts.minExclusive ? n <= opts.min : n < opts.min)) {
		return t(opts.minExclusive ? "amount.minExclusive" : "amount.min", { min: opts.min, symbol: opts.symbol ?? "" });
	}
	if (opts.max !== undefined && n > Number(opts.max)) return t("amount.exceeds");
	return undefined;
};

export const addressError = (value: string, t: TFunc, self?: string): string | undefined => {
	if (!value) return t("error.required");
	if (!parseAddress(value)) return t("error.invalidAddress");
	if (self && sameAddress(value, self)) return t("address.self");
	return undefined;
};

/** Sub-account and agent names: 1–16 characters. */
export const nameError = (value: string, t: TFunc): string | undefined => {
	const v = value.trim();
	if (!v) return t("error.required");
	if (v.length > 16) return t("hl.nameTooLong");
	return undefined;
};

/** Returns the address of the operation's agent key, generating and storing the key on first use. */
export const ensureAgentKey = async (opId: string): Promise<Address> => {
	const id = agentKeyId(opId);
	let key = (await secureGet(id)) as Hex | undefined;
	if (!key) {
		key = generatePrivateKey();
		await secureSet(id, key);
	}
	return privateKeyToAccount(key).address;
};

export const getAgentKey = async (opId: string): Promise<Hex | undefined> =>
	(await secureGet(agentKeyId(opId))) as Hex | undefined;

export const storeAgentKey = (opId: string, key: Hex): Promise<void> => secureSet(agentKeyId(opId), key);

export const agentAddressOf = (key: Hex): Address => privateKeyToAccount(key).address;
