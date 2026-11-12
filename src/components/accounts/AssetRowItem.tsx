import { TokenIcon } from "@/components/icons/TokenIcon";
import { useLang, useT } from "@/i18n";
import { formatAmount, formatUsd } from "@/lib/format";
import type { AssetRow } from "@/types/domain";

export interface AssetRowItemProps {
	asset: AssetRow;
}

/**
 * One asset: icon, name, USD value and amount in units. Exchange assets carry a badge saying what they
 * are – spot, or a position with its side, margin mode and current leverage.
 */
export const AssetRowItem: React.FC<AssetRowItemProps> = ({ asset }) => {
	const t = useT();
	const lang = useLang();
	const perp = asset.kind === "perp";
	const size = Number(asset.amount);
	// Worth a mention only when something is really held back.
	const free = asset.available === undefined ? undefined : Number(asset.available);
	const held = !perp && free !== undefined && size > 0 && free < size * 0.999999;
	const pos = asset.position;
	// Leverage as it is now: position value over the margin behind it. Adding or removing margin moves it,
	// unlike the leverage setting the position was opened with.
	const leverage = pos && pos.margin > 0 ? pos.notional / pos.margin : undefined;
	const leverageText =
		leverage === undefined
			? (asset.note ?? "")
			: `x${leverage >= 10 ? Math.round(leverage) : Math.round(leverage * 10) / 10}`;
	const badge = perp
		? {
				tone: size >= 0 ? "badge-success" : "badge-error",
				text: [
					pos ? t(pos.isolated ? "accounts.isolated" : "accounts.cross") : "",
					t(size >= 0 ? "accounts.long" : "accounts.short"),
					leverageText,
				]
					.filter(Boolean)
					.join(" "),
			}
		: asset.note === "perps"
			? { tone: "badge-neutral", text: t("hl.perps") }
			: asset.kind === "spot"
				? { tone: "badge-info", text: t("accounts.spot") }
				: undefined;
	const caption = perp || asset.note === "perps" ? undefined : asset.name;
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
				{(badge || caption) && (
					<div className="text-base-content/60 mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
						{badge && (
							<span className={`badge badge-soft badge-xs max-w-full shrink-0 whitespace-nowrap ${badge.tone}`}>
								{badge.text}
							</span>
						)}
						{caption && <span className="min-w-0 truncate">{caption}</span>}
					</div>
				)}
				{perp && pos && (
					<div className="text-base-content/60 mt-0.5 truncate text-xs">
						{t("accounts.margin", { amount: formatUsd(pos.margin, lang) })}
					</div>
				)}
			</div>
			{/* Every row reads the same way: value, then units. A position adds its result in colour; its margin sits
			    under the badge on the left, so both columns stay short enough for a narrow phone. */}
			<div className="tabular shrink-0 text-right leading-tight">
				<div className="font-medium">{formatUsd(perp && pos ? pos.notional : asset.usd, lang)}</div>
				<div className="text-base-content/60 text-xs">
					{formatAmount(perp ? Math.abs(size) : asset.amount, lang, 6)}
				</div>
				{perp && (
					<div className={`text-xs ${asset.usd >= 0 ? "text-success" : "text-error"}`}>
						{t("accounts.pnl", { amount: `${asset.usd > 0 ? "+" : ""}${formatUsd(asset.usd, lang)}` })}
					</div>
				)}
				{held && free !== undefined && (
					<div className="text-warning text-xs">
						{t("accounts.availableUnits", { amount: formatAmount(free, lang, 6) })}
					</div>
				)}
			</div>
		</li>
	);
};
