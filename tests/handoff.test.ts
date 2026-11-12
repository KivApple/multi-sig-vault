import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	formatLinkToken,
	newCode,
	newKey,
	newSessionId,
	open,
	pairingKey,
	parseKey,
	parseLinkToken,
	seal,
	sessionKey,
	toBase64Url,
} from "@/lib/handoff/crypto";
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
	it("round-trips a session message between paired instances", async () => {
		const pairKey = newKey();
		const id = newSessionId();
		const sealed = await seal(await sessionKey(pairKey, id), id, "req", { request });
		expect(await open(await sessionKey(pairKey, id), id, "req", sealed)).toEqual({ request });
	});

	it("a request made without the pair key cannot be opened – a planted link shows nothing", async () => {
		const mine = newKey();
		const id = newSessionId();
		const planted = await seal(await sessionKey(newKey(), id), id, "req", { request });
		await expect(open(await sessionKey(mine, id), id, "req", planted)).rejects.toThrow();
	});

	it("rejects a changed message, another direction and another session", async () => {
		const pairKey = newKey();
		const id = newSessionId();
		const key = await sessionKey(pairKey, id);
		const sealed = await seal(key, id, "req", { request });
		const flipped = sealed.slice();
		flipped[flipped.length - 1] ^= 1;
		await expect(open(key, id, "req", flipped)).rejects.toThrow();
		// The relay cannot hand the request back as if it were the answer…
		await expect(open(key, id, "res", sealed)).rejects.toThrow();
		// …nor replay it in another session of the same pair.
		const other = newSessionId();
		await expect(open(await sessionKey(pairKey, other), other, "req", sealed)).rejects.toThrow();
	});

	it("pairing needs both the link key and the typed code", async () => {
		const id = newSessionId();
		const linkKey = newKey();
		const code = newCode();
		expect(code).toMatch(/^\d{6}$/);
		const sealed = await seal(await pairingKey(linkKey, code, id), id, "req", { pairKey: "k", request });
		expect(await open(await pairingKey(linkKey, code, id), id, "req", sealed)).toEqual({ pairKey: "k", request });
		const wrongCode = code === "000000" ? "000001" : "000000";
		await expect(open(await pairingKey(linkKey, wrongCode, id), id, "req", sealed)).rejects.toThrow();
		// The relay knows neither: guessing the code is useless without the link key.
		await expect(open(await pairingKey(newKey(), code, id), id, "req", sealed)).rejects.toThrow();
	});

	it("link tokens carry a key only while pairing", () => {
		const id = newSessionId();
		const linkKey = newKey();
		expect(parseLinkToken(formatLinkToken({ id }))).toEqual({ id });
		expect(parseLinkToken(formatLinkToken({ id, linkKey }))).toEqual({ id, linkKey });
		expect(parseLinkToken("nope")).toBeUndefined();
		expect(parseLinkToken(`${id}.short`)).toBeUndefined();
		expect(parseKey(toBase64Url(linkKey))).toEqual(linkKey);
		expect(parseKey("AAAA")).toBeUndefined();
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

	const id = (): string => newSessionId();
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
