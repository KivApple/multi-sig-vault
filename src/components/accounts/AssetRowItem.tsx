import { TokenIcon } from "@/components/icons/TokenIcon";
import { useLang, useT } from "@/i18n";
import { formatAmount, formatUsd } from "@/lib/format";
import type { AssetRow } from "@/types/domain";

export interface AssetRowItemProps {
	asset: AssetRow;
}

/** One asset: icon, name, amount in units and USD value (unrealised PnL for perp positions). */
export const AssetRowItem: React.FC<AssetRowItemProps> = ({ asset }) => {
	const t = useT();
	const lang = useLang();
	const perp = asset.kind === "perp";
	const size = Number(asset.amount);
	// Worth a mention only when something is really held back.
	const free = asset.available === undefined ? undefined : Number(asset.available);
	const held = !perp && free !== undefined && size > 0 && free < size * 0.999999;
	const caption = perp
		? `${t(size >= 0 ? "accounts.long" : "accounts.short")} ${asset.note ?? ""}`.trim()
		: asset.note === "perps"
			? t("hl.perps")
			: asset.name;
	return (
		<li className="flex items-center gap-3 px-4 py-2.5">
			<TokenIcon
				symbol={asset.icon.symbol}
				chainId={asset.icon.chainId}
				address={asset.icon.address}
				hl={asset.icon.hl}
				size={36}
			/>
			<div className="min-w-0 flex-1 leading-tight">
				<div className="truncate font-medium">{asset.symbol}</div>
				{caption && <div className="text-base-content/60 truncate text-xs">{caption}</div>}
			</div>
			<div className="tabular shrink-0 text-right leading-tight">
				<div className={`font-medium ${perp ? (asset.usd >= 0 ? "text-success" : "text-error") : ""}`}>
					{perp && asset.usd > 0 ? "+" : ""}
					{formatUsd(asset.usd, lang)}
				</div>
				<div className="text-base-content/60 text-xs">
					{formatAmount(perp ? Math.abs(size) : asset.amount, lang, 6)}
					{perp ? ` · PnL` : ""}
				</div>
				{held && free !== undefined && (
					<div className="text-warning text-xs">
						{t("accounts.availableUnits", { amount: formatAmount(free, lang, 6) })}
					</div>
				)}
			</div>
		</li>
	);
};
