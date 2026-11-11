import { useCallback, type ChangeEvent } from "react";
import { AddressText } from "@/components/ui/AddressText";
import { useT } from "@/i18n";
import type { DiscoveredAccount } from "@/lib/wallets";

export interface DiscoveredAccountRowProps {
	account: DiscoveredAccount;
	/** Name of the signer when this address is already in the app. */
	existingName?: string;
	selected: boolean;
	name: string;
	onToggle: (address: string) => void;
	onRename: (address: string, name: string) => void;
}

export const DiscoveredAccountRow: React.FC<DiscoveredAccountRowProps> = ({
	account,
	existingName,
	selected,
	name,
	onToggle,
	onRename,
}) => {
	const t = useT();
	const added = existingName !== undefined;
	const handleToggle = useCallback(() => onToggle(account.address), [account.address, onToggle]);
	const handleName = useCallback(
		(e: ChangeEvent<HTMLInputElement>) => onRename(account.address, e.target.value),
		[account.address, onRename],
	);

	return (
		<li className={`px-3 py-2.5 ${added ? "opacity-60" : ""}`}>
			<label className={`flex items-center gap-3 ${added ? "" : "cursor-pointer"}`}>
				<input
					type="checkbox"
					className="checkbox checkbox-primary checkbox-sm"
					checked={added || selected}
					disabled={added}
					onChange={handleToggle}
				/>
				<span className="min-w-0 flex-1">
					{added && <span className="block truncate text-sm font-medium">{existingName}</span>}
					<AddressText address={account.address} className="text-sm" />
					{account.path && <span className="text-base-content/50 mono ml-2 text-xs">{account.path}</span>}
				</span>
				{added && <span className="badge badge-ghost badge-sm">{t("wallets.add.alreadyAdded")}</span>}
			</label>
			{selected && !added && (
				<input
					type="text"
					className="input input-sm mt-2 w-full"
					value={name}
					maxLength={40}
					placeholder={t("wallets.add.namePlaceholder")}
					aria-label={t("wallets.add.namePlaceholder")}
					onChange={handleName}
				/>
			)}
		</li>
	);
};
