import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { isUnitDestination, unitAssetOf, verifyUnitAddress } from "@/lib/hl/unit";
import { buildPayload } from "@/lib/ops/engine";
import { accountId } from "@/store/appStore";
import type { Account } from "@/types/domain";

// Real responses of GET /gen/hyperliquid/<chain>/<asset>/<destination> (captured 2026-11-12).
const ETH = {
	destination: "0x000000000000000000000000000000000000dEaD",
	address: "0xBf8E0f53E167a3dcf60DaF450b0BA288F2E4Ce37",
	signatures: {
		"field-node": "G2sPEpHWc6sKQsS+PpkmAp4TRKBUvUY0JL8tI1gL0BZ249jVQ0cOYwwDA2S+ElmEqfvCqFmYT4EdHpo9lWP83g==",
		"hl-node": "GTdrosQBo8af0UoHSxkknJfpHvIot/i23CxmznWyFdiep/Q09kH+f2V/nMcsbb3YRfVT+wf2HP9AAW96XdWQrQ==",
		"unit-node": "xWRtM/WntqguXxA+gTp7kvV2dVxHXpgtTFJbbMql3qRzpglgT1TOUF35RYuLnxZ5/xHSWOjnO3FPB+WQwvC8kQ==",
	},
};
const BTC = {
	destination: "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297",
	address: "0xe8194662Eb62c02def7DD2Cc00209B84653ff844",
	signatures: {
		"field-node": "MSH7Bj0QFldSLN/4i7qVlrZu/DWQx3/rZ3h38H9jUqKamwTb0h8CO0xRRCilXmI1Ri/GKvJq+FqonA6NW5fNag==",
		"hl-node": "7HUI0Ijf0gdoilJw2c5onyBViqiNOh3cq9YLhlda+FnRI578GJHkDhYiutWePy2oVB3EDqetVXlLkwumRaXz3g==",
		"unit-node": "dKltE+nVi/YmP+00aI5aTRcktaB3zUd/EuRpNQYennP38FgKZmgX+3JW4CfV6PZ0VmratHN2N/J2B58rC5330A==",
	},
};
const TESTNET_ETH = {
	destination: "0x563C175E6f11582f65D6d9E360A618699DEe14a9",
	address: "0x04852E5E66B6A43c09F55Ae44dd5B3B39b63Aa9D",
	signatures: {
		"field-node": "EIC7HSxj/HwNpvrH1NNk9WXy0gKfawf+FXqUAVPV42t7U+ycZr0uWgElcnhNkPoQf1IPUXOQaaaM5pQG5WAfsQ==",
		"hl-node-testnet": "fIu53btfDOhMXiLakxnA8H6VH/SkX9txhTdR6plOhTqYcvhMMFyFZnorcgcYyFpxw2yYFm+Tm4zKLtE5dEaL+A==",
		"node-1": "tq5b6JurI5IF/pYc3mFwzOebpmNct5FvesCBhIFeKY/QL+cnXLSAVoYxmLGb0Wv2SkMIEBxQkxUAclSTgPFV3Q==",
	},
};

describe("Unit guardian signatures", () => {
	it("accepts real responses", () => {
		expect(
			verifyUnitAddress("mainnet", { chain: "ethereum", asset: "eth" }, ETH.destination, ETH.address, ETH.signatures),
		).toBe(true);
		expect(
			verifyUnitAddress("mainnet", { chain: "bitcoin", asset: "btc" }, BTC.destination, BTC.address, BTC.signatures),
		).toBe(true);
		expect(
			verifyUnitAddress(
				"testnet",
				{ chain: "ethereum", asset: "eth" },
				TESTNET_ETH.destination,
				TESTNET_ETH.address,
				TESTNET_ETH.signatures,
			),
		).toBe(true);
	});

	it("rejects a swapped address, destination, chain or environment", () => {
		expect(
			verifyUnitAddress("mainnet", { chain: "ethereum", asset: "eth" }, ETH.destination, BTC.address, ETH.signatures),
		).toBe(false);
		expect(
			verifyUnitAddress(
				"mainnet",
				{ chain: "ethereum", asset: "eth" },
				"0x000000000000000000000000000000000000dEaF",
				ETH.address,
				ETH.signatures,
			),
		).toBe(false);
		expect(
			verifyUnitAddress("mainnet", { chain: "base", asset: "virtual" }, ETH.destination, ETH.address, ETH.signatures),
		).toBe(false);
		// Bitcoin signatures also commit to the asset.
		expect(
			verifyUnitAddress("mainnet", { chain: "bitcoin", asset: "eth" }, BTC.destination, BTC.address, BTC.signatures),
		).toBe(false);
		expect(
			verifyUnitAddress("testnet", { chain: "ethereum", asset: "eth" }, ETH.destination, ETH.address, ETH.signatures),
		).toBe(false);
	});

	it("needs two guardians", () => {
		const one = { "hl-node": ETH.signatures["hl-node"] };
		expect(verifyUnitAddress("mainnet", { chain: "ethereum", asset: "eth" }, ETH.destination, ETH.address, one)).toBe(
			false,
		);
		const two = { ...one, "unit-node": ETH.signatures["unit-node"] };
		expect(verifyUnitAddress("mainnet", { chain: "ethereum", asset: "eth" }, ETH.destination, ETH.address, two)).toBe(
			true,
		);
		expect(
			verifyUnitAddress("mainnet", { chain: "ethereum", asset: "eth" }, ETH.destination, ETH.address, {
				...two,
				"unit-node": "AAAA",
			}),
		).toBe(false);
	});
});

describe("Unit destinations", () => {
	it("validates addresses with their checksums", () => {
		expect(isUnitDestination("bitcoin", BTC.destination, "mainnet")).toBe(true);
		expect(isUnitDestination("bitcoin", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "mainnet")).toBe(true);
		expect(isUnitDestination("bitcoin", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "mainnet")).toBe(true);
		expect(isUnitDestination("bitcoin", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5", "mainnet")).toBe(false);
		expect(isUnitDestination("bitcoin", BTC.destination, "testnet")).toBe(false);
		expect(isUnitDestination("bitcoin", ETH.destination, "mainnet")).toBe(false);
		expect(isUnitDestination("solana", "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", "mainnet")).toBe(true);
		expect(isUnitDestination("solana", "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB", "mainnet")).toBe(false);
		expect(isUnitDestination("zcash", "t1VpYecBW4UudbGcy4ufh61eWxQCoFaUrPs", "mainnet")).toBe(true);
		expect(isUnitDestination("ethereum", ETH.destination, "mainnet")).toBe(true);
	});

	it("maps Hyperliquid token names to Unit assets", () => {
		expect(unitAssetOf("mainnet", "UBTC")?.chain).toBe("bitcoin");
		expect(unitAssetOf("mainnet", "UUUSPX")?.asset).toBe("spxs");
		expect(unitAssetOf("testnet", "UNIT")?.asset).toBe("btc");
		expect(unitAssetOf("mainnet", "PURR")).toBeUndefined();
	});
});

describe("Unit withdrawal operation", () => {
	const user = "0x1111111111111111111111111111111111111111";
	const account: Account = {
		id: accountId("hl", "mainnet", user),
		kind: "hl",
		env: "mainnet",
		address: user,
		hidden: false,
		hideDust: false,
		addedAt: 1,
	};
	const params = {
		token: 197,
		tokenRef: "UBTC:0x8f254b963e8468305d409b33aa137c67",
		coin: "UBTC",
		amount: "0.01",
		destination: BTC.destination,
		protocolAddress: BTC.address,
		signatures: BTC.signatures,
	};
	const seed = { multiSig: true, leader: user, nonce: 1_762_900_000_000 } as const;

	it("sends the token to the guardian-signed address only", () => {
		const payload = buildPayload({ type: "hl.unitWithdraw", params }, account, seed);
		expect(payload.kind === "hl" && payload.action).toMatchObject({
			type: "spotSend",
			destination: BTC.address.toLowerCase(),
			token: params.tokenRef,
			amount: "0.01",
		});
		// Another protocol address, or another recipient for the same protocol address, cannot be built.
		expect(() =>
			buildPayload({ type: "hl.unitWithdraw", params: { ...params, protocolAddress: ETH.address } }, account, seed),
		).toThrow();
		expect(() =>
			buildPayload(
				{ type: "hl.unitWithdraw", params: { ...params, destination: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" } },
				account,
				seed,
			),
		).toThrow();
		expect(() =>
			buildPayload({ type: "hl.unitWithdraw", params: { ...params, signatures: {} } }, account, seed),
		).toThrow();
	});
});
