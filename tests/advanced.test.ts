import { encodeAbiParameters, encodeFunctionData, getContractAddress, keccak256, parseAbi, stringToHex, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
	argKind,
	argPlaceholder,
	coerceArg,
	encodeCall,
	encodeCtorArgs,
	functionKey,
	functionSignature,
	isWritable,
	normalizeHex,
	parseAbiText,
	parseCtorFragment,
	parseFragment,
} from "@/lib/evm/abi";
import { callData, type CallParams } from "@/lib/evm/abiCall";
import { buildDeploy, deployAddress, deployInitCode, deploySalt, type DeployParams } from "@/lib/evm/abiDeploy";
import { AppError } from "@/lib/errors";
import { SAFE_141, SAFE_LIBS } from "@/lib/safe/deployments";
import { CREATE_CALL_ABI } from "@/lib/safe/abis";
import { computeSafeTxHash, toSafeTx } from "@/lib/safe/tx";
import { signMessageCalldata as releaseCalldata } from "@/lib/update/releaseCore.mjs";
import { isBytes32, safeMessageHash, signMessageCalldata } from "@/lib/evm/abiSignMessage";

const SAFE = "0x1111111111111111111111111111111111111111";
const ADDR = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

const key = (fn: () => unknown): string => {
	try {
		fn();
	} catch (e) {
		return e instanceof AppError ? e.key : `other:${String(e)}`;
	}
	return "ok";
};

describe("ABI text parsing", () => {
	it("parses a JSON ABI and keeps only functions and the constructor", () => {
		const abi = parseAbiText(
			JSON.stringify([
				{ type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
				{ type: "function", name: "balanceOf", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
				{ type: "event", name: "Transfer", inputs: [] },
				{ type: "constructor", inputs: [{ name: "supply", type: "uint256" }], stateMutability: "payable" },
			]),
		);
		expect(abi.functions.map((f) => f.name)).toEqual(["transfer", "balanceOf"]);
		expect(abi.functions.filter(isWritable).map((f) => f.name)).toEqual(["transfer"]);
		expect(abi.ctor?.stateMutability).toBe("payable");
		expect(functionSignature(abi.functions[0])).toBe("transfer(address to, uint256 amount)");
		expect(functionSignature(abi.ctor as never)).toBe("constructor(uint256 supply)");
	});

	it("treats legacy `constant` as view", () => {
		const abi = parseAbiText(JSON.stringify([{ type: "function", name: "x", inputs: [], constant: true }]));
		expect(isWritable(abi.functions[0])).toBe(false);
	});

	it("parses Foundry and Hardhat artifacts", () => {
		const foundry = parseAbiText(JSON.stringify({ abi: [{ type: "constructor", inputs: [] }], bytecode: { object: "0x6080AA" } }));
		expect(foundry.bytecode).toBe("0x6080aa");
		expect(foundry.ctor).toBeDefined();
		const hardhat = parseAbiText(JSON.stringify({ abi: [], bytecode: "0x6001" }));
		expect(hardhat.bytecode).toBe("0x6001");
		// Unlinked library placeholders are not valid hex.
		expect(parseAbiText(JSON.stringify({ abi: [], bytecode: "0x60__$abc$__" })).bytecode).toBeUndefined();
		expect(key(() => parseAbiText(JSON.stringify({ bytecode: "0x60__$abc$__" })))).toBe("advanced.err.abi");
	});

	it("parses human-readable signatures", () => {
		const abi = parseAbiText("transfer(address,uint256)\nfunction mint(address to, uint256 amount) payable\n// comment\nfunction name() view returns (string)");
		expect(abi.functions.map((f) => f.name)).toEqual(["transfer", "mint", "name"]);
		expect(abi.functions[1].stateMutability).toBe("payable");
		expect(abi.functions.filter(isWritable)).toHaveLength(2);
	});

	it("distinguishes overloads", () => {
		const abi = parseAbiText("foo(uint256)\nfoo(address)");
		expect(new Set(abi.functions.map(functionKey)).size).toBe(2);
	});

	it("rejects garbage", () => {
		expect(key(() => parseAbiText("[{]"))).toBe("advanced.err.abiJson");
		expect(key(() => parseAbiText("this is not an abi"))).toBe("advanced.err.abiSignature");
		expect(key(() => parseAbiText('{"foo":1}'))).toBe("advanced.err.abi");
		expect(key(() => parseAbiText(JSON.stringify([{ type: "function", name: "x", inputs: [{ type: "uint256); drop" }] }])))).toBe("advanced.err.abi");
		expect(parseAbiText("").functions).toEqual([]);
		expect(parseAbiText(JSON.stringify([{ type: "function", name: "<script>", inputs: [] }])).functions).toEqual([]);
	});

	it("round-trips a selected fragment", () => {
		const fn = parseAbiText("swap((address token, uint256 amount)[] legs, bytes32 id)").functions[0];
		expect(parseFragment(JSON.stringify(fn))).toEqual(fn);
		expect(parseFragment("")).toBeUndefined();
		expect(parseFragment("{bad")).toBeUndefined();
	});
});

describe("argument coercion", () => {
	const p = (type: string, components?: unknown[]) => ({ type, name: "x", components }) as never;

	it("classifies types", () => {
		expect(argKind(p("address"))).toBe("address");
		expect(argKind(p("bool"))).toBe("bool");
		expect(argKind(p("uint8"))).toBe("uint");
		expect(argKind(p("int256"))).toBe("int");
		expect(argKind(p("bytes"))).toBe("bytes");
		expect(argKind(p("bytes32"))).toBe("bytes");
		expect(argKind(p("string"))).toBe("string");
		expect(argKind(p("uint256[]"))).toBe("json");
		expect(argKind(p("tuple", []))).toBe("json");
	});

	it("coerces integers with range checks", () => {
		expect(coerceArg(p("uint256"), " 1000000000000000000000 ")).toBe(10n ** 21n);
		expect(coerceArg(p("uint256"), "0x10")).toBe(16n);
		expect(coerceArg(p("uint8"), "255")).toBe(255n);
		expect(coerceArg(p("int8"), "-128")).toBe(-128n);
		expect(key(() => coerceArg(p("uint8"), "256"))).toBe("advanced.err.range");
		expect(key(() => coerceArg(p("int8"), "128"))).toBe("advanced.err.range");
		expect(key(() => coerceArg(p("uint256"), "-1"))).toBe("advanced.err.negative");
		expect(key(() => coerceArg(p("uint256"), "1.5"))).toBe("advanced.err.integer");
		expect(key(() => coerceArg(p("uint256"), "1e18"))).toBe("advanced.err.integer");
		expect(key(() => coerceArg(p("uint256"), ""))).toBe("error.required");
	});

	it("coerces addresses and rejects bad checksums", () => {
		expect(coerceArg(p("address"), ADDR.toLowerCase())).toBe(ADDR);
		expect(coerceArg(p("address"), ADDR)).toBe(ADDR);
		expect(key(() => coerceArg(p("address"), ADDR.replace("A0b", "a0B")))).toBe("advanced.err.checksum");
		expect(key(() => coerceArg(p("address"), "0x123"))).toBe("error.invalidAddress");
	});

	it("coerces bool, string and bytes", () => {
		expect(coerceArg(p("bool"), "true")).toBe(true);
		expect(key(() => coerceArg(p("bool"), "yes"))).toBe("advanced.err.bool");
		expect(coerceArg(p("string"), "")).toBe("");
		expect(coerceArg(p("string"), " hi ")).toBe(" hi ");
		expect(coerceArg(p("bytes"), "0xAB cd")).toBe("0xabcd");
		expect(coerceArg(p("bytes4"), "a9059cbb")).toBe("0xa9059cbb");
		expect(key(() => coerceArg(p("bytes4"), "0xa9059c"))).toBe("advanced.err.bytesLength");
		expect(key(() => coerceArg(p("bytes"), "0xabc"))).toBe("advanced.err.hex");
		expect(key(() => coerceArg(p("bytes"), "zz"))).toBe("advanced.err.hex");
	});

	it("coerces arrays and nested tuples from JSON", () => {
		const leg = p("tuple[]", [{ type: "address", name: "token" }, { type: "uint256", name: "amount" }, { type: "bool[2]", name: "flags" }]);
		const value = coerceArg(leg, JSON.stringify([{ token: ADDR, amount: "5", flags: [true, false] }, [ADDR.toLowerCase(), 7, [false, false]]]));
		expect(value).toEqual([
			[ADDR, 5n, [true, false]],
			[ADDR, 7n, [false, false]],
		]);
		expect(key(() => coerceArg(leg, "{}"))).toBe("advanced.err.expectedArray");
		expect(key(() => coerceArg(leg, "[{\"token\":\"" + ADDR + "\"}]"))).toBe("advanced.err.tupleField");
		expect(key(() => coerceArg(leg, "[[1]]"))).toBe("advanced.err.tupleLength");
		expect(key(() => coerceArg(leg, "[oops"))).toBe("advanced.err.json");
		expect(key(() => coerceArg(p("uint256[2]"), "[1]"))).toBe("advanced.err.arrayLength");
		expect(key(() => coerceArg(p("uint256[]"), "[1.5]"))).toBe("advanced.err.integer");
		expect(key(() => coerceArg(p("uint256[]"), "[9007199254740993]"))).toBe("advanced.err.integer");
		expect(JSON.parse(argPlaceholder(leg))).toEqual([{ token: "0x…", amount: "0", flags: [true] }]);
	});

	it("encodes exactly like viem", () => {
		const fn = parseAbiText("exec((address token, uint256 amount)[] legs, bytes32 id, string memo, int24 tick)").functions[0];
		const id = `0x${"ab".repeat(32)}` as Hex;
		const mine = encodeCall(fn, [JSON.stringify([{ token: ADDR, amount: "12" }]), id, "hi", "-5"]);
		const ref = encodeFunctionData({
			abi: parseAbi(["function exec((address token, uint256 amount)[] legs, bytes32 id, string memo, int24 tick)"]),
			functionName: "exec",
			args: [[{ token: ADDR, amount: 12n }], id, "hi", -5],
		});
		expect(mine).toBe(ref);
	});
});

describe("safe.call parameters", () => {
	const fn = parseAbiText("transfer(address to, uint256 amount)").functions[0];
	const base: CallParams = { to: ADDR, value: "", mode: "abi", abiText: "", fragment: JSON.stringify(fn), args: [SAFE, "1000000"], data: "" };

	it("rebuilds calldata deterministically from fragment and arguments", () => {
		const data = callData(base);
		expect(data).toBe(encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256)"]), functionName: "transfer", args: [SAFE, 1_000_000n] }));
		expect(callData({ ...base, data })).toBe(data);
		// Tampered arguments produce different calldata than the stored one.
		expect(callData({ ...base, args: [SAFE, "2000000"], data })).not.toBe(data);
	});

	it("raw mode normalises hex", () => {
		expect(callData({ ...base, mode: "raw", data: " 0xA9059CBB " })).toBe("0xa9059cbb");
		expect(callData({ ...base, mode: "raw", data: "" })).toBe("0x");
		expect(key(() => callData({ ...base, mode: "raw", data: "0xabc" }))).toBe("advanced.err.hex");
		expect(key(() => callData({ ...base, fragment: "" }))).toBe("advanced.err.noFunction");
	});
});

describe("safe.deploy parameters", () => {
	const bytecode = "0x600a600c600039600a6000f3602a60005260206000f3";
	const ctor = parseAbiText(JSON.stringify([{ type: "constructor", inputs: [{ name: "owner", type: "address" }, { name: "cap", type: "uint256" }] }])).ctor;
	const base: DeployParams = { bytecodeText: bytecode, bytecode, ctor: "", args: [], rawArgs: "", value: "", method: "create", salt: "" };

	it("appends constructor arguments", () => {
		expect(deployInitCode(base)).toBe(bytecode);
		const args = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ADDR, 5n]);
		expect(deployInitCode({ ...base, rawArgs: args })).toBe(`${bytecode}${args.slice(2)}`);
		const withCtor = { ...base, ctor: JSON.stringify(ctor), args: [ADDR, "5"] };
		expect(parseCtorFragment(withCtor.ctor)).toEqual(ctor);
		expect(encodeCtorArgs(ctor as never, withCtor.args)).toBe(args);
		expect(deployInitCode(withCtor)).toBe(`${bytecode}${args.slice(2)}`);
		expect(key(() => deployInitCode({ ...base, bytecode: "" }))).toBe("advanced.err.bytecode");
	});

	it("derives the CREATE2 salt and address like viem", () => {
		const hexSalt = `0x${"01".repeat(32)}` as Hex;
		expect(deploySalt(hexSalt)).toBe(hexSalt);
		expect(deploySalt("my salt")).toBe(keccak256(stringToHex("my salt")));
		expect(deploySalt("  ")).toBeUndefined();
		expect(deployAddress(base, SAFE)).toBeUndefined();
		const p = { ...base, method: "create2" as const, salt: "my salt" };
		expect(deployAddress(p, SAFE)).toBe(
			getContractAddress({ opcode: "CREATE2", from: SAFE, salt: keccak256(stringToHex("my salt")), bytecode }),
		);
	});

	it("builds one delegatecall to CreateCall", () => {
		const [create] = buildDeploy({ ...base, value: "0.5" });
		expect(create).toEqual({
			to: SAFE_LIBS.createCall,
			value: 0n,
			operation: 1,
			data: encodeFunctionData({ abi: CREATE_CALL_ABI, functionName: "performCreate", args: [5n * 10n ** 17n, bytecode] }),
		});
		const [create2] = buildDeploy({ ...base, method: "create2", salt: "s" });
		expect(create2.data).toBe(
			encodeFunctionData({ abi: CREATE_CALL_ABI, functionName: "performCreate2", args: [0n, bytecode, keccak256(stringToHex("s"))] }),
		);
		expect(toSafeTx([create], 3).operation).toBe(1);
		expect(key(() => buildDeploy({ ...base, method: "create2", salt: "" }))).toBe("advanced.err.salt");
	});
});

describe("safe.signMessage", () => {
	const digest = keccak256(stringToHex("MultiSigVault release v1\nabc"));

	it("matches the calldata `npm run release:info` asks the developer Safe to execute", () => {
		expect(signMessageCalldata(digest)).toBe(releaseCalldata(digest));
		expect(signMessageCalldata(digest).slice(0, 10)).toBe("0x85a5affe");
		expect(SAFE_141.signMessageLib).toBe("0xd53cd0aB83D845Ac265BE939c57F53AD838012c9");
	});

	it("computes the Safe message hash (EIP-712 SafeMessage)", () => {
		const SAFE_MSG_TYPEHASH = keccak256(stringToHex("SafeMessage(bytes message)"));
		const domainSeparator = keccak256(
			encodeAbiParameters(
				[{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
				[keccak256(stringToHex("EIP712Domain(uint256 chainId,address verifyingContract)")), 8453n, SAFE],
			),
		);
		const structHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [SAFE_MSG_TYPEHASH, keccak256(digest)]));
		expect(safeMessageHash(8453, SAFE, digest)).toBe(keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}`));
	});

	it("validates bytes32", () => {
		expect(isBytes32(digest)).toBe(true);
		expect(isBytes32("0x1234")).toBe(false);
		expect(isBytes32(digest.slice(2))).toBe(false);
	});

	it("is a stable Safe transaction", () => {
		const tx = toSafeTx([{ to: SAFE_141.signMessageLib, value: 0n, data: signMessageCalldata(digest), operation: 1 }], 0);
		expect(computeSafeTxHash(8453, SAFE, tx)).toBe(computeSafeTxHash(8453, SAFE, { ...tx }));
		expect(normalizeHex(tx.data)).toBe(tx.data);
	});
});
