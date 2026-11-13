import { TokenIcon } from "@/components/icons/TokenIcon";
import { useLang, useT } from "@/i18n";
import { formatAmount, formatPrice, formatSignedUsd, formatUsd } from "@/lib/format";
import type { AssetRow } from "@/types/domain";

export interface AssetRowItemProps {
	asset: AssetRow;
}

/** The tightest phones get slimmer gutters, so that the last pair of a position – funding and PnL – still fits. */
const ROW = "flex items-center gap-3 px-4 py-2.5 max-[359px]:gap-2 max-[359px]:px-3";

/** Colour is spent on one thing only – the sign of a result; its label stays neutral. */
const signTone = (value: number): string => (value >= 0 ? "text-success" : "text-error");

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
	const icon = (
		<TokenIcon
			symbol={asset.icon.symbol}
			chainId={asset.icon.chainId}
			address={asset.icon.address}
			hl={asset.icon.hl}
			size={36}
		/>
	);
	const prices = perp && pos?.entry && pos.mark ? { entry: pos.entry, mark: pos.mark } : undefined;
	// Funding of a position since it was opened; nothing to say until it adds up to a cent.
	const funding = perp && pos?.funding !== undefined && Math.abs(pos.funding) >= 0.005 ? pos.funding : undefined;
	// A position is pairs of lines, text on the left and money on the right, so both edges stay straight.
	// Wide: name and badge – margin, entry → mark price – size and notional value, funding – PnL.
	// Narrow (the text block under 270px): the badge and the size get a line of their own, which makes four
	// short pairs; that way every position row has the same shape instead of wrapping where it happens to.
	if (perp && pos && badge) {
		const pair = "flex flex-wrap items-center justify-between gap-x-1 text-xs";
		const badgeTone = `badge badge-soft badge-xs shrink-0 whitespace-nowrap ${badge.tone}`;
		const sizeText = formatAmount(Math.abs(size), lang, 6);
		return (
			<li className={ROW}>
				{icon}
				<div className="tabular @container min-w-0 flex-1 leading-tight">
					<div className="flex items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-x-1.5">
							<span className="truncate font-medium">{asset.symbol}</span>
							<span className={`${badgeTone} hidden @min-[270px]:inline-flex`}>{badge.text}</span>
						</div>
						<div className="shrink-0 font-medium">{formatUsd(asset.usd, lang)}</div>
					</div>
					<div className={`${pair} mt-0.5 @min-[270px]:hidden`}>
						<span className={badgeTone}>{badge.text}</span>
						<span className="text-base-content/60 ml-auto whitespace-nowrap">{sizeText}</span>
					</div>
					<div className={`${pair} mt-0.5`}>
						<span className="text-base-content/45 whitespace-nowrap">
							{prices ? `${formatPrice(prices.entry, lang)} → ${formatPrice(prices.mark, lang)}` : ""}
						</span>
						<span className="text-base-content/60 ml-auto whitespace-nowrap">
							<span className="hidden @min-[270px]:inline">{sizeText} · </span>
							{formatUsd(pos.notional, lang)}
						</span>
					</div>
					<div className={`${pair} text-base-content/60`}>
						<span className="whitespace-nowrap">
							{funding !== undefined && (
								<>
									{t("accounts.funding")} <span className={signTone(funding)}>{formatSignedUsd(funding, lang)}</span>
								</>
							)}
						</span>
						<span className="ml-auto whitespace-nowrap">
							{t("accounts.pnl")} <span className={signTone(pos.pnl)}>{formatSignedUsd(pos.pnl, lang)}</span>
						</span>
					</div>
				</div>
			</li>
		);
	}
	return (
		<li className={ROW}>
			{icon}
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
			</div>
			{/* How much of the account sits here, then units. */}
			<div className="tabular shrink-0 text-right leading-tight">
				<div className="font-medium">{formatUsd(asset.usd, lang)}</div>
				<div className="text-base-content/60 text-xs">{formatAmount(asset.amount, lang, 6)}</div>
				{held && free !== undefined && (
					<div className="text-warning text-xs">
						{t("accounts.availableUnits", { amount: formatAmount(free, lang, 6) })}
					</div>
				)}
			</div>
		</li>
	);
};
