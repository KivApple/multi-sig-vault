import { getAddress, isAddress, type Address } from "viem";
import { findChain, HL_BRIDGE, HL_BRIDGE_CHAIN } from "@/config/chains";
import { MULTICALL3 } from "@/config/constants";
import type { TFunc } from "@/i18n";
import { AppError } from "@/lib/errors";
import { checksumHolds } from "@/lib/format";
import { SAFE_141 } from "@/lib/safe/deployments";

/**
 * The one check every operation runs on an address that is to receive funds. A well-formed address
 * is not enough: some addresses are places funds cannot come back from, or mean something else to
 * the contract that is given them.
 */
export interface RecipientRules {
	/** The sending account: sending to itself is a mistake. */
	self?: string;
	/** A Hyperliquid account is the recipient: the exchange's own system addresses are not accounts. */
	hyperliquid?: boolean;
	/**
	 * Contracts that are part of the machinery, not somebody to pay: the token being sent, and what
	 * `knownContracts` lists for the network the funds arrive on. Tokens paid to a token contract, a
	 * router or a bridge pool stay there.
	 */
	contracts?: readonly (string | undefined)[];
}

/**
 * Addresses nobody holds a key for: the ones used by convention to destroy tokens, and placeholders
 * that stand for "the native coin" or "no address" in other programs' interfaces.
 */
const BURN = new Set([
	"0x000000000000000000000000000000000000dead",
	"0xdead000000000000000000000000000000000000",
	"0xdead000000000000000042069420694206942069",
	`0x${"dead".repeat(10)}`,
	`0x${"e".repeat(40)}`,
	`0x${"f".repeat(40)}`,
	`0x${"fe".repeat(20)}`,
]);
/**
 * Hyperliquid's system addresses: `0x20…<token index>` bridges a spot token to HyperEVM, `0x2222…2222`
 * does the same for HYPE, `0x3333…3333` is CoreWriter. A transfer to one of them is not a transfer to a
 * user – the withdrawal to HyperEVM is its own operation, with its own checks.
 */
const isHlSystem = (lower: string): boolean => /^0x20{28}[0-9a-f]{11}$/.test(lower) || /^0x(2{40}|3{40})$/.test(lower);

/**
 * Translation key of what is wrong with `value` as a recipient; `undefined` when it can receive.
 *
 * - the zero address: tokens sent there are gone;
 * - `0x…0001` to `0x…ffff`: precompiles, and values some contracts read as an instruction (Uniswap's
 *   router takes 1 for "the caller" and 2 for "the router itself");
 * - well-known burn and placeholder addresses;
 * - an address in mixed case whose checksum (EIP-55) does not hold.
 */
export const recipientProblem = (value: string, rules: RecipientRules = {}): string | undefined => {
	const v = value.trim();
	if (!v) return "error.required";
	if (!isAddress(v, { strict: false })) return "error.invalidAddress";
	// Mixed case carries a checksum; a wrong one is a mistyped character, not another spelling.
	if (!checksumHolds(v)) return "address.checksum";
	const lower = v.toLowerCase();
	const n = BigInt(lower);
	if (n === 0n) return "address.zero";
	if (BURN.has(lower)) return "address.burn";
	if (n < 0x10000n) return "address.reserved";
	if (rules.hyperliquid && isHlSystem(lower)) return "address.hlSystem";
	if (rules.self && rules.self.toLowerCase() === lower) return "address.self";
	if (rules.contracts?.some((c) => c?.toLowerCase() === lower)) return "address.contract";
	return undefined;
};

/** The same, as the message shown under a field. */
export const recipientError = (value: string, t: TFunc, rules?: RecipientRules): string | undefined => {
	const key = recipientProblem(value, rules);
	return key ? t(key) : undefined;
};

/**
 * The recipient as a checksummed address, for the pure builders: they refuse to build a payload that
 * pays an address the forms would not have accepted, wherever the parameters came from.
 */
export const requireRecipient = (value: string, rules?: RecipientRules): Address => {
	const key = recipientProblem(value, rules);
	if (key) throw new AppError(key);
	return getAddress(value.trim());
};

/**
 * Every contract the app itself works with on a network: tokens it knows by role, the exchange, the
 * bridges (Hyperliquid's included), the Safe system contracts. None of them is a recipient.
 */
export const knownContracts = (chainId: number | undefined): Address[] => {
	const chain = findChain(chainId);
	if (!chain) return [];
	const list: (Address | undefined)[] = [
		chain.wrappedNative,
		chain.usdc,
		chain.quote?.address,
		chain.dex?.router,
		chain.dex?.quoter,
		chain.dex?.factory,
		chain.dex?.weth,
		chain.cctp?.tokenMessenger,
		chain.cctp?.messageTransmitter,
		chain.across?.spokePool,
		...Object.values(chain.across?.tokens ?? {}).map((t) => t.address),
		...Object.values(SAFE_141),
		MULTICALL3,
		// Hyperliquid's bridge lives on one network per environment.
		HL_BRIDGE_CHAIN[chain.env] === chain.id ? HL_BRIDGE[chain.env] : undefined,
	];
	return [...new Set(list.filter((a): a is Address => !!a))];
};
