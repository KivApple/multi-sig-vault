import { useMemo } from "react";
import type { Address } from "viem";
import { AccountIcon } from "@/components/icons/AccountIcon";
import { WalletIcon } from "@/components/icons/WalletIcon";
import { shortAddress } from "@/lib/format";
import { resolveKnown, type AddressScope } from "@/lib/known";
import { useAppStore } from "@/store/appStore";

export interface AddressLabelProps {
	address: Address | string;
	scope?: AddressScope;
	/** Icon size; the row is two lines (name + address) when the address is known. */
	size?: number;
	/** Single line: name only for known addresses. */
	compact?: boolean;
	className?: string;
}

/**
 * The one way addresses are shown: wallet/account icon and name when the app knows the address,
 * dimmed short address otherwise.
 */
export const AddressLabel: React.FC<AddressLabelProps> = ({ address, scope, size = 28, compact, className }) => {
	const signers = useAppStore((s) => s.signers);
	const accounts = useAppStore((s) => s.accounts);
	const known = useMemo(() => resolveKnown(address, signers, accounts, scope), [address, signers, accounts, scope]);

	if (!known) {
		return (
			<span className={`mono text-base-content/50 inline-flex items-center ${className ?? ""}`} title={address}>
				{shortAddress(address)}
			</span>
		);
	}
	// Without a scope the address is "who did it" – a signer; with a scope it is "where it goes" – an account.
	const scoped = !!scope && Object.keys(scope).length > 0;
	const account = scoped || !known.signer ? known.account : undefined;
	const unnamed = !!account && !account.name?.trim();
	const name = account ? account.name?.trim() || shortAddress(address) : known.signer?.name;
	return (
		<span className={`inline-flex min-w-0 items-center gap-2 ${className ?? ""}`} title={address}>
			{account ? (
				<AccountIcon kind={account.kind} env={account.env} chainId={account.chainId} size={size} />
			) : (
				known.signer && <WalletIcon kind={known.signer.wallet} size={size} />
			)}
			<span className="flex min-w-0 flex-col leading-tight">
				<span className={`truncate font-medium ${unnamed ? "mono" : ""}`}>{name}</span>
				{!compact && !unnamed && <span className="mono text-base-content/60 text-xs">{shortAddress(address)}</span>}
			</span>
		</span>
	);
};
