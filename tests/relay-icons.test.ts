import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error – plain JavaScript module without types
import { cleanSvg, createIconCache, createRelay } from "../relay/server.mjs";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

const reply = (body: string, type: string, status = 200): Response =>
	new Response(body, { status, headers: { "content-type": type } });

describe("relay icon cache", () => {
	let dir: string;
	let calls: string[];
	let upstream: (url: string) => Response | Promise<Response>;
	const cache = (ttlMs = 60_000) =>
		createIconCache({
			dir,
			ttlMs,
			upstream: "https://exchange.test/coins/",
			fetchImpl: ((url: string) => {
				calls.push(url);
				return Promise.resolve(upstream(url));
			}) as unknown as typeof fetch,
		});

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "msv-icons-"));
		calls = [];
		upstream = () => reply(SVG, "image/svg+xml");
	});
	afterEach(() => rm(dir, { recursive: true, force: true }));

	it("asks the exchange once and then answers from disk", async () => {
		const icons = cache();
		expect(await icons.load("xyz:TSLA")).toBe(SVG);
		expect(await icons.load("xyz:TSLA")).toBe(SVG);
		expect(calls).toEqual(["https://exchange.test/coins/xyz%3ATSLA.svg"]);
		// A new process finds the file too.
		expect(await cache().load("xyz:TSLA")).toBe(SVG);
		expect(calls).toHaveLength(1);
		expect(await readdir(dir)).toEqual(["xyz~TSLA.svg"]);
	});

	it("fetches again when the cached file is older than the configured term", async () => {
		const icons = cache(1000);
		await icons.load("BTC");
		const old = new Date(Date.now() - 5000);
		await utimes(join(dir, "BTC.svg"), old, old);
		await icons.load("BTC");
		expect(calls).toHaveLength(2);
	});

	it("keeps an expired copy when the exchange cannot be reached", async () => {
		const icons = cache(1000);
		await icons.load("BTC");
		const old = new Date(Date.now() - 5000);
		await utimes(join(dir, "BTC.svg"), old, old);
		upstream = () => {
			throw new Error("down");
		};
		expect(await icons.load("BTC")).toBe(SVG);
		await expect(icons.load("NEW")).rejects.toThrow();
	});

	it("remembers a missing icon in memory and writes nothing for it", async () => {
		// The exchange answers a missing icon with its HTML page.
		upstream = () => reply("<!DOCTYPE html><html></html>", "text/html");
		const icons = cache();
		expect(await icons.load("NOPE")).toBeNull();
		expect(await icons.load("NOPE")).toBeNull();
		expect(calls).toHaveLength(1);
		expect(await readdir(dir)).toEqual([]);
	});

	it("refuses anything that is more than a drawing", async () => {
		expect(cleanSvg(SVG)).toBe(SVG);
		expect(cleanSvg(`<svg><script>alert(1)</script></svg>`)).toBeUndefined();
		expect(cleanSvg(`<svg onload="x()"></svg>`)).toBeUndefined();
		expect(cleanSvg(`<svg><image href="https://evil.test/a.png"/></svg>`)).toBeUndefined();
		expect(cleanSvg(`<svg><foreignObject></foreignObject></svg>`)).toBeUndefined();
		expect(cleanSvg(`<html></html>`)).toBeUndefined();
		expect(cleanSvg(`<svg><image href="data:image/png;base64,AAAA"/><use href="#a"/></svg>`)).toBeDefined();
		upstream = () => reply(`<svg><script>alert(1)</script></svg>`, "image/svg+xml");
		expect(await cache().load("BAD")).toBeNull();
	});

	it("serves icons over HTTP as inert pictures, and nothing else under that path", async () => {
		const server = createRelay({ icons: cache() }).listen(0, "127.0.0.1");
		await new Promise((resolve) => server.once("listening", resolve));
		const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		try {
			const ok = await fetch(`${base}/relay/coins/xyz%3ATSLA.svg`);
			expect(ok.status).toBe(200);
			expect(ok.headers.get("content-type")).toBe("image/svg+xml");
			expect(ok.headers.get("content-security-policy")).toContain("sandbox");
			expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
			expect(await ok.text()).toBe(SVG);
			// No path tricks: a name is letters, digits, ":", "_" and "-".
			expect((await fetch(`${base}/relay/coins/..%2F..%2Fetc%2Fpasswd.svg`)).status).toBe(404);
			expect((await fetch(`${base}/relay/coins/a.b.svg`)).status).toBe(404);
			expect((await fetch(`${base}/relay/coins/BTC.svg`, { method: "PUT", body: "x" })).status).toBe(405);
			expect(await readdir(dir)).toEqual(["xyz~TSLA.svg"]);
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});

	it("has no icons without a cache directory", async () => {
		const server = createRelay().listen(0, "127.0.0.1");
		await new Promise((resolve) => server.once("listening", resolve));
		try {
			const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/relay/coins/BTC.svg`);
			expect(res.status).toBe(404);
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});
});
