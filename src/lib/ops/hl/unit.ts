import { Bitcoin } from "lucide-react";
import { UnitWithdrawForm } from "@/components/ops/hl/UnitWithdrawForm";
import { AppError } from "@/lib/errors";
import { formatAmount, trimDecimal } from "@/lib/format";
import {
	fetchUnitAddress,
	isUnitDestination,
	normalizeUnitDestination,
	UNIT_CHAIN_NAME,
	UNIT_EVM_CHAIN_ID,
	unitAssetOf,
	verifyUnitAddress,
} from "@/lib/hl/unit";
import type { OpDefinition } from "../types";
import { amountError } from "./common";

export interface UnitWithdrawParams {
	/** Token index on HyperCore. */
	token: number | null;
	/** `NAME:0xTokenId`. */
	tokenRef: string;
	coin: string;
	amount: string;
	/** Address on the native chain. */
	destination: string;
	/** Unit's Hyperliquid address for that destination – resolved before the first signature. */
	protocolAddress: string;
	/** Guardian signatures binding `destination` to `protocolAddress`. */
	signatures: Record<string, string>;
}

/** Spot token → its native chain (BTC to Bitcoin, SOL to Solana…) through the Unit bridge. */
export const unitWithdrawOp: OpDefinition<UnitWithdrawParams> = {
	type: "hl.unitWithdraw",
	kind: "hl",
	icon: Bitcoin,
	available: (env) => !!env.hl && env.hl.spot.some((s) => unitAssetOf(env.account.env, s.coin)),
	defaults: () => ({
		token: null,
		tokenRef: "",
		coin: "",
		amount: "",
		destination: "",
		protocolAddress: "",
		signatures: {},
	}),
	Form: UnitWithdrawForm,
	validate: (p, env, t) => {
		const errors: Record<string, string> = {};
		const unit = unitAssetOf(env.account.env, p.coin);
		if (p.token === null || !unit) {
			errors.token = t("error.required");
			return errors;
		}
		const held = env.hl?.spot.find((s) => s.token === p.token);
		const a = amountError(p.amount, t, { decimals: 8, max: held?.available, min: unit.min, symbol: unit.symbol });
		if (a) errors.amount = a;
		if (!p.destination) errors.destination = t("error.required");
		else if (!isUnitDestination(unit.chain, p.destination, env.account.env)) {
			errors.destination = t("hl.unit.badAddress", { network: UNIT_CHAIN_NAME[unit.chain][env.account.env] });
		}
		return errors;
	},
	prepare: async (p, env) => {
		const unit = unitAssetOf(env.account.env, p.coin);
		if (!unit) throw new AppError("ops.error.mismatch");
		const destination = normalizeUnitDestination(unit.chain, p.destination);
		const generated = await fetchUnitAddress(env.account.env, unit, destination);
		return { ...p, destination, protocolAddress: generated.address, signatures: generated.signatures };
	},
	buildHl: (p, { env }) => {
		const unit = unitAssetOf(env, p.coin);
		// Re-checked on every build (signing, sending, import): the transfer may only go to the address
		// Unit's guardians signed for exactly this destination.
		if (!unit || !p.tokenRef.startsWith(`${p.coin}:`)) throw new AppError("ops.error.mismatch");
		if (!verifyUnitAddress(env, unit, p.destination, p.protocolAddress, p.signatures)) {
			throw new AppError("hl.unit.error.unverified");
		}
		return {
			type: "spotSend",
			destination: p.protocolAddress.toLowerCase(),
			token: p.tokenRef,
			amount: trimDecimal(p.amount),
		};
	},
	summary: (p, { t, lang, account }) => {
		const unit = unitAssetOf(account.env, p.coin);
		const evmChainId = unit ? UNIT_EVM_CHAIN_ID[unit.chain]?.[account.env] : undefined;
		return [
			{ label: t("ops.amount"), value: `${formatAmount(p.amount, lang, 8)} ${unit?.symbol ?? p.coin}` },
			{ label: t("common.network"), value: unit ? UNIT_CHAIN_NAME[unit.chain][account.env] : "" },
			evmChainId !== undefined
				? { label: t("ops.recipient"), address: p.destination as never, chainId: evmChainId }
				: { label: t("ops.recipient"), value: p.destination, mono: true },
			{ label: t("hl.unit.via"), value: p.protocolAddress, mono: true },
			{ label: "", value: t("hl.unit.feeNote") },
		];
	},
};
