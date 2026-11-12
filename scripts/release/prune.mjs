// Trims the release list to the newest ones and prints the ids that fell off, one per line, so the
// caller can delete their files. The stable release is never dropped, however old it is.
// Usage: node scripts/release/prune.mjs <releases.json (rewritten in place)> <how many to keep> [<stable id>]
import { readFile, writeFile } from "node:fs/promises";
import { parseReleaseList } from "../../src/lib/update/releaseCore.mjs";

const [file, keepArg, stable] = process.argv.slice(2);
const keep = Math.max(1, Number(keepArg) || 0);
const list = parseReleaseList(JSON.parse(await readFile(file, "utf8")));
const kept = list.filter((entry, i) => i < keep || entry.id === stable);
await writeFile(file, `${JSON.stringify({ format: 1, releases: kept }, null, 1)}\n`);
for (const entry of list) if (!kept.includes(entry)) console.log(entry.id);
