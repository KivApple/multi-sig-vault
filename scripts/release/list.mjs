// Prints `releases.json` with the built release put first.
// Usage: node scripts/release/list.mjs <current releases.json, may be missing> <dist/release.json>
import { readFile } from "node:fs/promises";
import { addToReleaseList, verifyManifest } from "../../src/lib/update/releaseCore.mjs";

const [oldFile, manifestFile] = process.argv.slice(2);
const old = await readFile(oldFile, "utf8").then(JSON.parse, (e) => {
	if (e.code === "ENOENT") return undefined;
	throw e;
});
const manifest = await verifyManifest(JSON.parse(await readFile(manifestFile, "utf8")));
console.log(JSON.stringify(addToReleaseList(old, manifest, new Date().toISOString()), null, 1));
