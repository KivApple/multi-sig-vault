import { readFileSync } from "node:fs";
import vm from "node:vm";
import { decodeFunctionData, keccak256, parseAbi, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";
import {
	canonicalRelease,
	computeReleaseId,
	isSafePath,
	isValidSignatureCalldata,
	parseManifest,
	releaseDigest,
	sha256Hex,
	signMessageCalldata,
	verifyManifest,
} from "../src/lib/update/releaseCore.mjs";

const h = (c: string): string => c.repeat(64);
const FILES = [
	{ path: "static/js/index.abc.js", sha256: h("b"), size: 10 },
	{ path: "index.html", sha256: h("a"), size: 5 },
	{ path: "sw.js", sha256: h("c"), size: 7 },
];

describe("release manifest", () => {
	it("canonical form is sorted and independent of input order", async () => {
		const text = canonicalRelease("1.2.3", FILES);
		expect(text).toBe(
			`msv-release-v1\n1.2.3\nindex.html\t${h("a")}\nstatic/js/index.abc.js\t${h("b")}\nsw.js\t${h("c")}\n`,
		);
		expect(canonicalRelease("1.2.3", [...FILES].reverse())).toBe(text);
		expect(await computeReleaseId("1.2.3", FILES)).toBe(await sha256Hex(new TextEncoder().encode(text)));
	});

	it("id commits to version and every hash", async () => {
		const id = await computeReleaseId("1.2.3", FILES);
		expect(id).toMatch(/^[0-9a-f]{64}$/);
		expect(await computeReleaseId("1.2.4", FILES)).not.toBe(id);
		expect(await computeReleaseId("1.2.3", [{ ...FILES[0], sha256: h("d") }, FILES[1], FILES[2]])).not.toBe(id);
		expect(await computeReleaseId("1.2.3", FILES.slice(0, 2))).not.toBe(id);
	});

	it("sha256 matches a known vector", async () => {
		expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("accepts a consistent manifest and rejects tampering", async () => {
		const id = await computeReleaseId("1.0.0", FILES);
		const good = { version: "1.0.0", id, builtAt: "x", files: FILES };
		expect((await verifyManifest(good)).id).toBe(id);
		await expect(verifyManifest({ ...good, version: "1.0.1" })).rejects.toThrow(/id does not match/);
		await expect(verifyManifest({ ...good, files: FILES.slice(1) })).rejects.toThrow();
		expect(() => parseManifest({ ...good, files: [...FILES, FILES[0]] })).toThrow(/duplicate/);
		expect(() => parseManifest({ ...good, files: [{ path: "../x", sha256: h("a"), size: 1 }] })).toThrow();
		expect(() => parseManifest({ ...good, id: "zz" })).toThrow();
		expect(() => parseManifest({ ...good, version: "a\nb" })).toThrow();
		expect(() => parseManifest(null)).toThrow();
	});

	it("only relative, traversal-free paths are allowed", () => {
		for (const ok of ["index.html", "static/js/a.b.js", "icons/icon-192.png"]) expect(isSafePath(ok)).toBe(true);
		for (const bad of ["", "/abs", "../up", "a/../b", "a//b", "./a", "https://x/y", "a?b", "a#b", "a\\b", 5]) {
			expect(isSafePath(bad)).toBe(false);
		}
	});
});

describe("release signature", () => {
	const id = h("1");

	it("digest is domain separated keccak256", () => {
		expect(releaseDigest(id)).toBe(keccak256(stringToBytes(`MultiSigVault release v1\n${id}`)));
		expect(() => releaseDigest("nope")).toThrow();
	});

	it("signMessage calldata carries exactly abi.encode(digest)", () => {
		const digest = releaseDigest(id);
		const decoded = decodeFunctionData({
			abi: parseAbi(["function signMessage(bytes _data)"]),
			data: signMessageCalldata(digest),
		});
		expect(decoded.args[0]).toBe(digest);
		expect(signMessageCalldata(digest).slice(0, 10)).toBe("0x85a5affe");
	});

	it("isValidSignature calldata uses the bytes32 variant with an empty signature", () => {
		const digest = releaseDigest(id);
		const data = isValidSignatureCalldata(digest);
		expect(data.slice(0, 10)).toBe("0x1626ba7e");
		const decoded = decodeFunctionData({
			abi: parseAbi(["function isValidSignature(bytes32 h, bytes s) view returns (bytes4)"]),
			data,
		});
		expect(decoded.args).toEqual([digest, "0x"]);
	});
});

describe("service worker", () => {
	it("computes the same release id as the app and stays free of build hashes", async () => {
		const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
		const context = vm.createContext({
			self: {
				registration: { scope: "https://example.org/app/" },
				location: { origin: "https://example.org" },
				addEventListener: () => undefined,
			},
			crypto,
			TextEncoder,
			URL,
		});
		const api = vm.runInContext(`${source}\n;({ canonicalRelease, computeReleaseId, isSafePath })`, context) as {
			canonicalRelease: typeof canonicalRelease;
			computeReleaseId: typeof computeReleaseId;
			isSafePath: typeof isSafePath;
		};
		expect(api.canonicalRelease("1.2.3", FILES)).toBe(canonicalRelease("1.2.3", FILES));
		expect(await api.computeReleaseId("1.2.3", FILES)).toBe(await computeReleaseId("1.2.3", FILES));
		expect(api.isSafePath("../x")).toBe(false);
		expect(api.isSafePath("static/a.js")).toBe(true);
		expect(source).not.toMatch(/[0-9a-f]{16,}/);
	});
});
