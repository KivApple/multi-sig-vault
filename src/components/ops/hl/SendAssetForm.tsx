import { useMemo } from "react";
import { AddressField } from "@/components/common/AddressField";
import { AmountField } from "@/components/common/AmountField";
import { useT } from "@/i18n";
import { knownRecipients } from "@/lib/known";
import type { SendParams } from "@/lib/ops/hl/transfers";
import type { OpFormProps } from "@/lib/ops/types";
import { SpotTokenSelect, type SpotTokenOption } from "./SpotTokenSelect";
import { useTransferFee } from "./useTransferFee";

/** What can be sent: USDC of the perp balance (where it is a balance of its own) and every spot token. */
export const sendOptions = (env: OpFormProps<SendParams>["env"], t: (k: string) => string): SpotTokenOption[] => {
	const out: SpotTokenOption[] = [];
	// In a unified mode USDC is one balance, on spot; otherwise the perp balance is offered first.
	if (env.hl && !env.hl.unified) {
		out.push({
			id: "perp",
			coin: "USDC",
			tokenRef: env.hl.usdcToken,
			balance: env.hl.withdrawable,
			caption: t("hl.perps"),
		});
	}
	for (const s of env.hl?.spot ?? []) {
		out.push({
			id: String(s.token),
			coin: s.coin,
			tokenRef: `${s.coin}:${s.tokenId}`,
			balance: s.available,
			usd: s.usd,
			caption: env.hl?.unified ? undefined : t("hl.spot"),
		});
	}
	return out;
};

export const SendAssetForm: React.FC<OpFormProps<SendParams>> = ({ value, onChange, env, errors }) => {
	const t = useT();
	const known = useMemo(
		() => knownRecipients(env.signers, env.accounts, { hlEnv: env.account.env }, env.account.address),
		[env.signers, env.accounts, env.account],
	);
	const options = useMemo(() => sendOptions(env, t), [env, t]);
	const selected = options.find((o) => o.id === value.asset);
	const fee = useTransferFee(env.account, value.destination);
	return (
		<div className="flex flex-col gap-4">
			<SpotTokenSelect
				value={selected?.id}
				options={options}
				onChange={(o) => onChange({ asset: o.id, tokenRef: o.tokenRef, coin: o.coin, amount: "" })}
				error={errors.asset}
			/>
			<AddressField
				label={t("ops.recipientHl")}
				value={value.destination}
				onChange={(destination) => onChange({ destination })}
				known={known}
				error={errors.destination}
				hint={fee}
			/>
			{selected && (
				<AmountField
					label={t("ops.amount")}
					value={value.amount}
					onChange={(amount) => onChange({ amount })}
					symbol={value.coin}
					max={selected.balance}
					error={errors.amount}
				/>
			)}
		</div>
	);
};
