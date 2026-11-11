import {
	encodeAbiParameters,
	encodeFunctionData,
	getAddress,
	isAddress,
	isHex,
	parseAbi,
	size,
	toFunctionSelector,
	type AbiFunction,
	type AbiParameter,
	type Hex,
} from "viem";
import { formatAbiItem, formatAbiParams } from "viem/utils";
import { AppError } from "@/lib/errors";

/** ABI helpers for the advanced Safe operations. Everything pasted or downloaded is untrusted input. */

const MAX_ABI_TEXT = 2_000_000;
const MAX_ITEMS = 2000;
const MAX_DEPTH = 8;
const TYPE_RE = /^(address|bool|string|function|bytes([1-9]|[12]\d|3[0-2])?|u?int(\d{1,3})?|tuple)((\[\d*\])*)$/;
const NAME_RE = /^[A-Za-z_$][\w$]*$/;

export interface AbiConstructor {
	type: "constructor";
	inputs: readonly AbiParameter[];
	stateMutability: "payable" | "nonpayable";
}

export interface ParsedAbi {
	functions: AbiFunction[];
	ctor?: AbiConstructor;
	/** Creation bytecode when the text was a compiler artifact. */
	bytecode?: Hex;
}

const cleanParam = (raw: unknown, depth: number): AbiParameter => {
	if (depth > MAX_DEPTH || typeof raw !== "object" || raw === null) throw new AppError("advanced.err.abi");
	const p = raw as { type?: unknown; name?: unknown; components?: unknown };
	if (typeof p.type !== "string" || p.type.length > 100 || !TYPE_RE.test(p.type)) throw new AppError("advanced.err.abi");
	const name = typeof p.name === "string" && NAME_RE.test(p.name) && p.name.length <= 64 ? p.name : undefined;
	if (p.type.startsWith("tuple")) {
		if (!Array.isArray(p.components) || p.components.length > 64) throw new AppError("advanced.err.abi");
		return { type: p.type, name, components: p.components.map((c) => cleanParam(c, depth + 1)) } as AbiParameter;
	}
	return { type: p.type, name } as AbiParameter;
};

const cleanInputs = (raw: unknown): AbiParameter[] => {
	if (raw === undefined) return [];
	if (!Array.isArray(raw) || raw.length > 64) throw new AppError("advanced.err.abi");
	return raw.map((p) => cleanParam(p, 0));
};

const mutability = (item: { stateMutability?: unknown; constant?: unknown; payable?: unknown }): AbiFunction["stateMutability"] => {
	const m = item.stateMutability;
	if (m === "view" || m === "pure" || m === "payable" || m === "nonpayable") return m;
	if (item.constant === true) return "view";
	return item.payable === true ? "payable" : "nonpayable";
};

/** Keeps only well-formed functions and the constructor, rebuilt field by field. */
export const sanitizeAbi = (raw: unknown): ParsedAbi => {
	if (!Array.isArray(raw) || raw.length > MAX_ITEMS) throw new AppError("advanced.err.abi");
	const out: ParsedAbi = { functions: [] };
	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const it = item as { type?: unknown; name?: unknown; inputs?: unknown; stateMutability?: unknown; constant?: unknown; payable?: unknown };
		if (it.type === "constructor") {
			out.ctor = {
				type: "constructor",
				inputs: cleanInputs(it.inputs),
				stateMutability: mutability(it) === "payable" ? "payable" : "nonpayable",
			};
		} else if (it.type === "function" || it.type === undefined) {
			if (typeof it.name !== "string" || !NAME_RE.test(it.name) || it.name.length > 128) continue;
			out.functions.push({
				type: "function",
				name: it.name,
				inputs: cleanInputs(it.inputs),
				outputs: [],
				stateMutability: mutability(it),
			});
		}
	}
	return out;
};

const artifactBytecode = (obj: Record<string, unknown>): Hex | undefined => {
	const b = obj.bytecode;
	const hex = typeof b === "string" ? b : typeof (b as { object?: unknown })?.object === "string" ? (b as { object: string }).object : undefined;
	if (!hex) return undefined;
	return normalizeHex(hex);
};

/** `0x`-prefixed lowercase hex with an even number of digits, or `undefined`. */
export const normalizeHex = (text: string): Hex | undefined => {
	const compact = text.replace(/\s+/g, "");
	if (compact === "" || compact === "0x") return "0x";
	const hex = compact.startsWith("0x") || compact.startsWith("0X") ? `0x${compact.slice(2)}` : `0x${compact}`;
	return isHex(hex) && hex.length % 2 === 0 ? (hex.toLowerCase() as Hex) : undefined;
};

/**
 * Accepts a JSON ABI, a compiler artifact (`{ abi, bytecode }`) or human-readable signatures,
 * one per line (`transfer(address,uint256)` or full `function …` declarations).
 */
export const parseAbiText = (text: string): ParsedAbi => {
	const src = text.trim();
	if (!src) return { functions: [] };
	if (src.length > MAX_ABI_TEXT) throw new AppError("advanced.err.abiTooLarge");
	if (src.startsWith("[") || src.startsWith("{")) {
		let json: unknown;
		try {
			json = JSON.parse(src);
		} catch {
			throw new AppError("advanced.err.abiJson");
		}
		if (Array.isArray(json)) return sanitizeAbi(json);
		const obj = json as Record<string, unknown>;
		const bytecode = artifactBytecode(obj);
		const abi = Array.isArray(obj.abi) ? sanitizeAbi(obj.abi) : { functions: [] };
		if (!Array.isArray(obj.abi) && !bytecode) throw new AppError("advanced.err.abi");
		return { ...abi, bytecode };
	}
	const lines = src
		.split(/[\n;]+/)
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("//"))
		.map((l) => (/^(function|constructor|event|error|struct|fallback|receive)\b/.test(l) ? l : `function ${l}`));
	if (lines.length > MAX_ITEMS) throw new AppError("advanced.err.abiTooLarge");
	try {
		return sanitizeAbi(parseAbi(lines) as unknown[]);
	} catch (e) {
		if (e instanceof AppError) throw e;
		throw new AppError("advanced.err.abiSignature");
	}
};

export const isWritable = (fn: AbiFunction): boolean => fn.stateMutability !== "view" && fn.stateMutability !== "pure";

/** `transfer(address to, uint256 amount)` */
export const functionSignature = (fn: AbiFunction | AbiConstructor): string =>
	fn.type === "constructor"
		? `constructor(${formatAbiParams(fn.inputs, { includeName: true })})`
		: formatAbiItem(fn, { includeName: true });

export const functionSelector = (fn: AbiFunction): Hex => toFunctionSelector(fn);

/** Stable identity of a function inside an ABI (distinguishes overloads). */
export const functionKey = (fn: AbiFunction): string => formatAbiItem(fn);

export const parseFragment = (json: string): AbiFunction | undefined => {
	if (!json) return undefined;
	try {
		const { functions } = sanitizeAbi([JSON.parse(json)]);
		return functions[0];
	} catch {
		return undefined;
	}
};

export const parseCtorFragment = (json: string): AbiConstructor | undefined => {
	if (!json) return undefined;
	try {
		return sanitizeAbi([JSON.parse(json)]).ctor;
	} catch {
		return undefined;
	}
};

export type ArgKind = "address" | "bool" | "uint" | "int" | "bytes" | "string" | "json";

export const argKind = (param: AbiParameter): ArgKind => {
	const { type } = param;
	if (type.endsWith("]") || type === "tuple") return "json";
	if (type === "address") return "address";
	if (type === "bool") return "bool";
	if (type === "string") return "string";
	if (type.startsWith("uint")) return "uint";
	if (type.startsWith("int")) return "int";
	return "bytes";
};

const coerceInt = (type: string, raw: unknown): bigint => {
	const signed = type.startsWith("int");
	const bits = Number(type.replace(/^u?int/, "") || "256");
	const text = typeof raw === "number" ? (Number.isSafeInteger(raw) ? String(raw) : "") : typeof raw === "string" ? raw.trim().replace(/_/g, "") : "";
	if (!/^-?(\d+|0x[0-9a-fA-F]+)$/.test(text)) throw new AppError("advanced.err.integer");
	const negative = text.startsWith("-");
	const abs = BigInt(negative ? text.slice(1) : text);
	const value = negative ? -abs : abs;
	if (!signed && value < 0n) throw new AppError("advanced.err.negative");
	const max = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
	const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
	if (value > max || value < min) throw new AppError("advanced.err.range", { type });
	return value;
};

const coerceLeaf = (type: string, raw: unknown): unknown => {
	if (type === "address") {
		if (typeof raw !== "string" || !isAddress(raw.trim(), { strict: false })) throw new AppError("error.invalidAddress");
		const v = raw.trim();
		// Mixed-case input must carry a valid checksum – catches typos.
		if (v !== v.toLowerCase() && v.slice(2) !== v.slice(2).toUpperCase() && !isAddress(v)) throw new AppError("advanced.err.checksum");
		return getAddress(v.toLowerCase());
	}
	if (type === "bool") {
		if (raw === true || raw === "true") return true;
		if (raw === false || raw === "false") return false;
		throw new AppError("advanced.err.bool");
	}
	if (type === "string") {
		if (typeof raw !== "string") throw new AppError("advanced.err.string");
		return raw;
	}
	if (type.startsWith("uint") || type.startsWith("int")) return coerceInt(type, raw);
	if (type.startsWith("bytes")) {
		const hex = typeof raw === "string" ? normalizeHex(raw) : undefined;
		if (!hex) throw new AppError("advanced.err.hex");
		const fixed = type.slice(5);
		if (fixed && size(hex) !== Number(fixed)) throw new AppError("advanced.err.bytesLength", { n: fixed });
		return hex;
	}
	throw new AppError("advanced.err.unsupported", { type });
};

const coerceValue = (param: AbiParameter, raw: unknown, depth = 0): unknown => {
	if (depth > MAX_DEPTH) throw new AppError("advanced.err.abi");
	const arr = /^(.*)\[(\d*)\]$/.exec(param.type);
	if (arr) {
		if (!Array.isArray(raw)) throw new AppError("advanced.err.expectedArray");
		if (arr[2] && raw.length !== Number(arr[2])) throw new AppError("advanced.err.arrayLength", { n: arr[2] });
		const inner = { ...param, type: arr[1] } as AbiParameter;
		return raw.map((v) => coerceValue(inner, v, depth + 1));
	}
	if (param.type === "tuple") {
		const components = (param as { components?: AbiParameter[] }).components ?? [];
		if (Array.isArray(raw)) {
			if (raw.length !== components.length) throw new AppError("advanced.err.tupleLength", { n: components.length });
			return components.map((c, i) => coerceValue(c, raw[i], depth + 1));
		}
		if (typeof raw !== "object" || raw === null) throw new AppError("advanced.err.expectedTuple");
		const obj = raw as Record<string, unknown>;
		return components.map((c) => {
			if (!c.name || !(c.name in obj)) throw new AppError("advanced.err.tupleField", { name: c.name ?? "?" });
			return coerceValue(c, obj[c.name], depth + 1);
		});
	}
	return coerceLeaf(param.type, raw);
};

/** Converts the text the user typed for one argument into the value viem encodes. Throws `AppError`. */
export const coerceArg = (param: AbiParameter, text: string): unknown => {
	if (argKind(param) !== "json") {
		if (param.type !== "string" && text.trim() === "") throw new AppError("error.required");
		return coerceLeaf(param.type, param.type === "string" ? text : text.trim());
	}
	if (text.trim() === "") throw new AppError("error.required");
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new AppError("advanced.err.json");
	}
	return coerceValue(param, json);
};

export const coerceArgs = (inputs: readonly AbiParameter[], args: string[]): unknown[] =>
	inputs.map((p, i) => coerceArg(p, args[i] ?? ""));

export const encodeCall = (fn: AbiFunction, args: string[]): Hex =>
	encodeFunctionData({ abi: [fn], functionName: fn.name, args: coerceArgs(fn.inputs, args) });

export const encodeCtorArgs = (ctor: AbiConstructor, args: string[]): Hex =>
	ctor.inputs.length === 0 ? "0x" : encodeAbiParameters(ctor.inputs, coerceArgs(ctor.inputs, args));

const example = (param: AbiParameter, depth = 0): unknown => {
	const arr = /^(.*)\[(\d*)\]$/.exec(param.type);
	if (arr) return depth > 2 ? [] : [example({ ...param, type: arr[1] } as AbiParameter, depth + 1)];
	if (param.type === "tuple") {
		const components = (param as { components?: AbiParameter[] }).components ?? [];
		if (components.every((c) => c.name)) return Object.fromEntries(components.map((c) => [c.name, example(c, depth + 1)]));
		return components.map((c) => example(c, depth + 1));
	}
	if (param.type === "address") return "0x…";
	if (param.type === "bool") return true;
	if (param.type === "string") return "text";
	if (param.type.includes("int")) return "0";
	return "0x";
};

/** JSON showing the shape expected for an array/tuple argument. */
export const argPlaceholder = (param: AbiParameter): string => JSON.stringify(example(param));

export const argLabel = (param: AbiParameter, index: number): string => `${param.name || `arg${index}`} (${param.type})`;

/** Per-argument validation: index → translated-key error. */
export const argErrors = (inputs: readonly AbiParameter[], args: string[]): Record<number, AppError> => {
	const out: Record<number, AppError> = {};
	inputs.forEach((p, i) => {
		try {
			coerceArg(p, args[i] ?? "");
		} catch (e) {
			out[i] = e instanceof AppError ? e : new AppError("advanced.err.encode", { detail: e instanceof Error ? e.message.split("\n")[0] : "" });
		}
	});
	return out;
};

/** Fetches a verified contract's ABI from Sourcify. The response is validated like pasted text. */
export const fetchSourcifyAbi = async (chainId: number, address: string): Promise<string> => {
	let res: Response;
	try {
		res = await fetch(`https://sourcify.dev/server/v2/contract/${chainId}/${getAddress(address)}?fields=abi`, {
			referrerPolicy: "no-referrer",
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		throw new AppError("error.network");
	}
	if (res.status === 404) throw new AppError("advanced.err.notVerified");
	if (!res.ok) throw new AppError("advanced.err.sourcify", { status: res.status });
	const body = (await res.json().catch(() => undefined)) as { abi?: unknown } | undefined;
	if (!body || !Array.isArray(body.abi)) throw new AppError("advanced.err.notVerified");
	const { functions } = sanitizeAbi(body.abi);
	if (functions.length === 0) throw new AppError("advanced.err.notVerified");
	return JSON.stringify(functions);
};
