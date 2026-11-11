/**
 * End-to-end check of the advanced Safe operations against a real Safe on a local fork.
 * Run: MSV_FORK=1 npx vitest run tests/advanced.fork.test.ts   (needs Foundry's `anvil` and network access)
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
	createPublicClient,
	createWalletClient,
	getContractAddress,
	http,
	keccak256,
	parseAbi,
	parseEther,
	parseEventLogs,
	stringToHex,
	type Address,
	type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAbiText } from "@/lib/evm/abi";
import { callData, callValueWei, type CallParams } from "@/lib/evm/abiCall";
import { buildDeploy, deployAddress, type DeployParams } from "@/lib/evm/abiDeploy";
import { safeMessageHash, signMessageCalldata } from "@/lib/evm/abiSignMessage";
import { CREATE_CALL_ABI, PROXY_FACTORY_ABI, SAFE_ABI } from "@/lib/safe/abis";
import { defaultCreation, predictSafeAddress } from "@/lib/safe/deploy";
import { SAFE_141 } from "@/lib/safe/deployments";
import { simulateSafeTx } from "@/lib/safe/simulate";
import { encodeExecTransaction, safeTxTypedData, toSafeTx, type MetaTx } from "@/lib/safe/tx";
import { useAppStore } from "@/store/appStore";

const enabled = process.env.MSV_FORK === "1";
const PORT = 8571;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 8453;
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const WETH: Address = "0x4200000000000000000000000000000000000006";
// Init code returning the 10-byte runtime `PUSH1 42 PUSH1 0 MSTORE PUSH1 32 PUSH1 0 RETURN`.
const BYTECODE = "0x600a600c600039600a6000f3602a60005260206000f3";
const RUNTIME = "0x602a60005260206000f3";

describe.skipIf(!enabled)("advanced Safe operations on a fork", () => {
	let anvil: ChildProcess;
	const owner = privateKeyToAccount(KEY);
	const publicClient = createPublicClient({ chain: base, transport: http(RPC) });
	const wallet = createWalletClient({ account: owner, chain: base, transport: http(RPC) });
	let safe: Address;
	let nonce = 0;

	const exec = async (calls: MetaTx[]) => {
		const tx = toSafeTx(calls, nonce);
		const sim = await simulateSafeTx(CHAIN_ID, safe, tx);
		expect(sim.success, sim.reason).toBe(true);
		const typed = safeTxTypedData(CHAIN_ID, safe, tx);
		const signature = await owner.signTypedData({ ...typed, message: typed.message } as never);
		const hash = await wallet.sendTransaction({ to: safe, data: encodeExecTransaction(tx, [{ signer: owner.address, signature }]) });
		const receipt = await publicClient.waitForTransactionReceipt({ hash });
		expect(receipt.status).toBe("success");
		nonce += 1;
		return { receipt, sim };
	};

	beforeAll(async () => {
		anvil = spawn("anvil", ["--fork-url", "https://mainnet.base.org", "--port", String(PORT), "--silent"], { stdio: "ignore" });
		for (let i = 0; i < 100; i++) {
			try {
				await publicClient.getChainId();
				break;
			} catch {
				await new Promise((r) => setTimeout(r, 200));
			}
		}
		useAppStore.setState((s) => ({ settings: { ...s.settings, rpcOverrides: { [String(CHAIN_ID)]: RPC } } }));
		const creation = defaultCreation([owner.address], 1, BigInt(Date.now()));
		safe = predictSafeAddress(creation);
		const hash = await wallet.writeContract({
			address: creation.factory,
			abi: PROXY_FACTORY_ABI,
			functionName: "createProxyWithNonce",
			args: [creation.singleton, creation.initializer, BigInt(creation.saltNonce)],
		});
		await publicClient.waitForTransactionReceipt({ hash });
		expect(await publicClient.readContract({ address: safe, abi: SAFE_ABI, functionName: "getOwners" })).toEqual([owner.address]);
		await wallet.sendTransaction({ to: safe, value: parseEther("1") });
	}, 60_000);

	afterAll(() => {
		anvil?.kill();
	});

	it("deploys with CREATE through CreateCall and finds the ContractCreation event", async () => {
		const params: DeployParams = { bytecodeText: BYTECODE, bytecode: BYTECODE, ctor: "", args: [], rawArgs: "", value: "", method: "create", salt: "" };
		const safeNonce = await publicClient.getTransactionCount({ address: safe });
		const expected = getContractAddress({ opcode: "CREATE", from: safe, nonce: BigInt(safeNonce) });
		const { receipt } = await exec(buildDeploy(params));
		const logs = parseEventLogs({ abi: CREATE_CALL_ABI, eventName: "ContractCreation", logs: receipt.logs });
		const hit = logs.find((l) => l.address.toLowerCase() === safe.toLowerCase());
		expect(hit?.args.newContract).toBe(expected);
		expect(await publicClient.getCode({ address: expected })).toBe(RUNTIME);
	}, 60_000);

	it("deploys with CREATE2 at the predicted address, with value", async () => {
		const params: DeployParams = { bytecodeText: BYTECODE, bytecode: BYTECODE, ctor: "", args: [], rawArgs: "", value: "0.01", method: "create2", salt: "vault" };
		const predicted = deployAddress(params, safe) as Address;
		expect(predicted).toBe(getContractAddress({ opcode: "CREATE2", from: safe, salt: keccak256(stringToHex("vault")), bytecode: BYTECODE }));
		const { receipt } = await exec(buildDeploy(params));
		const logs = parseEventLogs({ abi: CREATE_CALL_ABI, eventName: "ContractCreation", logs: receipt.logs });
		expect(logs[0].args.newContract).toBe(predicted);
		expect(await publicClient.getCode({ address: predicted })).toBe(RUNTIME);
		expect(await publicClient.getBalance({ address: predicted })).toBe(parseEther("0.01"));
		// Same salt again must fail in simulation.
		const again = await simulateSafeTx(CHAIN_ID, safe, toSafeTx(buildDeploy(params), nonce));
		expect(again.success).toBe(false);
	}, 60_000);

	it("calls a payable function built from a human-readable ABI", async () => {
		const fn = parseAbiText("function deposit() payable").functions[0];
		const params: CallParams = { to: WETH, value: "0.05", mode: "abi", abiText: "", fragment: JSON.stringify(fn), args: [], data: "" };
		await exec([{ to: WETH, value: callValueWei(params), data: callData(params) }]);
		const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
		expect(await publicClient.readContract({ address: WETH, abi: erc20, functionName: "balanceOf", args: [safe] })).toBe(parseEther("0.05"));

		const transfer = parseAbiText("transfer(address to, uint256 amount)").functions[0];
		const send: CallParams = { ...params, value: "", fragment: JSON.stringify(transfer), args: [owner.address, "1000"] };
		await exec([{ to: WETH, value: 0n, data: callData(send) }]);
		expect(await publicClient.readContract({ address: WETH, abi: erc20, functionName: "balanceOf", args: [owner.address] })).toBeGreaterThanOrEqual(1000n);

		// A call that must revert is reported with its reason.
		const tooMuch: CallParams = { ...send, args: [owner.address, parseEther("5").toString()] };
		const sim = await simulateSafeTx(CHAIN_ID, safe, toSafeTx([{ to: WETH, value: 0n, data: callData(tooMuch) }], nonce));
		expect(sim.success).toBe(false);
	}, 60_000);

	it("signs a message hash so that EIP-1271 validation passes", async () => {
		const digest: Hex = keccak256(stringToHex("MultiSigVault release v1\ntest"));
		const call = { address: safe, abi: SAFE_ABI, functionName: "isValidSignature", args: [digest, "0x"] } as const;
		await expect(publicClient.readContract(call)).rejects.toThrow();
		await exec([{ to: SAFE_141.signMessageLib, value: 0n, data: signMessageCalldata(digest), operation: 1 }]);
		expect(await publicClient.readContract(call)).toBe("0x1626ba7e");
		const signed = await publicClient.readContract({
			address: safe,
			abi: parseAbi(["function signedMessages(bytes32) view returns (uint256)"]),
			functionName: "signedMessages",
			args: [safeMessageHash(CHAIN_ID, safe, digest)],
		});
		expect(signed).toBe(1n);
	}, 60_000);
});
