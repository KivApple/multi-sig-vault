import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { describeExplorerTx, describeLedgerEntry, recoverMultiSigSigners } from "@/lib/history/hl";
import { describeCreation, describeSafeRecord, transferAmounts } from "@/lib/history/safe";
import { hlMultiSigWrapper, hlSignerTypedData } from "@/lib/hl/signing";
import { toFullTypedData } from "@/lib/wallets/typedData";
import type { HlPayload } from "@/types/domain";

const ME = "0x029fA9D9A10ea5c8187BFe9FA6a428792cc3a945";
const OTHER = "0x207700bD207df757825F9193eF9C648C1C65E06a";
const HASH = `0x${"ab".repeat(32)}`;

describe("Hyperliquid ledger", () => {
	const entry = (delta: Record<string, unknown> & { type: string }) => ({ time: 1_700_000_000_000, hash: HASH, delta });

	it("reads a withdrawal and a deposit", () => {
		const out = describeLedgerEntry(
			entry({ type: "withdraw", usdc: "257451.85", nonce: 1, fee: "1.0" }),
			ME,
			"mainnet",
		);
		expect(out.title).toEqual({ key: "history.hl.withdraw", vars: undefined });
		expect(out.amounts).toEqual([{ sign: -1, value: "257451.85", symbol: "USDC" }]);
		expect(out.link).toBe(`https://app.hyperliquid.xyz/explorer/tx/${HASH}`);
		const dep = describeLedgerEntry(entry({ type: "deposit", usdc: "100.0" }), ME, "mainnet");
		expect(dep.amounts[0].sign).toBe(1);
		// Nobody on the account signs a deposit.
		expect(dep.hlHash).toBeUndefined();
	});

	it("tells incoming from outgoing by the two addresses", () => {
		const incoming = describeLedgerEntry(
			entry({
				type: "spotTransfer",
				token: "MAX",
				amount: "3067903.9185",
				user: OTHER.toLowerCase(),
				destination: ME.toLowerCase(),
			}),
			ME,
			"mainnet",
		);
		expect(incoming.amounts).toEqual([{ sign: 1, value: "3067903.9185", symbol: "MAX" }]);
		expect(incoming.counterparty).toEqual({ role: "from", address: OTHER });
		expect(incoming.hlHash).toBeUndefined();
		const outgoing = describeLedgerEntry(
			entry({ type: "internalTransfer", usdc: "5", user: ME.toLowerCase(), destination: OTHER.toLowerCase() }),
			ME,
			"mainnet",
		);
		expect(outgoing.amounts[0].sign).toBe(-1);
		expect(outgoing.counterparty).toEqual({ role: "to", address: OTHER });
		expect(outgoing.hlHash).toBe(HASH);
	});

	it("names a move between the account's own balances", () => {
		const out = describeLedgerEntry(
			entry({
				type: "send",
				user: ME,
				destination: ME,
				sourceDex: "spot",
				destinationDex: "",
				token: "USDC",
				amount: "99959.73",
			}),
			ME,
			"mainnet",
		);
		expect(out.title).toEqual({ key: "history.hl.move", vars: { from: "Spot", to: "Perps" } });
		expect(out.amounts[0].sign).toBe(0);
	});

	it("keeps an unknown kind under its own name and drops unsafe text", () => {
		const out = describeLedgerEntry(entry({ type: "somethingNew", usdc: "1.5" }), ME, "mainnet");
		expect(out.title).toEqual({ raw: "somethingNew" });
		expect(out.amounts).toEqual([{ sign: 0, value: "1.5", symbol: "USDC" }]);
		const bad = describeLedgerEntry(entry({ type: "<img src=x>", amount: "1e9", token: "<b>" }), ME, "mainnet");
		expect(bad.title).toEqual({ raw: "?" });
		expect(bad.amounts).toEqual([]);
		// A zero hash is not a transaction.
		const zero = describeLedgerEntry(
			{
				time: 1,
				hash: `0x${"0".repeat(64)}`,
				delta: { type: "cStakingTransfer", token: "HYPE", amount: "1", isDeposit: false },
			},
			ME,
			"mainnet",
		);
		expect(zero.link).toBeUndefined();
	});
});

describe("Hyperliquid actions from the explorer", () => {
	const tx = (action: Record<string, unknown>, user = ME) => ({ time: 5, user, hash: HASH, error: null, action });

	it("shows agent approval and revocation, without the stored term", async () => {
		const agent = "0xa245390F6A1f19A67DEcEe2883363A4205EBD0FE";
		const approved = await describeExplorerTx(
			tx({
				type: "approveAgent",
				hyperliquidChain: "Mainnet",
				agentAddress: agent.toLowerCase(),
				agentName: "bot valid_until 1790000000000",
			}),
			ME,
			"mainnet",
		);
		expect(approved?.title).toEqual({ key: "history.hl.agentApprove", vars: { name: "bot" } });
		expect(approved?.counterparty).toEqual({ role: "to", address: agent });
		const revoked = await describeExplorerTx(
			tx({ type: "approveAgent", hyperliquidChain: "Mainnet", agentAddress: `0x${"0".repeat(40)}`, agentName: "bot" }),
			ME,
			"mainnet",
		);
		expect(revoked?.title).toEqual({ key: "history.hl.agentRevoke", vars: { name: "bot" } });
	});

	it("shows a multi-sig conversion with its numbers", async () => {
		const signers = JSON.stringify({ authorizedUsers: [ME, OTHER], threshold: 2 });
		const on = await describeExplorerTx(
			tx({ type: "convertToMultiSigUser", hyperliquidChain: "Mainnet", signers }),
			ME,
			"mainnet",
		);
		expect(on?.title).toEqual({ key: "history.hl.multiSigOn", vars: { m: "2", n: "2" } });
		const off = await describeExplorerTx(
			tx({ type: "convertToMultiSigUser", hyperliquidChain: "Mainnet", signers: "null" }),
			ME,
			"mainnet",
		);
		expect(off?.title).toEqual({ key: "history.hl.multiSigOff", vars: undefined });
	});

	it("leaves out trading, ledger-covered actions and other people's transactions", async () => {
		expect(await describeExplorerTx(tx({ type: "order", orders: [] }), ME, "mainnet")).toBeUndefined();
		expect(await describeExplorerTx(tx({ type: "updateLeverage" }), ME, "mainnet")).toBeUndefined();
		expect(
			await describeExplorerTx(tx({ type: "withdraw3", hyperliquidChain: "Mainnet" }), ME, "mainnet"),
		).toBeUndefined();
		expect(
			await describeExplorerTx(tx({ type: "approveAgent", hyperliquidChain: "Mainnet" }, OTHER), ME, "mainnet"),
		).toBeUndefined();
		// A user-signed action the app has no name for is still the account's own key at work.
		const unknown = await describeExplorerTx(
			tx({ type: "userSetAbstraction", hyperliquidChain: "Mainnet" }),
			ME,
			"mainnet",
		);
		expect(unknown?.title).toEqual({ raw: "userSetAbstraction" });
	});

	it("recovers who signed a multi-sig action", async () => {
		const keys = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()];
		const owners = keys.map((k) => privateKeyToAccount(k));
		const leader = owners[0].address.toLowerCase() as `0x${string}`;
		const payload: HlPayload = {
			kind: "hl",
			multiSig: true,
			leader,
			nonce: 1_790_000_000_000,
			signing: "user",
			action: {
				type: "approveAgent",
				signatureChainId: "0xa4b1",
				hyperliquidChain: "Mainnet",
				agentAddress: OTHER.toLowerCase(),
				agentName: "desk",
				nonce: 1_790_000_000_000,
			},
		};
		const typed = toFullTypedData(hlSignerTypedData(payload, ME, "mainnet"));
		const signatures = await Promise.all(
			owners.slice(0, 2).map(async (o) => ({ signer: o.address, signature: await o.signTypedData(typed as never) })),
		);
		const wrapper = hlMultiSigWrapper(payload, ME, "mainnet", signatures);
		const found = await recoverMultiSigSigners(wrapper, "mainnet");
		expect(found?.signers).toEqual([owners[0].address, owners[1].address]);
		expect(found?.sender?.toLowerCase()).toBe(leader);

		const row = await describeExplorerTx(
			{ time: 9, user: leader, hash: HASH, error: null, action: wrapper },
			ME,
			"mainnet",
		);
		expect(row?.title).toEqual({ key: "history.hl.agentApprove", vars: { name: "desk" } });
		expect(row?.signers).toEqual([owners[0].address, owners[1].address]);
		// The same wrapper for another multi-sig user is not this account's history.
		expect(
			await describeExplorerTx({ time: 9, user: leader, hash: HASH, error: null, action: wrapper }, OTHER, "mainnet"),
		).toBeUndefined();
	});
});

describe("Safe history", () => {
	const SAFE = "0x22222222e8d995EA51841abc49022Fb5eb7C62b4";
	const TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
	const usdc = { symbol: "USDC", decimals: 6, trusted: true };

	it("nets transfers per token and ignores tokens nobody vouches for", () => {
		const amounts = transferAmounts(
			[
				{ type: "ERC20_TRANSFER", from: SAFE, to: OTHER, value: "2500000", tokenAddress: TOKEN, tokenInfo: usdc },
				{ type: "ERC20_TRANSFER", from: OTHER, to: SAFE, value: "500000", tokenAddress: TOKEN, tokenInfo: usdc },
				{ type: "ETHER_TRANSFER", from: OTHER, to: SAFE, value: "1000000000000000000" },
				{
					type: "ERC20_TRANSFER",
					from: OTHER,
					to: SAFE,
					value: "999",
					tokenInfo: { symbol: "USDC", decimals: 6, trusted: false },
				},
				{ type: "ERC721_TRANSFER", from: OTHER, to: SAFE, tokenId: "1" },
			],
			SAFE,
			1,
			false,
		);
		expect(amounts).toEqual([
			{ sign: -1, value: "2", symbol: "USDC" },
			{ sign: 1, value: "1", symbol: "ETH" },
		]);
	});

	it("reads an executed Safe transaction with its signers", () => {
		const row = describeSafeRecord(
			{
				txType: "MULTISIG_TRANSACTION",
				executionDate: "2026-10-06T11:30:00Z",
				isExecuted: true,
				isSuccessful: true,
				to: "0xd53cd0aB83D845Ac265BE939c57F53AD838012c9",
				value: "0",
				data: "0x85a5affe00",
				dataDecoded: { method: "signMessage" },
				safeTxHash: HASH,
				transactionHash: HASH,
				executor: "0xA0952F1ad801e7ca0256d0979a29180335bA9DEC",
				confirmations: [
					{ owner: "0xe6960ad4aA297396069CE001D7fc586767b5F423" },
					{ owner: "0x03D0D9a257CCd8262654E0c4Baa4A2c63bF79812" },
					{ owner: "nonsense" },
				],
				transfers: [],
			},
			SAFE,
			1,
		);
		expect(row?.title).toEqual({ key: "history.safe.signMessage" });
		expect(row?.signers).toEqual([
			"0xe6960ad4aA297396069CE001D7fc586767b5F423",
			"0x03D0D9a257CCd8262654E0c4Baa4A2c63bF79812",
		]);
		expect(row?.sender).toBe("0xA0952F1ad801e7ca0256d0979a29180335bA9DEC");
		expect(row?.link).toBe(`https://etherscan.io/tx/${HASH}`);
	});

	it("skips pending transactions and transfers without a visible amount", () => {
		expect(
			describeSafeRecord({ txType: "MULTISIG_TRANSACTION", executionDate: null, isExecuted: false }, SAFE, 1),
		).toBeUndefined();
		const spam = {
			txType: "ETHEREUM_TRANSACTION",
			executionDate: "2026-11-12T10:00:00Z",
			txHash: HASH,
			transfers: [
				{
					type: "ERC20_TRANSFER",
					from: OTHER,
					to: SAFE,
					value: "1",
					tokenInfo: { symbol: "USDC", decimals: 6, trusted: false },
				},
			],
		};
		expect(describeSafeRecord(spam, SAFE, 1)).toBeUndefined();
		const real = { ...spam, transfers: [{ type: "ETHER_TRANSFER", from: OTHER, to: SAFE, value: "5000000000000000" }] };
		const row = describeSafeRecord(real, SAFE, 1);
		expect(row?.title).toEqual({ key: "history.safe.received" });
		expect(row?.counterparty).toEqual({ role: "from", address: OTHER });
		expect(row?.amounts).toEqual([{ sign: 1, value: "0.005", symbol: "ETH" }]);
	});

	it("shows an unknown method by name only when it is a plain identifier", () => {
		const base = {
			txType: "MULTISIG_TRANSACTION",
			executionDate: "2026-11-12T10:00:00Z",
			isExecuted: true,
			data: "0x12345678",
			safeTxHash: HASH,
			to: OTHER,
		};
		expect(describeSafeRecord({ ...base, dataDecoded: { method: "setPreSignature" } }, SAFE, 1)?.title).toEqual({
			raw: "setPreSignature",
		});
		expect(describeSafeRecord({ ...base, dataDecoded: { method: "<script>" } }, SAFE, 1)?.title).toEqual({
			key: "history.safe.call",
		});
		expect(describeSafeRecord({ ...base, dataDecoded: null }, SAFE, 1)?.title).toEqual({ key: "history.safe.call" });
	});

	it("shows the creation of the Safe with its first signers", () => {
		const row = describeCreation(
			{
				created: "2026-10-05T09:15:00Z",
				creator: "0xA0952F1ad801e7ca0256d0979a29180335bA9DEC",
				transactionHash: HASH,
				dataDecoded: {
					method: "setup",
					parameters: [
						{
							name: "_owners",
							value: [
								"0xA0952F1ad801e7ca0256d0979a29180335bA9DEC",
								"0x03D0D9a257CCd8262654E0c4Baa4A2c63bF79812",
								"0xe6960ad4aA297396069CE001D7fc586767b5F423",
							],
						},
						{ name: "_threshold", value: "2" },
					],
				},
			},
			1,
		);
		expect(row?.title).toEqual({ key: "history.safe.createdWith", vars: { m: "2", n: "3" } });
		expect(row?.sender).toBe("0xA0952F1ad801e7ca0256d0979a29180335bA9DEC");
		expect(row?.time).toBe(Date.parse("2026-10-05T09:15:00Z"));
		// Without readable parameters it is still a row, just without the numbers.
		expect(describeCreation({ created: "2026-10-05T09:15:00Z", dataDecoded: null }, 1)?.title).toEqual({
			key: "history.safe.created",
		});
		expect(describeCreation({ created: "nonsense" }, 1)).toBeUndefined();
	});

	it("shows a token send with the receiver and the amount, whatever the service thinks of the token", () => {
		const to = "0xA0952F1ad801e7ca0256d0979a29180335bA9DEC";
		const row = describeSafeRecord(
			{
				txType: "MULTISIG_TRANSACTION",
				executionDate: "2026-10-07T14:20:00Z",
				isExecuted: true,
				isSuccessful: true,
				to: TOKEN,
				value: "0",
				data: "0xa9059cbb00",
				dataDecoded: {
					method: "transfer",
					parameters: [
						{ name: "to", value: to },
						{ name: "value", value: "50000000" },
					],
				},
				safeTxHash: HASH,
				executor: to,
				transfers: [
					{
						type: "ERC20_TRANSFER",
						from: SAFE,
						to,
						value: "50000000",
						tokenAddress: TOKEN,
						tokenInfo: { symbol: "USDC", decimals: 6, trusted: false },
					},
				],
			},
			SAFE,
			11155111,
		);
		expect(row?.title).toEqual({ key: "history.safe.send" });
		expect(row?.amounts).toEqual([{ sign: -1, value: "50", symbol: "USDC" }]);
		expect(row?.counterparty).toEqual({ role: "to", address: to });
	});

	it("names a call to the swap router a swap, with what left and what came", () => {
		const router = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
		const row = describeSafeRecord(
			{
				txType: "MULTISIG_TRANSACTION",
				executionDate: "2026-10-07T14:10:00Z",
				isExecuted: true,
				isSuccessful: true,
				to: router,
				value: "10000000000000000",
				data: "0x5ae401dc00",
				dataDecoded: { method: "multicall", parameters: [] },
				safeTxHash: HASH,
				transfers: [
					{
						type: "ERC20_TRANSFER",
						from: OTHER,
						to: SAFE,
						value: "28700000",
						tokenAddress: TOKEN,
						tokenInfo: { symbol: "USDC", decimals: 6, trusted: false },
					},
					{ type: "ETHER_TRANSFER", from: SAFE, to: router, value: "10000000000000000" },
				],
			},
			SAFE,
			11155111,
		);
		expect(row?.title).toEqual({ key: "history.safe.swap" });
		expect(row?.amounts).toEqual([
			{ sign: -1, value: "0.01", symbol: "ETH" },
			{ sign: 1, value: "28.7", symbol: "USDC" },
		]);
		expect(row?.counterparty).toBeUndefined();
	});

	it("states what crossed the bridge next to what stayed", () => {
		const router = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
		const messenger = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
		const row = describeSafeRecord(
			{
				txType: "MULTISIG_TRANSACTION",
				executionDate: "2026-10-07T15:00:00Z",
				isExecuted: true,
				isSuccessful: true,
				to: "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D",
				value: "0",
				data: "0x8d80ff0a00",
				dataDecoded: {
					method: "multiSend",
					parameters: [{ name: "transactions", valueDecoded: [{ to: router }, { to: TOKEN }, { to: messenger }] }],
				},
				safeTxHash: HASH,
				transfers: [
					{ type: "ETHER_TRANSFER", from: SAFE, to: router, value: "10000000000000000" },
					{
						type: "ERC20_TRANSFER",
						from: OTHER,
						to: SAFE,
						value: "289500000",
						tokenAddress: TOKEN,
						tokenInfo: { symbol: "USDC", decimals: 6 },
					},
					{
						type: "ERC20_TRANSFER",
						from: SAFE,
						to: OTHER,
						value: "286700000",
						tokenAddress: TOKEN,
						tokenInfo: { symbol: "USDC", decimals: 6 },
					},
				],
			},
			SAFE,
			11155111,
		);
		expect(row?.title).toEqual({ key: "history.safe.swapBridge" });
		expect(row?.amounts).toEqual([
			{ sign: -1, value: "0.01", symbol: "ETH" },
			{ sign: 0, value: "286.7", symbol: "USDC", bridged: true },
			{ sign: 1, value: "2.8", symbol: "USDC" },
		]);
		// A bridge alone is one line.
		const alone = transferAmounts(
			[
				{
					type: "ERC20_TRANSFER",
					from: SAFE,
					to: OTHER,
					value: "5000000",
					tokenAddress: TOKEN,
					tokenInfo: { symbol: "USDC", decimals: 6 },
				},
			],
			SAFE,
			11155111,
			true,
			TOKEN,
		);
		expect(alone).toEqual([{ sign: -1, value: "5", symbol: "USDC", bridged: true }]);
	});
});
