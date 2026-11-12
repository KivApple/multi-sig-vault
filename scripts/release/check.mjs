// Proves that a directory holds exactly the release its release.json describes: every file is there
// with the listed SHA-256, and the id commits to them. Usage: node scripts/release/check.mjs <dir>
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex, verifyManifest } from "../../src/lib/update/releaseCore.mjs";

const dir = process.argv[2];
const manifest = await verifyManifest(JSON.parse(await readFile(join(dir, "release.json"), "utf8")));
for (const file of manifest.files) {
	if ((await sha256Hex(await readFile(join(dir, file.path)))) !== file.sha256) {
		throw new Error(`${file.path} does not match the manifest`);
	}
}
console.log(manifest.id);
