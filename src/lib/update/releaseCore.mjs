// Pure release-manifest logic shared by the app, the build plugin and `pnpm release:info`.
// Plain ESM (typed by releaseCore.d.mts) so Node can run it without a TypeScript loader.
// `public/sw.js` re-implements `canonicalRelease` / `computeReleaseId` (a service worker cannot
// import this file without getting a build hash); tests/update.test.ts keeps both in sync.
import { encodeFunctionData, keccak256, stringToBytes } from "viem";

export const RELEASE_FORMAT = "msv-release-v1";
/** Domain separation prefix of the digest the developer Safe signs. */
export const RELEASE_DIGEST_PREFIX = "MultiSigVault release v1\n";
export const EIP1271_MAGIC = "0x1626ba7e";

/** Safe `SignMessageLib` deployments (same address on every supported chain). */
export const SIGN_MESSAGE_LIB = {
	"1.4.1": "0xd53cd0aB83D845Ac265BE939c57F53AD838012c9",
	"1.3.0": "0xA65387F16B013cf2Af4605Ad8aA5ec25a2cbA3a2",
	"1.3.0-eip155": "0x98FFBBF51bb33A056B08ddf711f289936AafF717",
};

const SHA256_RE = /^[0-9a-f]{64}$/;

const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (data) => toHex(await crypto.subtle.digest("SHA-256", data));

/** Relative, normalised, no traversal, no query – the only paths a release may contain. */
export const isSafePath = (path) =>
	typeof path === "string" &&
	path.length > 0 &&
	path.length < 512 &&
	!/[\\?#\n\t\r]/.test(path) &&
	!path.startsWith("/") &&
	!path.includes(":") &&
	path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");

export const sortFiles = (files) => [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

/** Canonical text the release id is derived from: version + sorted `path<TAB>sha256` lines. */
export const canonicalRelease = (version, files) =>
	`${RELEASE_FORMAT}\n${version}\n${sortFiles(files)
		.map((f) => `${f.path}\t${f.sha256}\n`)
		.join("")}`;

export const computeReleaseId = (version, files) =>
	sha256Hex(new TextEncoder().encode(canonicalRelease(version, files)));

/** Structural validation of an untrusted `release.json`; throws on anything unexpected. */
export const parseManifest = (raw) => {
	if (!raw || typeof raw !== "object") throw new Error("Release manifest is not an object");
	const { version, id, files, builtAt } = raw;
	if (typeof version !== "string" || !version || version.length > 64 || /[\n\t\r]/.test(version)) {
		throw new Error("Release manifest: bad version");
	}
	if (typeof id !== "string" || !SHA256_RE.test(id)) throw new Error("Release manifest: bad id");
	if (!Array.isArray(files) || files.length === 0 || files.length > 5000) {
		throw new Error("Release manifest: bad file list");
	}
	const seen = new Set();
	const out = files.map((f) => {
		if (!f || !isSafePath(f.path) || typeof f.sha256 !== "string" || !SHA256_RE.test(f.sha256)) {
			throw new Error("Release manifest: bad file entry");
		}
		if (!Number.isSafeInteger(f.size) || f.size < 0) throw new Error("Release manifest: bad file size");
		if (seen.has(f.path)) throw new Error("Release manifest: duplicate path");
		seen.add(f.path);
		return { path: f.path, sha256: f.sha256, size: f.size };
	});
	if (!seen.has("index.html")) throw new Error("Release manifest: index.html missing");
	return { version, id, files: out, ...(typeof builtAt === "string" ? { builtAt } : {}) };
};

/** `parseManifest` + proof that `id` really commits to the version and file hashes. */
export const verifyManifest = async (raw) => {
	const manifest = parseManifest(raw);
	if ((await computeReleaseId(manifest.version, manifest.files)) !== manifest.id) {
		throw new Error("Release manifest: id does not match its content");
	}
	return manifest;
};

/** bytes32 the developer Safe approves: keccak256(utf8("MultiSigVault release v1\n" + id)). */
export const releaseDigest = (id) => {
	if (!SHA256_RE.test(id)) throw new Error("Bad release id");
	return keccak256(stringToBytes(`${RELEASE_DIGEST_PREFIX}${id}`));
};

const SIGN_MESSAGE_ABI = [
	{
		type: "function",
		name: "signMessage",
		stateMutability: "nonpayable",
		inputs: [{ name: "_data", type: "bytes" }],
		outputs: [],
	},
];
const IS_VALID_SIGNATURE_ABI = [
	{
		type: "function",
		name: "isValidSignature",
		stateMutability: "view",
		inputs: [
			{ name: "_dataHash", type: "bytes32" },
			{ name: "_signature", type: "bytes" },
		],
		outputs: [{ type: "bytes4" }],
	},
];

/**
 * Calldata of `SignMessageLib.signMessage(abi.encode(digest))` – the Safe must DELEGATECALL it.
 * It sets `signedMessages[getMessageHash(abi.encode(digest))] = 1`, which is exactly what
 * `CompatibilityFallbackHandler.isValidSignature(bytes32 digest, bytes "")` later looks up.
 */
export const signMessageCalldata = (digest) =>
	encodeFunctionData({ abi: SIGN_MESSAGE_ABI, functionName: "signMessage", args: [digest] });

/** Calldata of EIP-1271 `isValidSignature(digest, "")` sent to the Safe itself. */
export const isValidSignatureCalldata = (digest) =>
	encodeFunctionData({ abi: IS_VALID_SIGNATURE_ABI, functionName: "isValidSignature", args: [digest, "0x"] });

/**
 * Compares dotted numeric versions ("1.2.10" > "1.2.9"). Anything else compares as equal,
 * so a release with an unreadable version is never taken for a newer one.
 */
export const compareVersions = (a, b) => {
	const parse = (v) =>
		typeof v === "string" && /^\d{1,9}(\.\d{1,9}){0,5}$/.test(v) ? v.split(".").map(Number) : undefined;
	const x = parse(a);
	const y = parse(b);
	if (!x || !y) return 0;
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0);
		if (d !== 0) return d < 0 ? -1 : 1;
	}
	return 0;
};

export const RELEASE_LIST_LIMIT = 200;

/**
 * `releases.json`: every published release, newest first. It is only a hint where to look – what a
 * release contains is proven by its own manifest, and whether it is approved by the developer Safe.
 * Malformed entries are dropped; throws when the document itself is not a list.
 */
export const parseReleaseList = (raw) => {
	if (!raw || typeof raw !== "object" || !Array.isArray(raw.releases)) throw new Error("Release list: malformed");
	const seen = new Set();
	const out = [];
	for (const entry of raw.releases.slice(0, RELEASE_LIST_LIMIT)) {
		if (!entry || typeof entry.id !== "string" || !SHA256_RE.test(entry.id) || seen.has(entry.id)) continue;
		if (typeof entry.version !== "string" || !entry.version || entry.version.length > 64) continue;
		seen.add(entry.id);
		out.push({ id: entry.id, version: entry.version, ...(typeof entry.time === "string" ? { time: entry.time } : {}) });
	}
	return out;
};

/** The list with `manifest` put first (publishing the same release twice keeps one entry). */
export const addToReleaseList = (raw, manifest, time) => {
	const old = raw === undefined ? [] : parseReleaseList(raw);
	const entry = { id: manifest.id, version: manifest.version, time };
	return { format: 1, releases: [entry, ...old.filter((e) => e.id !== manifest.id)].slice(0, RELEASE_LIST_LIMIT) };
};
