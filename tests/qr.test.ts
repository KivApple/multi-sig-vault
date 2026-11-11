import { describe, expect, it } from "vitest";
import { addressQrValue, parseAddressQr } from "@/lib/qr/address";
import { FrameCollector, splitFrames } from "@/lib/qr/frames";
import { MAX_TRANSFER_BYTES, TRANSFER_PREFIX, isTransferText, packTransfer, unpackTransfer } from "@/lib/qr/transfer";

const ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const LOWER = ADDR.toLowerCase();

describe("parseAddressQr", () => {
	const ok: [string, number | undefined][] = [
		[ADDR, undefined],
		[LOWER, undefined],
		[`0x${ADDR.slice(2).toUpperCase()}`, undefined],
		[`  ${ADDR}\n`, undefined],
		[`ethereum:${ADDR}`, undefined],
		[`ethereum:${ADDR}@1`, 1],
		[`ethereum:${ADDR}@0x1`, 1],
		[`ethereum:${LOWER}@42161`, 42161],
		[`ethereum:${ADDR}@0xa4b1`, 42161],
		[`ETHEREUM:pay-${ADDR}@8453`, 8453],
		[`ethereum:${ADDR}@999/transfer?address=0x0&uint256=1`, 999],
		[`ethereum:${ADDR}?value=1e18`, undefined],
		[`eth:${ADDR}`, 1],
		[`arb1:${ADDR}`, 42161],
		[`base:${LOWER}`, 8453],
		[`unknownchain:${ADDR}`, undefined],
	];
	it.each(ok)("accepts %s", (text, chainId) => {
		expect(parseAddressQr(text)).toEqual(chainId === undefined ? { address: ADDR } : { address: ADDR, chainId });
	});

	const bad = [
		"",
		"hello",
		"0x1234",
		`${ADDR}00`,
		// one letter with flipped case → checksum mismatch
		"0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045".replace("dA6", "da6"),
		`ethereum:${ADDR.replace("dA6", "da6")}@1`,
		"https://example.com/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
		"msv1:abc",
	];
	it.each(bad)("rejects %j", (text) => {
		expect(parseAddressQr(text)).toBeNull();
	});

	it("builds values that parse back", () => {
		expect(addressQrValue(LOWER as `0x${string}`)).toBe(ADDR);
		expect(addressQrValue(ADDR, 8453)).toBe(`ethereum:${ADDR}@8453`);
		expect(parseAddressQr(addressQrValue(ADDR, 998))).toEqual({ address: ADDR, chainId: 998 });
	});
});

describe("transfer", () => {
	it("round-trips data", async () => {
		const data = { v: 1, op: { id: "x", params: { amount: "1.5", note: "привет ✓" }, list: [1, 2, 3] } };
		const text = await packTransfer(data);
		expect(text.startsWith(TRANSFER_PREFIX)).toBe(true);
		expect(isTransferText(text)).toBe(true);
		expect(/^msv1:[A-Za-z0-9_-]+$/.test(text)).toBe(true);
		expect(await unpackTransfer(`  ${text}\n`)).toEqual(data);
	});

	it("compresses repetitive payloads", async () => {
		const text = await packTransfer({ data: "0x" + "00".repeat(5000) });
		expect(text.length).toBeLessThan(500);
	});

	it("returns null for foreign or corrupt input", async () => {
		const text = await packTransfer({ a: 1 });
		expect(isTransferText("ethereum:0x0")).toBe(false);
		expect(await unpackTransfer("hello")).toBeNull();
		expect(await unpackTransfer("msv1:")).toBeNull();
		expect(await unpackTransfer("msv1:!!!")).toBeNull();
		expect(await unpackTransfer("msv1:AAAAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
		expect(await unpackTransfer(text.slice(0, -4))).toBeNull();
		expect(await unpackTransfer(`${text.slice(0, 8)}x${text.slice(9)}zz`)).toBeNull();
	});

	it("refuses oversized payloads in both directions", async () => {
		await expect(packTransfer({ data: "a".repeat(MAX_TRANSFER_BYTES + 1) })).rejects.toThrow();
		// Hand-made bomb: valid deflate stream that inflates beyond the limit.
		const big = new TextEncoder().encode(JSON.stringify("a".repeat(MAX_TRANSFER_BYTES + 10)));
		const cs = new CompressionStream("deflate-raw");
		const w = cs.writable.getWriter();
		void w.write(big);
		void w.close();
		const packed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
		const b64 = Buffer.from(packed).toString("base64url");
		expect(await unpackTransfer(TRANSFER_PREFIX + b64)).toBeNull();
	});
});

describe("frames", () => {
	const text = `msv1:${Array.from({ length: 1000 }, (_, i) => (i * 7919).toString(36)).join("")}`;

	it("keeps short text as a single frame", () => {
		expect(splitFrames("short", 10)).toEqual(["short"]);
		const c = new FrameCollector();
		expect(c.add("short")).toEqual({ complete: true, text: "short", received: 1, total: 1, isFrame: false });
	});

	it("collects frames out of order with duplicates", () => {
		const frames = splitFrames(text, 100);
		expect(frames.length).toBe(Math.ceil(text.length / 100));
		expect(frames.every((f) => f.startsWith("msvf:"))).toBe(true);
		const order = [...frames.keys()].reverse();
		const c = new FrameCollector();
		let last = c.add(frames[order[0]]);
		expect(last).toMatchObject({ complete: false, received: 1, total: frames.length, isFrame: true });
		expect(c.add(frames[order[0]]).received).toBe(1);
		for (const i of order.slice(1)) last = c.add(frames[i]);
		expect(last.complete).toBe(true);
		expect(last.text).toBe(text);
	});

	it("restarts when frames of another payload appear", () => {
		const a = splitFrames(text, 200);
		const other = `${text}-other`;
		const b = splitFrames(other, 200);
		const c = new FrameCollector();
		c.add(a[0]);
		c.add(a[1]);
		expect(c.add(b[0]).received).toBe(1);
		let res = c.add(b[0]);
		for (const f of b) res = c.add(f);
		expect(res.complete).toBe(true);
		expect(res.text).toBe(other);
	});

	it("rejects a forged frame set", () => {
		const frames = splitFrames(text, 500);
		const forged = frames.map((f, i) => (i === 1 ? f.replace(/:[^:]*$/, ":tampered") : f));
		const c = new FrameCollector();
		let res = c.add(forged[0]);
		for (const f of forged.slice(1)) res = c.add(f);
		expect(res.complete).toBe(false);
		expect(c.add("msvf:zz:9/3:x").complete).toBe(false);
	});
});
