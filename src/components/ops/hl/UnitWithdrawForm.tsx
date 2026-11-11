import { useEffect, useMemo, useState } from "react";
import { AddressField } from "@/components/common/AddressField";
import { AmountField } from "@/components/common/AmountField";
import { TextField } from "@/components/common/TextField";
import { useLang, useT } from "@/i18n";
import { formatAmount } from "@/lib/format";
import {
	fetchUnitFee,
	isEvmUnitChain,
	UNIT_CHAIN_NAME,
	UNIT_EVM_CHAIN_ID,
	unitAssetOf,
	type UnitFee,
} from "@/lib/hl/unit";
import { knownRecipients } from "@/lib/known";
import type { UnitWithdrawParams } from "@/lib/ops/hl/unit";
import type { OpFormProps } from "@/lib/ops/types";
import { SpotTokenSelect, type SpotTokenOption } from "./SpotTokenSelect";

export const UnitWithdrawForm: React.FC<OpFormProps<UnitWithdrawParams>> = ({ value, onChange, env, errors }) => {
	const t = useT();
	const lang = useLang();
	const hlEnv = env.account.env;
	const options = useMemo<SpotTokenOption[]>(
		() =>
			(env.hl?.spot ?? [])
				.filter((s) => unitAssetOf(hlEnv, s.coin))
				.map((s) => {
					const unit = unitAssetOf(hlEnv, s.coin);
					return {
						id: String(s.token),
						coin: s.coin,
						tokenRef: `${s.coin}:${s.tokenId}`,
						balance: s.available,
						usd: s.usd,
						caption: unit ? UNIT_CHAIN_NAME[unit.chain][hlEnv] : undefined,
					};
				}),
		[env.hl, hlEnv],
	);
	const unit = unitAssetOf(hlEnv, value.coin);
	const held = env.hl?.spot.find((s) => s.token === value.token);
	const network = unit ? UNIT_CHAIN_NAME[unit.chain][hlEnv] : "";
	const evmChainId = unit ? UNIT_EVM_CHAIN_ID[unit.chain]?.[hlEnv] : undefined;
	const known = useMemo(
		() =>
			unit && isEvmUnitChain(unit.chain)
				? knownRecipients(env.signers, env.accounts, evmChainId ? { chainId: evmChainId } : { chainId: -1 })
				: [],
		[unit, evmChainId, env.signers, env.accounts],
	);

	// Current network fee and processing time from Unit (shown as a hint, not part of the operation).
	const [fee, setFee] = useState<UnitFee>();
	useEffect(() => {
		setFee(undefined);
		if (!unit || !navigator.onLine) return undefined;
		let stale = false;
		fetchUnitFee(hlEnv, unit)
			.then((f) => {
				if (!stale) setFee(f);
			})
			.catch(() => undefined);
		return () => {
			stale = true;
		};
	}, [unit, hlEnv]);

	const feeHint = unit
		? [
				t("hl.unit.min", { min: formatAmount(unit.min, lang, 8), symbol: unit.symbol }),
				fee?.fee !== undefined ? t("hl.unit.fee", { fee: formatAmount(fee.fee, lang, 8), symbol: unit.symbol }) : "",
				fee?.eta ? t("hl.unit.eta", { eta: fee.eta }) : "",
			]
				.filter(Boolean)
				.join(" · ")
		: undefined;

	return (
		<div className="flex flex-col gap-4">
			<SpotTokenSelect
				value={value.token === null ? undefined : String(value.token)}
				options={options}
				onChange={(o) =>
					onChange({ token: Number(o.id), tokenRef: o.tokenRef, coin: o.coin, amount: "", destination: "" })
				}
				error={errors.token}
			/>
			{unit &&
				(isEvmUnitChain(unit.chain) ? (
					<AddressField
						label={t("ops.recipientOn", { network })}
						value={value.destination}
						onChange={(destination) => onChange({ destination })}
						known={known}
						error={errors.destination}
					/>
				) : (
					<TextField
						label={t("ops.recipientOn", { network })}
						value={value.destination}
						onChange={(destination) => onChange({ destination: destination.trim() })}
						mono
						error={errors.destination}
					/>
				))}
			{unit && (
				<AmountField
					label={t("ops.amount")}
					value={value.amount}
					onChange={(amount) => onChange({ amount })}
					symbol={unit.symbol}
					max={held?.available}
					error={errors.amount}
					hint={feeHint}
				/>
			)}
		</div>
	);
};
