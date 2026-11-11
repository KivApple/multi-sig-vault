// Copies official marks from @web3icons/core into src/assets/icons (run: npm run tokens:icons).
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

/** Replaces the square background colour (first path) and optionally other colours. */
const recolor = (svg, colors) => {
	let out = svg;
	for (const [from, to] of Object.entries(colors)) out = out.replaceAll(`fill="${from}"`, `fill="${to}"`);
	return out;
};

const write = (rel, svg) => {
	const file = join(OUT, rel);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${minify(svg)}\n`);
};

// --- Brand and network marks -------------------------------------------------------------
const HYPERLIQUID = await load("networks/background/hyper-evm"); // mint mark on brand dark green
write("brand/hyperliquid.svg", HYPERLIQUID);
// Safe: official black + #12FF80.
write("brand/safe.svg", recolor(await load("wallets/background/safe"), { "#049F67": "#121312", "#fff": "#12FF80" }));
write("brand/metamask.svg", await load("wallets/background/metamask"));
write("brand/ledger.svg", await load("wallets/background/ledger"));
write("brand/trezor.svg", recolor(await load("wallets/background/trezor"), { "#000": "#0F6148" }));
write("network/ethereum.svg", recolor(await load("networks/background/ethereum"), { "#000": "#EDF0FA" }));
write("network/arbitrum.svg", await load("networks/background/arbitrum-one"));
// Base: the official blue square, kept on white so it survives the circular crop.
write(
	"network/base.svg",
	recolor(recolor(await load("networks/background/base"), { "#fff": "#0000FF" }), { "#00F": "#fff" }),
);
write("network/hyperevm.svg", HYPERLIQUID);

// --- Tokens ------------------------------------------------------------------------------
const OVERRIDES = {
	HYPE: HYPERLIQUID,
	ETH: recolor(await load("tokens/background/ETH"), { "#000": "#EDF0FA" }),
};
const tokenSvg = async (symbol) => OVERRIDES[symbol] ?? (await load(`tokens/background/${symbol}`));

const CORE = ["ETH", "USDC", "USDT", "HYPE", "BTC", "WBTC", "DAI", "ARB"];
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
for (const chainId of ["1", "42161", "8453", "999"]) {
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
