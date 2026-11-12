// Prints the id of the release the site root should serve, or nothing to leave the root as it is.
//
// The root is what a first-time visitor gets, so it follows the stable channel: the newest release
// the developer Safe approved. Until anything is approved it follows the newest release.
//
// Usage: node scripts/release/stable.mjs <releases.json> [<release.json now at the root>]
// Env:   PUBLIC_RELEASE_SAFE, RELEASE_RPC_URLS (comma-separated, two independent endpoints)
import { readFile } from "node:fs/promises";
import {
	EIP1271_MAGIC,
	isValidSignatureCalldata,
	parseReleaseList,
	releaseDigest,
} from "../../src/lib/update/releaseCore.mjs";

const [listFile, rootFile] = process.argv.slice(2);
const list = parseReleaseList(JSON.parse(await readFile(listFile, "utf8")));
const safe = process.env.PUBLIC_RELEASE_SAFE?.trim();
const urls = (process.env.RELEASE_RPC_URLS ?? "")
	.split(",")
	.map((u) => u.trim())
	.filter(Boolean);
const log = (text) => console.error(`stable: ${text}`);

if (list.length === 0) throw new Error("The release list is empty");
if (!safe) {
	log("no developer Safe configured, the root follows the newest release");
	console.log(list[0].id);
	process.exit(0);
}
if (urls.length === 0) throw new Error("RELEASE_RPC_URLS is not set");

/** true – approved, false – not approved, undefined – this endpoint could not tell. */
const ask = async (url, id) => {
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "eth_call",
				params: [{ to: safe, data: isValidSignatureCalldata(releaseDigest(id)) }, "latest"],
			}),
			signal: AbortSignal.timeout(15_000),
		});
		const body = await res.json();
		if (typeof body.result === "string") return body.result.toLowerCase().startsWith(EIP1271_MAGIC);
		return /revert|hash not approved/i.test(JSON.stringify(body.error ?? "")) ? false : undefined;
	} catch {
		return undefined;
	}
};

/** Same rule as the app (src/lib/update/verify.ts): every configured endpoint has to agree. */
const approved = async (id) => {
	const answers = await Promise.all(urls.map((url) => ask(url, id)));
	if (answers.some((a) => a === undefined)) return undefined;
	return answers.every(Boolean);
};

for (const entry of list.slice(0, 50)) {
	const ok = await approved(entry.id);
	if (ok === undefined) {
		log("the chain could not be asked, the root stays as it is");
		process.exit(0);
	}
	if (ok) {
		log(`newest approved release is ${entry.version} ${entry.id}`);
		console.log(entry.id);
		process.exit(0);
	}
}

const root = rootFile ? await readFile(rootFile, "utf8").then(JSON.parse, () => undefined) : undefined;
if (typeof root?.id === "string" && /^[0-9a-f]{64}$/.test(root.id) && (await approved(root.id)) !== false) {
	log("nothing in the list is approved, but the release at the root is (or may be): it stays");
	process.exit(0);
}
log("nothing is approved yet, the root follows the newest release");
console.log(list[0].id);
