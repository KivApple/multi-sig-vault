// Builds src/assets/icons (run: pnpm tokens:icons) from the @web3icons/core pack and, where the pack
// redraws or miscolours a mark, from the projects' own files in scripts/tokens/official.
//  - brand/*.svg, network/*.svg  – wallet, account and network logos on their brand chip
//  - token/*.svg                 – core token icons available synchronously
//  - token-pack.json             – `SYMBOL → svg` for the lazily loaded built-in pack
// All icons use the "background" variant (mark on a filled square): the component clips it to a
// circle / rounded square, so every icon is readable on both light and dark themes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SVGS = fileURLToPath(new URL("../../node_modules/@web3icons/core/dist/svgs", import.meta.url));
const OUT = fileURLToPath(new URL("../../src/assets/icons/", import.meta.url));

const load = async (path) => {
	const file = join(SVGS, `${path}.svg.js`);
	if (!existsSync(file)) return undefined;
	return (await import(file)).default;
};

const minify = (svg) =>
	svg
		.replace(/\s*class="web3icons"/, "")
		.replace(/>\s+</g, "><")
		.replace(/\s{2,}/g, " ")
		.trim();

const write = (rel, svg) => {
	const file = join(OUT, rel);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${minify(svg)}\n`);
};

// --- Brand and network marks -------------------------------------------------------------
const HYPERLIQUID = await load("networks/background/hyper-evm"); // mint mark on brand dark green
write("brand/hyperliquid.svg", HYPERLIQUID);
const official = (name) => readFileSync(new URL(`./official/${name}.svg`, import.meta.url), "utf8");
// Safe: the mark from Safe's own app (app.safe.global/images/logo-no-text.svg), black on brand green
// like its app icon. The icon pack redraws the mark and colours it differently.
write("brand/safe.svg", official("safe"));
write("brand/metamask.svg", await load("wallets/background/metamask"));
write("brand/ledger.svg", await load("wallets/background/ledger"));
// Trezor: white lock on black, as Trezor uses it; no recolouring.
write("brand/trezor.svg", await load("wallets/background/trezor"));
// Network logos are the networks' own official assets (scripts/tokens/official): the Ethereum mark on
// its blue disc, the full-colour Arbitrum mark, the Base network logo from Base's brand kit.
for (const name of ["ethereum", "arbitrum", "base", "polygon"]) {
	write(`network/${name}.svg`, official(name));
}
write("network/hyperevm.svg", HYPERLIQUID);

// --- Tokens ------------------------------------------------------------------------------
const OVERRIDES = {
	HYPE: HYPERLIQUID,
	// The pack's ETH is a pastel redraw and its ARB is not the Arbitrum mark at all: both tokens
	// carry the logo of their network. WBTC is the mark from wbtc.network.
	ETH: official("ethereum"),
	ARB: official("arbitrum"),
	POL: official("polygon"),
	WBTC: official("wbtc"),
};
const tokenSvg = async (symbol) => OVERRIDES[symbol] ?? (await load(`tokens/background/${symbol}`));

const CORE = ["ETH", "USDC", "USDT", "HYPE", "BTC", "WBTC", "DAI", "ARB", "POL"];
for (const symbol of CORE) write(`token/${symbol}.svg`, await tokenSvg(symbol));

const builtin = JSON.parse(readFileSync(new URL("../../src/lib/tokens/builtin.json", import.meta.url), "utf8"));
const hlSymbols = JSON.parse(readFileSync(new URL("./hl-symbols.json", import.meta.url), "utf8"));
const EXTRA = [
	"SOL",
	"BNB",
	"XRP",
	"DOGE",
	"SUI",
	"AVAX",
	"TRX",
	"TON",
	"ADA",
	"LTC",
	"DOT",
	"ATOM",
	"NEAR",
	"APT",
	"POL",
];
const KEEP_LARGE = new Set(["DOGE", "PEPE", "APE"]);
const MAX_BYTES = 12_000;

const wanted = new Set(EXTRA);
for (const chainId of ["1", "42161", "8453", "137", "999"]) {
	for (const token of builtin.chains[chainId] ?? []) wanted.add(token[1].toUpperCase());
}
for (const name of hlSymbols)
	wanted.add(
		name
			.split(":")
			.pop()
			.replace(/^k(?=[A-Z0-9])/, "")
			.toUpperCase(),
	);

const pack = {};
let bytes = 0;
for (const symbol of [...wanted].sort()) {
	if (CORE.includes(symbol) || !/^[A-Z0-9]+$/.test(symbol)) continue;
	const svg = await tokenSvg(symbol);
	if (!svg) continue;
	const min = minify(svg);
	if (min.length > MAX_BYTES && !KEEP_LARGE.has(symbol)) continue;
	pack[symbol] = min;
	bytes += min.length;
}
writeFileSync(join(OUT, "token-pack.json"), `${JSON.stringify(pack)}\n`);
console.log(`token pack: ${Object.keys(pack).length} icons, ${(bytes / 1024).toFixed(0)} KB`);
