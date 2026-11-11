// Renders the PNG app icons from public/icons/icon.svg. Usage: pnpm icons:app
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const dir = new URL("../../public/icons/", import.meta.url);
const svg = await readFile(new URL("icon.svg", dir), "utf8");
const BG = "#0f1513";

const render = (source, size, file) =>
	sharp(Buffer.from(source), { density: 72 * (size / 64) * 2 })
		.resize(size, size)
		.png({ compressionLevel: 9 })
		.toFile(new URL(file, dir).pathname);

// Maskable: full-bleed background, the mark scaled into the central safe zone.
const inner = svg
	.replace(/<svg[^>]*>/, "")
	.replace("</svg>", "")
	.replace(/<rect[^>]*\/>/, "");
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${BG}"/><g transform="translate(32 32) scale(.74) translate(-32 -32)">${inner}</g></svg>`;

await render(svg, 192, "icon-192.png");
await render(svg, 512, "icon-512.png");
await render(maskable, 512, "icon-maskable-512.png");
console.log("icons rendered");
