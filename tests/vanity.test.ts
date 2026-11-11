import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { decodeSetup, defaultCreation, encodeCreateProxy, predictSafeAddress } from "@/lib/safe/deploy";
import { SAFE_141 } from "@/lib/safe/deployments";
import { deadbeefCommand, normalizePrefix, parseMinerOutput } from "@/lib/safe/vanity";

const OWNERS: Address[] = [
	"0x1111111111111111111111111111111111111111",
	"0x2222222222222222222222222222222222222222",
];
const SALT = 0xdc50d6fbe25fc5fe0cffb1a2fc5170b76ac620f74f22c7b247d8c73d83072302n;
const creation = defaultCreation(OWNERS, 1, SALT);
const address = predictSafeAddress(creation);

/** Same layout as the miner prints (labels padded to 13 columns). */
const output = (over: { address?: string; factory?: string } = {}): string =>
	[
		`address:     ${over.address ?? address}`,
		`factory:     ${over.factory ?? creation.factory}`,
		`singleton:   ${creation.singleton}`,
		`initializer: ${creation.initializer}`,
		`salt nonce:  0x${SALT.toString(16)}`,
		"---",
		`owners:      ${OWNERS[0]}`,
		`             ${OWNERS[1]}`,
		"threshold:   1",
		`to:          ${SAFE_141.safeToL2Setup}`,
		"data:        0xfe51f64300000000000000000000000029fcb43b46531bca003ddc8fcb67ffe91900c762",
		`fallback:    ${SAFE_141.fallbackHandler}`,
		"---",
		`calldata:    ${encodeCreateProxy(creation)}`,
	].join("\n");

const errorKey = (fn: () => unknown): string => {
	try {
		fn();
	} catch (e) {
		return (e as { key?: string }).key ?? String(e);
	}
	return "ok";
};

describe("miner output", () => {
	it("parses the full output", () => {
		const r = parseMinerOutput(output());
		expect(r.creation).toEqual(creation);
		expect(r.address).toBe(address);
		expect(r.checked.setup.owners).toEqual(OWNERS);
		expect(r.checked.setup.threshold).toBe(1);
	});

	it("parses --quiet output (calldata only) and CRLF line ends", () => {
		expect(parseMinerOutput(`\n  ${encodeCreateProxy(creation)}\n`).address).toBe(address);
		expect(parseMinerOutput(output().replace(/\n/g, "\r\n")).address).toBe(address);
	});

	it("parses --params output (labelled lines, factory as explorer URL)", () => {
		const params = output({ factory: `https://etherscan.io/address/${creation.factory}#writeContract` })
			.split("\n")
			.slice(0, 5)
			.join("\n");
		expect(parseMinerOutput(params).creation).toEqual(creation);
	});

	it("rejects an address that does not match the parameters", () => {
		expect(errorKey(() => parseMinerOutput(output({ address: OWNERS[0] })))).toBe("createSafe.error.minerMismatch");
	});

	it("rejects garbage and unsafe parameters", () => {
		expect(errorKey(() => parseMinerOutput("hello"))).toBe("createSafe.error.minerOutput");
		expect(errorKey(() => parseMinerOutput(output({ factory: OWNERS[0] })))).toBe("createSafe.error.unknownFactory");
	});
});

describe("miner command", () => {
	it("uses built-in chain settings when the miner has them", () => {
		expect(deadbeefCommand({ owners: OWNERS, threshold: 2, prefix: "0x5afe", chainId: 8453 })).toBe(
			`deadbeef --owner ${OWNERS[0]} --owner ${OWNERS[1]} --threshold 2 --prefix 0x5afe --chain 8453`,
		);
	});

	it("passes every contract explicitly on other chains, matching the app's default setup", () => {
		const cmd = deadbeefCommand({ owners: OWNERS, threshold: 1, prefix: "0x00", chainId: 999 });
		expect(cmd).not.toContain("--chain");
		const setup = decodeSetup(creation.initializer);
		expect(cmd).toContain(`--proxy-factory ${creation.factory}`);
		expect(cmd).toContain(`--singleton ${creation.singleton}`);
		expect(cmd).toContain(`--l2-singleton ${SAFE_141.singletonL2}`);
		expect(cmd).toContain(`--safe-to-l2-setup ${setup.to}`);
		expect(cmd).toContain(`--fallback-handler ${setup.fallbackHandler}`);
		expect(cmd).toMatch(/--proxy-init-code 0x[0-9a-f]{972}( |$)/);
	});

	it("normalizes prefixes", () => {
		expect(normalizePrefix("5AFE")).toBe("0x5afe");
		expect(normalizePrefix("0xdeadbeef")).toBe("0xdeadbeef");
		expect(normalizePrefix("0xabc")).toBeUndefined();
		expect(normalizePrefix("")).toBeUndefined();
		expect(normalizePrefix("xyz1")).toBeUndefined();
	});
});
