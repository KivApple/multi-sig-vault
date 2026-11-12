// Downloads the exchange's own icons for Hyperliquid coins the icon pack has nothing for:
// builder-dex assets (`xyz:TSLA`, `io:…` – stocks, indices, commodities), perps and spot tokens.
// Result: scripts/tokens/hl-icons.json, `SYMBOL → svg`, merged into the built-in pack by
// extract-icons.mjs. These are the icons the app starts with; coins listed later come through the
// relay (src/lib/tokens/hlIcons.ts) unless icon updates are turned off.
// Usage: pnpm tokens:hl-icons   (needs network)
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanSvg } from "../../relay/server.mjs";

const API = "https://api.hyperliquid.xyz/info";
const ICONS = "https://app.hyperliquid.xyz/coins/";
const PACK = fileURLToPath(new URL("../../node_modules/@web3icons/core/dist/svgs/tokens/background/", import.meta.url));
const MAX_BYTES = 12_000;
const CONCURRENCY = 6;

const info = async (body) => {
	const res = await fetch(API, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`${body.type}: HTTP ${res.status}`);
	return res.json();
};

/** Same key the app looks an icon up by (src/lib/tokens/symbols.ts): no dex prefix, no `k` multiplier. */
const keyOf = (coin) =>
	coin
		.slice(coin.lastIndexOf(":") + 1)
		.replace(/^k(?=[A-Z0-9])/, "")
		.toUpperCase();

const dexs = (await info({ type: "perpDexs" })).map((d) => d?.name ?? "");
const coins = [];
for (const dex of dexs) {
	const meta = await info({ type: "meta", ...(dex ? { dex } : {}) });
	for (const asset of meta.universe) if (!asset.isDelisted) coins.push(asset.name);
}
const spot = await info({ type: "spotMeta" });
for (const token of spot.tokens) coins.push(token.name);

// One request per missing symbol; the first coin that carries a symbol decides its icon.
const wanted = new Map();
for (const coin of coins) {
	const key = keyOf(coin);
	if (!/^[A-Z0-9]{1,16}$/.test(key) || wanted.has(key) || existsSync(`${PACK}${key}.svg.js`)) continue;
	wanted.set(key, coin);
}

const out = {};
const queue = [...wanted];
let skipped = 0;
const worker = async () => {
	for (let job = queue.shift(); job; job = queue.shift()) {
		const [key, coin] = job;
		try {
			const res = await fetch(`${ICONS}${encodeURIComponent(coin)}.svg`, { signal: AbortSignal.timeout(15_000) });
			// A coin without an icon gets the site's HTML page.
			if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/svg")) continue;
			const svg = cleanSvg(await res.text())
				?.replace(/>\s+</g, "><")
				.replace(/\s{2,}/g, " ");
			if (!svg || svg.length > MAX_BYTES) {
				skipped++;
				continue;
			}
			out[key] = svg;
		} catch {
			// Missing for this build; the app shows a letter avatar.
		}
	}
};
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(new URL("./hl-icons.json", import.meta.url), `${JSON.stringify(sorted)}\n`);
const bytes = Object.values(sorted).reduce((n, s) => n + s.length, 0);
console.log(
	`asked for ${wanted.size}, got ${Object.keys(sorted).length} icons (${(bytes / 1024).toFixed(0)} KB), ${skipped} too large or unsafe`,
);
