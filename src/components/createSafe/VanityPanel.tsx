import { useMemo } from "react";
import type { Address } from "viem";
import { OwnersEditor } from "@/components/common/OwnersEditor";
import { TextField } from "@/components/common/TextField";
import { CopyButton } from "@/components/ui/CopyButton";
import { Field } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { deadbeefCommand, normalizePrefix } from "@/lib/safe/vanity";

export interface VanityPanelProps {
	chainId: number;
	owners: string[];
	threshold: number;
	/** Valid checksummed owners, when the editor has no errors. */
	validOwners: Address[] | undefined;
	ownerErrors: Record<string, string>;
	onOwners: (owners: string[], threshold: number) => void;
	prefix: string;
	onPrefix: (prefix: string) => void;
	output: string;
	onOutput: (output: string) => void;
	/** Why the pasted output was rejected. */
	outputError?: string;
	/** The pasted output is valid – signers now come from it and the editor is hidden. */
	locked: boolean;
	disabled?: boolean;
}

/**
 * Mode "vanity address": shows the miner command for the chosen signers and takes the miner's
 * output back. Mining happens outside the app (it is CPU/GPU heavy).
 */
export const VanityPanel: React.FC<VanityPanelProps> = ({
	chainId,
	owners,
	threshold,
	validOwners,
	ownerErrors,
	onOwners,
	prefix,
	onPrefix,
	output,
	onOutput,
	outputError,
	locked,
	disabled,
}) => {
	const t = useT();
	const normalized = useMemo(() => normalizePrefix(prefix), [prefix]);
	const command = useMemo(
		() =>
			validOwners && normalized
				? deadbeefCommand({ owners: validOwners, threshold, prefix: normalized, chainId })
				: undefined,
		[validOwners, normalized, threshold, chainId],
	);

	return (
		<div className="flex flex-col gap-4">
			{!locked && (
				<>
					<OwnersEditor
						owners={owners}
						threshold={threshold}
						onChange={onOwners}
						errors={ownerErrors}
						disabled={disabled}
					/>
					<TextField
						label={t("createSafe.vanity.prefix")}
						value={prefix}
						onChange={onPrefix}
						mono
						placeholder="0x5afe"
						hint={t("createSafe.vanity.prefixHint")}
						error={prefix && !normalized ? t("createSafe.vanity.prefixError") : undefined}
						disabled={disabled}
					/>
					{command && (
						<Field
							label={t("createSafe.vanity.command")}
							hint={
								<>
									{t("createSafe.vanity.commandHint")}{" "}
									<a
										className="link"
										href="https://github.com/nlordell/deadbeef"
										target="_blank"
										rel="noopener noreferrer"
									>
										github.com/nlordell/deadbeef
									</a>
								</>
							}
						>
							<div className="bg-base-200 rounded-field flex items-start gap-1 py-1 pr-1 pl-3">
								<code className="mono max-h-32 min-w-0 flex-1 overflow-y-auto py-1.5 text-xs break-all">{command}</code>
								<CopyButton value={command} />
							</div>
						</Field>
					)}
				</>
			)}
			<TextField
				label={t("createSafe.vanity.output")}
				value={output}
				onChange={onOutput}
				mono
				rows={locked ? 3 : 5}
				placeholder={"address:     0x5AFE…\ncalldata:    0x1688f0b9…"}
				hint={locked ? t("createSafe.vanity.outputAccepted") : t("createSafe.vanity.outputHint")}
				error={outputError}
				disabled={disabled}
			/>
		</div>
	);
};
