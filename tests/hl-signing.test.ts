import {
	signL1Action,
	signMultiSigL1,
	signMultiSigUserSigned,
	signUserSignedAction,
} from "@nktkas/hyperliquid/signing";
import { getTypesForEIP712Domain, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { hlMultiSigWrapper, hlOuterTypedData, hlSignerTypedData, splitSignature, USER_SIGNED } from "@/lib/hl/signing";
import type { TypedDataPayload } from "@/lib/wallets/types";
import type { HlPayload, OpSignature } from "@/types/domain";

const sign = (key: Hex, data: TypedDataPayload): Promise<Hex> =>
	privateKeyToAccount(key).signTypedData({
		domain: data.domain,
		types: { EIP712Domain: getTypesForEIP712Domain({ domain: data.domain }), ...data.types },
		primaryType: data.primaryType,
		message: data.message,
	} as never);

const keys = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()];
const accounts = keys.map((k) => privateKeyToAccount(k));
const multiSigUser = privateKeyToAccount(generatePrivateKey()).address;
const nonce = 1_762_900_000_123;

const USER_ACTIONS: Record<string, unknown>[] = [
	{
		type: "usdSend",
		signatureChainId: "0xa4b1",
		hyperliquidChain: "Mainnet",
		destination: multiSigUser.toLowerCase(),
		amount: "12.5",
		time: nonce,
	},
	{
		type: "withdraw3",
		signatureChainId: "0xa4b1",
		hyperliquidChain: "Mainnet",
		destination: multiSigUser.toLowerCase(),
		amount: "100",
		time: nonce,
	},
	{
		type: "spotSend",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		destination: multiSigUser.toLowerCase(),
		token: "PURR:0xc4bf3f870c0e9465323c0b6ed28096c2",
		amount: "3",
		time: nonce,
	},
	{
		type: "usdClassTransfer",
		signatureChainId: "0xa4b1",
		hyperliquidChain: "Mainnet",
		amount: "7",
		toPerp: true,
		nonce,
	},
	{
		type: "approveAgent",
		signatureChainId: "0xa4b1",
		hyperliquidChain: "Mainnet",
		agentAddress: accounts[2].address.toLowerCase(),
		agentName: "Mobile QR",
		nonce,
	},
	{
		type: "convertToMultiSigUser",
		signatureChainId: "0xa4b1",
		hyperliquidChain: "Mainnet",
		signers: JSON.stringify({ authorizedUsers: accounts.map((a) => a.address.toLowerCase()).sort(), threshold: 2 }),
		nonce,
	},
	{
		type: "sendAsset",
		signatureChainId: "0xa4b1",
		hyperliquidChain: "Mainnet",
		destination: multiSigUser.toLowerCase(),
		sourceDex: "",
		destinationDex: "spot",
		token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
		amount: "1",
		fromSubAccount: "",
		nonce,
	},
];

const L1_ACTIONS: Record<string, unknown>[] = [
	{ type: "createSubAccount", name: "desk" },
	{ type: "subAccountModify", subAccountUser: accounts[1].address.toLowerCase(), name: "renamed" },
	{
		type: "subAccountTransfer",
		subAccountUser: accounts[1].address.toLowerCase(),
		isDeposit: true,
		usd: 5_000_000_000,
	},
	{
		type: "subAccountSpotTransfer",
		subAccountUser: accounts[1].address.toLowerCase(),
		isDeposit: false,
		token: "PURR:0xc4bf3f870c0e9465323c0b6ed28096c2",
		amount: "1.5",
	},
];

const sdkTypes = (action: Record<string, unknown>): Record<string, { name: string; type: string }[]> => {
	const def = USER_SIGNED[String(action.type)];
	return { [def.primaryType]: def.fields };
};

describe("Hyperliquid signing matches the reference SDK", () => {
	it.each(USER_ACTIONS)("user-signed multi-sig: $type", async (action) => {
		const env = action.hyperliquidChain === "Mainnet" ? "mainnet" : "testnet";
		const payload: HlPayload = {
			kind: "hl",
			multiSig: true,
			leader: accounts[0].address,
			nonce,
			signing: "user",
			action,
		};
		const typed = hlSignerTypedData(payload, multiSigUser, env);
		const signatures: OpSignature[] = [];
		for (const [i, key] of keys.entries()) {
			signatures.push({ signer: accounts[i].address, signature: await sign(key, typed) });
		}
		const wrapper = hlMultiSigWrapper(payload, multiSigUser, env, signatures);
		const outer = splitSignature(await sign(keys[0], hlOuterTypedData(wrapper, nonce, env)));

		const ref = await signMultiSigUserSigned({
			signers: accounts as never,
			multiSigUser,
			action: action as never,
			types: sdkTypes(action) as never,
		});
		expect(wrapper).toEqual(ref.action);
		expect(JSON.stringify(wrapper)).toEqual(JSON.stringify(ref.action));
		expect(outer).toEqual(ref.signature);
	});

	it.each(USER_ACTIONS)("user-signed plain account: $type", async (action) => {
		const env = action.hyperliquidChain === "Mainnet" ? "mainnet" : "testnet";
		const payload: HlPayload = {
			kind: "hl",
			multiSig: false,
			leader: accounts[0].address,
			nonce,
			signing: "user",
			action,
		};
		const mine = splitSignature(await sign(keys[0], hlSignerTypedData(payload, accounts[0].address, env)));
		const ref = await signUserSignedAction({
			wallet: accounts[0] as never,
			action: action as never,
			types: sdkTypes(action) as never,
		});
		expect(mine).toEqual(ref);
	});

	it.each(L1_ACTIONS)("L1 multi-sig: $type", async (action) => {
		for (const env of ["mainnet", "testnet"] as const) {
			const payload: HlPayload = {
				kind: "hl",
				multiSig: true,
				leader: accounts[0].address,
				nonce,
				signing: "l1",
				action,
			};
			const typed = hlSignerTypedData(payload, multiSigUser, env);
			const signatures: OpSignature[] = [];
			for (const [i, key] of keys.entries()) {
				signatures.push({ signer: accounts[i].address, signature: await sign(key, typed) });
			}
			const wrapper = hlMultiSigWrapper(payload, multiSigUser, env, signatures);
			const outer = splitSignature(await sign(keys[0], hlOuterTypedData(wrapper, nonce, env)));
			const ref = await signMultiSigL1({
				signers: accounts as never,
				multiSigUser,
				signatureChainId: wrapper.signatureChainId,
				action,
				nonce,
				isTestnet: env === "testnet",
			});
			expect(JSON.stringify(wrapper)).toEqual(JSON.stringify(ref.action));
			expect(outer).toEqual(ref.signature);
		}
	});

	it.each(L1_ACTIONS)("L1 plain account: $type", async (action) => {
		const payload: HlPayload = {
			kind: "hl",
			multiSig: false,
			leader: accounts[0].address,
			nonce,
			signing: "l1",
			action,
		};
		const mine = splitSignature(await sign(keys[0], hlSignerTypedData(payload, accounts[0].address, "mainnet")));
		const ref = await signL1Action({ wallet: accounts[0] as never, action, nonce });
		expect(mine).toEqual(ref);
	});
});
