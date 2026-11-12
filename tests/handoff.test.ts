import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatToken, newToken, open, parseToken, seal, sessionCode } from "@/lib/handoff/crypto";
import { fromWireTx, parseRequest, parseResult, toWireTx, type HandoffRequest } from "@/lib/handoff/protocol";
// @ts-expect-error – plain JavaScript module without types
import { createRelay } from "../relay/server.mjs";

const A = "0x9999999999999999999999999999999999999999";
const typedData = {
	domain: { name: "HyperliquidSignTransaction", version: "1", chainId: 42161, verifyingContract: A },
	types: { "HyperliquidTransaction:UsdSend": [{ name: "destination", type: "string" }] },
	primaryType: "HyperliquidTransaction:UsdSend",
	message: { destination: A },
};
const request: HandoffRequest = { v: 1, method: "signTypedData", address: A, data: typedData as never };

describe("hand-off encryption", () => {
	it("round-trips a message and a token", async () => {
		const token = newToken();
		expect(await open(token, "req", await seal(token, "req", request))).toEqual(request);
		const parsed = parseToken(formatToken(token));
		expect(parsed?.id).toBe(token.id);
		expect(await open(parsed as never, "req", await seal(token, "req", request))).toEqual(request);
		expect(parseToken("nope")).toBeUndefined();
		expect(parseToken(`${token.id}.short`)).toBeUndefined();
	});

	it("rejects a changed message, another key, another slot and another session", async () => {
		const token = newToken();
		const sealed = await seal(token, "req", request);
		const flipped = sealed.slice();
		flipped[flipped.length - 1] ^= 1;
		await expect(open(token, "req", flipped)).rejects.toThrow();
		await expect(open({ id: token.id, key: newToken().key }, "req", sealed)).rejects.toThrow();
		// The relay cannot hand the request back as if it were the answer…
		await expect(open(token, "res", sealed)).rejects.toThrow();
		// …nor move a message into another session.
		await expect(open({ id: newToken().id, key: token.key }, "req", sealed)).rejects.toThrow();
	});

	it("derives the same six-digit code on both sides, different for another key", async () => {
		const token = newToken();
		const code = await sessionCode(token);
		expect(code).toMatch(/^\d{6}$/);
		expect(await sessionCode(parseToken(formatToken(token)) as never)).toBe(code);
		const others = await Promise.all(Array.from({ length: 5 }, () => sessionCode(newToken())));
		expect(others.every((c) => c === code)).toBe(false);
	});
});

describe("hand-off protocol", () => {
	it("accepts well-formed requests and normalizes addresses", () => {
		expect(parseRequest({ v: 1, method: "accounts" })).toEqual({ v: 1, method: "accounts" });
		expect(parseRequest(request)).toEqual(request);
		const tx = toWireTx({ chainId: 8453, to: A, data: "0x1234", value: 5n, gas: 21000n });
		const parsed = parseRequest({ v: 1, method: "sendTransaction", address: A.toLowerCase(), tx });
		expect(parsed).toEqual({ v: 1, method: "sendTransaction", address: A, tx });
		expect(fromWireTx(tx)).toEqual({ chainId: 8453, to: A, data: "0x1234", value: 5n, gas: 21000n });
	});

	it("rejects malformed requests", () => {
		expect(parseRequest(null)).toBeUndefined();
		expect(parseRequest({ v: 2, method: "accounts" })).toBeUndefined();
		expect(parseRequest({ v: 1, method: "personal_sign", address: A })).toBeUndefined();
		expect(parseRequest({ ...request, address: "0x12" })).toBeUndefined();
		expect(parseRequest({ ...request, data: { ...typedData, types: { X: "bad" } } })).toBeUndefined();
		const tx = { chainId: 8453, to: A, data: "0x", value: "1" };
		expect(parseRequest({ v: 1, method: "sendTransaction", address: A, tx: { ...tx, value: "-1" } })).toBeUndefined();
		expect(parseRequest({ v: 1, method: "sendTransaction", address: A, tx: { ...tx, chainId: 0 } })).toBeUndefined();
		expect(parseRequest({ v: 1, method: "sendTransaction", address: A, tx: { ...tx, data: "zz" } })).toBeUndefined();
	});

	it("checks the shape of results", () => {
		expect(parseResult(request, `0x${"ab".repeat(65)}`)).toBe(`0x${"ab".repeat(65)}`);
		expect(parseResult(request, `0x${"ab".repeat(64)}`)).toBeUndefined();
		expect(parseResult({ v: 1, method: "accounts" }, [A.toLowerCase()])).toEqual([A]);
		expect(parseResult({ v: 1, method: "accounts" }, ["0x1"])).toBeUndefined();
	});
});

describe("relay", () => {
	const server = createRelay();
	let base = "";
	beforeAll(async () => {
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/relay`;
	});
	afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

	const id = (): string => newToken().id;
	const put = (path: string, body: string): Promise<Response> => fetch(`${base}/v1/${path}`, { method: "PUT", body });

	it("stores a request and an answer once each", async () => {
		const s = id();
		expect((await fetch(`${base}/health`)).status).toBe(200);
		expect((await fetch(`${base}/v1/${s}/req`)).status).toBe(404);
		expect((await put(`${s}/req`, "one")).status).toBe(201);
		expect((await put(`${s}/req`, "two")).status).toBe(409);
		expect(await (await fetch(`${base}/v1/${s}/req`)).text()).toBe("one");
		expect((await put(`${s}/res`, "answer")).status).toBe(201);
		expect((await put(`${s}/res`, "other")).status).toBe(409);
		expect(await (await fetch(`${base}/v1/${s}/res`)).text()).toBe("answer");
	});

	it("refuses an answer without a request, bad ids, empty and oversized bodies", async () => {
		expect((await put(`${id()}/res`, "x")).status).toBe(404);
		expect((await put("short/req", "x")).status).toBe(404);
		expect((await put(`${id()}/other`, "x")).status).toBe(404);
		expect((await put(`${id()}/req`, "")).status).toBe(400);
		const big = await put(`${id()}/req`, "x".repeat(40_000)).then(
			(r) => r.status,
			() => 413,
		);
		expect(big).toBe(413);
	});

	it("answers a waiting reader as soon as the answer arrives", async () => {
		const s = id();
		await put(`${s}/req`, "q");
		const started = Date.now();
		const waiting = fetch(`${base}/v1/${s}/res?wait=5`);
		setTimeout(() => void put(`${s}/res`, "late"), 150);
		const res = await waiting;
		expect(await res.text()).toBe("late");
		expect(Date.now() - started).toBeLessThan(2000);
	});
});
