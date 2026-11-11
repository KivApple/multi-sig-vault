/** Symbols that share an icon with another asset (wrapped, bridged and staked variants). */
const ALIASES: Record<string, string> = {
	WETH: "ETH",
	UETH: "ETH",
	WHYPE: "HYPE",
	USDT0: "USDT",
	"USD₮0": "USDT",
	"USD₮": "USDT",
	USDTE: "USDT",
	"USDC.E": "USDC",
	USDBC: "USDC",
	UBTC: "BTC",
	USOL: "SOL",
	UFART: "FARTCOIN",
	UPUMP: "PUMP",
	UXPL: "XPL",
	UENA: "ENA",
	UBONK: "BONK",
	WBNB: "BNB",
	WAVAX: "AVAX",
	WMATIC: "MATIC",
	WPOL: "POL",
	RNDR: "RENDER",
};

/**
 * Key of the built-in icon for a token symbol.
 * `hl` – Hyperliquid coin names: `kPEPE` (1000× contracts) → PEPE, `xyz:AMZN` (HIP-3 dex) → AMZN.
 */
export const iconSymbol = (symbol: string, hl = false): string => {
	let s = symbol.trim();
	if (hl) {
		const colon = s.lastIndexOf(":");
		if (colon >= 0) s = s.slice(colon + 1);
		if (/^k[A-Z0-9]/.test(s)) s = s.slice(1);
	}
	s = s.toUpperCase();
	return ALIASES[s] ?? s;
};

/** Stable hue (0–359) for the letter avatar of a symbol. */
export const symbolHue = (symbol: string): number => {
	let h = 0;
	for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
	return h % 360;
};
