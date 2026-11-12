import { describe, expect, it } from "vitest";
import { guardEntryHash, parseDeepLink } from "@/lib/deepLink";

const parse = (query: string) => parseDeepLink(new URLSearchParams(query));
const A = "0x9999999999999999999999999999999999999999";
const B = "0x5300A1a15135EA4dc7aD5a167152C01EFc9b192A";

describe("deep links", () => {
	it("opens the add-account form for Hyperliquid and Safe", () => {
		expect(parse(`action=add&kind=hl&env=testnet&address=${A}&name=Desk`)?.to).toBe(
			`/accounts/new?kind=hl&env=testnet&address=${A}&name=Desk&from=link`,
		);
		expect(parse(`action=add&kind=safe&chain=base&address=${B}`)?.to).toBe(
			`/accounts/new?kind=safe&chain=base&address=${B}&from=link`,
		);
	});

	it("drops unknown values instead of passing them on", () => {
		const target = parse(`action=add&kind=safe&chain=solana&env=prod&evil=1&name=${"x".repeat(200)}`);
		const query = new URLSearchParams(target?.to.split("?")[1]);
		expect([...query.keys()].sort()).toEqual(["from", "kind", "name"]);
		expect(query.get("name")).toHaveLength(40);
		expect(parse("action=add&kind=btc")).toBeUndefined();
		expect(parse("action=delete")).toBeUndefined();
		expect(parse("")).toBeUndefined();
	});

	it("fills the create-Safe draft, vanity options included", () => {
		const target = parse(
			`action=create&chain=arbitrum&mode=vanity&owners=${A},${B}&threshold=2&name=Treasury&prefix=0xdead`,
		);
		expect(target?.to).toBe("/accounts/create-safe?chain=arbitrum&mode=vanity&from=link");
		expect(target?.draft).toEqual({ owners: [A, B], threshold: 2, name: "Treasury", prefix: "0xdead" });
	});

	it("repairs a threshold that does not fit the owners and ignores a bad salt", () => {
		expect(parse(`action=create&owners=${A},${B},${A}&threshold=9`)?.draft?.threshold).toBe(2);
		expect(parse("action=create&salt=12345")?.draft).toEqual({ saltNonce: "12345" });
		expect(parse("action=create&salt=0x12")?.draft).toEqual({});
		expect(parse(`action=create&owners=${Array(50).fill(A).join(",")}`)?.draft?.owners).toHaveLength(20);
	});

	it("guards form addresses opened from outside", () => {
		expect(guardEntryHash(`#/accounts/new?kind=hl&address=${A}`, false)).toBe("#/accounts/new");
		expect(guardEntryHash(`#/accounts/new?kind=hl&address=${A}`, true)).toBe(
			`#/accounts/new?kind=hl&address=${A}&from=link`,
		);
		expect(guardEntryHash("#/accounts/create-safe?mode=vanity", false)).toBe("#/accounts/create-safe");
		expect(guardEntryHash("#/accounts/new?kind=hl&from=link", true)).toBeUndefined();
		expect(guardEntryHash("#/accounts/new", false)).toBeUndefined();
		expect(guardEntryHash("#/settings", false)).toBeUndefined();
		expect(guardEntryHash("#/link?action=add&kind=hl", false)).toBeUndefined();
	});
});
