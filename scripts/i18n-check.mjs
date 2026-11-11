// Lists translation keys used in the source that no dictionary defines, and en/ru mismatches.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir) =>
	readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
	});

const defined = { en: new Set(), ru: new Set() };
for (const file of walk("src/i18n/dict")) {
	const text = readFileSync(file, "utf8");
	const ruAt = text.search(/\n\s*ru:\s*\{/);
	for (const [lang, part] of [
		["en", text.slice(0, ruAt)],
		["ru", text.slice(ruAt)],
	]) {
		for (const m of part.matchAll(/^\s*["']([\w.:-]+)["']\s*:/gm)) defined[lang].add(m[1]);
	}
}
const used = new Map();
for (const file of walk("src")) {
	if (file.includes("i18n/dict")) continue;
	const text = readFileSync(file, "utf8");
	for (const m of text.matchAll(/(?:\bt|tNow|AppError)\(\s*["'`]([\w.:-]+)["'`]/g)) used.set(m[1], file);
	for (const m of text.matchAll(
		/["'`]((?:ops|hl|safe|import|safeError|walletError|swap|advanced|addAccount|createSafe|accounts|signers|settings|owners|amount|address|common|error|update|tokens|wallets|qr)\.[\w.-]+)["'`]/g,
	)) {
		if (!used.has(m[1])) used.set(m[1], file);
	}
}
const hasKey = (set, key) => set.has(key) || set.has(`${key}_one`) || set.has(`${key}_other`);
const missing = [...used].filter(([k]) => !hasKey(defined.en, k) && !k.endsWith("."));
for (const [k, f] of missing.sort()) console.log(`MISSING ${k}  (${f})`);
for (const k of defined.en) if (!defined.ru.has(k)) console.log(`NO-RU ${k}`);
console.log(`${missing.length} missing, ${defined.en.size} defined`);
