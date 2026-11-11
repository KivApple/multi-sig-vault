import { useMemo } from "react";
import { CHAIN_KEYS, chainFor, type ChainKey } from "@/config/chains";
import { NetworkIcon } from "@/components/icons/NetworkIcon";
import { Field } from "@/components/ui/Field";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import { useT } from "@/i18n";
import type { NetworkEnv } from "@/types/domain";
import { ChoiceCard } from "./ChoiceCard";

export interface NetworkFieldsProps {
	/** Hidden for Hyperliquid accounts, which only have an environment. */
	showChain: boolean;
	chain: ChainKey;
	env: NetworkEnv;
	onChain: (chain: ChainKey) => void;
	onEnv: (env: NetworkEnv) => void;
	disabled?: boolean;
}

/** Blockchain (for Safe) and mainnet/testnet choice. */
export const NetworkFields: React.FC<NetworkFieldsProps> = ({ showChain, chain, env, onChain, onEnv, disabled }) => {
	const t = useT();
	const envOptions = useMemo<SegmentedOption<NetworkEnv>[]>(
		() => [
			{ value: "mainnet", label: t("common.mainnet") },
			{ value: "testnet", label: t("common.testnet") },
		],
		[t],
	);
	return (
		<>
			{showChain && (
				<Field label={t("common.network")}>
					<div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("common.network")}>
						{CHAIN_KEYS.map((key) => {
							const c = chainFor(key, env);
							return (
								<ChoiceCard
									key={key}
									dense
									selected={key === chain}
									onSelect={() => !disabled && onChain(key)}
									icon={<NetworkIcon chainId={c.id} size={28} />}
									title={c.name}
								/>
							);
						})}
					</div>
				</Field>
			)}
			<Segmented
				value={env}
				options={envOptions}
				onChange={onEnv}
				disabled={disabled}
				ariaLabel={t("addAccount.env")}
			/>
		</>
	);
};
