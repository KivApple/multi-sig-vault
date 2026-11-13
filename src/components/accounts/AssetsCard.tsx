import { useCallback, useMemo } from "react";
import { DUST_USD } from "@/config/constants";
import { useT } from "@/i18n";
import { useAppStore } from "@/store/appStore";
import type { Account, AssetRow } from "@/types/domain";
import { AssetRowItem } from "./AssetRowItem";

export interface AssetsCardProps {
	account: Account;
	assets: AssetRow[];
}

/** Asset breakdown sorted by USD value, with a per-account "hide dust" switch. */
export const AssetsCard: React.FC<AssetsCardProps> = ({ account, assets }) => {
	const t = useT();
	const sorted = useMemo(() => [...assets].sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd)), [assets]);
	const dust = useMemo(() => sorted.filter((a) => a.kind !== "perp" && Math.abs(a.usd) < DUST_USD).length, [sorted]);
	const visible = useMemo(
		() => (account.hideDust ? sorted.filter((a) => a.kind === "perp" || Math.abs(a.usd) >= DUST_USD) : sorted),
		[sorted, account.hideDust],
	);
	const toggleDust = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			useAppStore.getState().updateAccount(account.id, { hideDust: e.target.checked });
		},
		[account.id],
	);

	return (
		<section className="card-surface">
			<header className="flex items-center justify-between px-4 pt-3 pb-1 max-[359px]:px-3">
				<h2 className="text-base-content/60 text-xs font-semibold tracking-wide uppercase">{t("accounts.assets")}</h2>
				{dust > 0 && (
					<label className="text-base-content/70 flex cursor-pointer items-center gap-2 text-xs">
						<input type="checkbox" className="checkbox checkbox-xs" checked={account.hideDust} onChange={toggleDust} />
						{t("accounts.hideDust")}
					</label>
				)}
			</header>
			{visible.length > 0 ? (
				<ul className="divide-base-300/60 divide-y">
					{visible.map((asset) => (
						<AssetRowItem key={asset.key} asset={asset} />
					))}
				</ul>
			) : (
				<p className="text-base-content/60 px-4 py-6 text-center text-sm">{t("accounts.noAssets")}</p>
			)}
		</section>
	);
};
