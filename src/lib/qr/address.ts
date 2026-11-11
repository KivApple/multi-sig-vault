import { getAddress, isAddress, type Address } from "viem";
import { CHAINS } from "@/config/chains";

export interface AddressQr {
	address: Address;
	chainId?: number;
}

const SHORT_NAMES = new Map(CHAINS.map((c) => [c.shortName.toLowerCase(), c.id]));

const normalize = (raw: string): Address | null => {
	if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
	const body = raw.slice(2);
	const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
	// A mixed-case address carries a checksum – a wrong one means a damaged or mistyped address.
	if (mixed && !isAddress(raw, { strict: true })) return null;
	return getAddress(`0x${body.toLowerCase()}`);
};

const parseChainId = (raw: string | undefined): number | undefined => {
	if (!raw) return undefined;
	const id = Number(raw);
	return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

/**
 * Understands what wallets put into "receive" QR codes: a plain address,
 * EIP-681 (`ethereum:0x…@1`, MetaMask) and EIP-3770 (`eth:0x…`, Safe).
 */
export const parseAddressQr = (text: string): AddressQr | null => {
	const value = text.trim();

	const plain = normalize(value);
	if (plain) return { address: plain };

	const eip681 = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(0x[0-9a-fA-F]+|\d+))?(?:[/?].*)?$/i.exec(value);
	if (eip681) {
		const address = normalize(eip681[1]);
		if (!address) return null;
		const chainId = parseChainId(eip681[2]);
		return chainId === undefined ? { address } : { address, chainId };
	}

	const eip3770 = /^([a-z0-9-]+):(0x[0-9a-fA-F]{40})$/i.exec(value);
	if (eip3770) {
		const address = normalize(eip3770[2]);
		if (!address) return null;
		const chainId = SHORT_NAMES.get(eip3770[1].toLowerCase());
		return chainId === undefined ? { address } : { address, chainId };
	}

	return null;
};

export const addressQrValue = (address: Address, chainId?: number): string => {
	const checksummed = getAddress(address);
	return chainId === undefined ? checksummed : `ethereum:${checksummed}@${chainId}`;
};
