import { getAddress, type Address, type Hex } from "viem";
import { WalletError } from "@/lib/errors";
import { sameAddress } from "@/lib/format";
import { useAppStore } from "@/store/appStore";
import type { Signer } from "@/types/domain";
import { assembleSigned, broadcast, prepareTx, serializeUnsigned } from "./evmTx";
import { DEFAULT_PAGE, LEDGER_SCHEMES, resolveScheme, stripMasterPrefix } from "./paths";
import { joinSignature, toFullTypedData, typedDataHashes } from "./typedData";
import type { DiscoveredAccount, ListAccountsOptions, TxRequest, TypedDataPayload, WalletAdapter } from "./types";

/**
 * Ledger over WebHID (desktop Chrome) with WebUSB fallback (Chrome on Android has no WebHID).
 * Talks to the device directly, so it also works offline.
 *
 * Clear signing first: with the "clear signing" setting on (default) hw-app-eth may ask Ledger's
 * services for descriptors (tokens, contract plugins, EIP-712 field labels) so the device shows what
 * is being signed. If they are unreachable or the setting is off, typed data is still shown field by
 * field without labels. Blind signing (raw hashes / raw calldata) is only the last resort.
 */
interface LedgerTransport {
	close: () => Promise<void>;
	on: (event: string, cb: () => void) => void;
}

interface LedgerEth {
	getAddress: (path: string, display?: boolean) => Promise<{ address: string }>;
	signEIP712Message: (path: string, message: unknown) => Promise<{ v: number; r: string; s: string }>;
	signEIP712HashedMessage: (
		path: string,
		domainSeparatorHex: string,
		messageHashHex: string,
	) => Promise<{ v: number; r: string; s: string }>;
	signTransaction: (
		path: string,
		rawTxHex: string,
		resolution: unknown,
	) => Promise<{ v: string; r: string; s: string }>;
	clearSignTransaction: (
		path: string,
		rawTxHex: string,
		resolutionConfig: Record<string, boolean>,
		throwOnError?: boolean,
	) => Promise<{ v: string; r: string; s: string }>;
	setLoadConfig: (loadConfig: unknown) => void;
}

/** No remote services: nothing is fetched, descriptors are not used. */
const OFFLINE_LOAD_CONFIG = {
	nftExplorerBaseURL: null,
	pluginBaseURL: null,
	extraPlugins: null,
	cryptoassetsBaseURL: null,
	calServiceURL: null,
};

const EMPTY_RESOLUTION = { erc20Tokens: [], nfts: [], externalPlugin: [], plugin: [], domains: [] };
/** Everything hw-app-eth can resolve to show a transaction in clear on the device. */
const CLEAR_SIGN_CONFIG = { erc20: true, externalPlugins: true, nft: true, uniswapV3: true };

const lookupsAllowed = (): boolean => useAppStore.getState().settings.clearSigning && navigator.onLine;
const isFinal = (e: unknown): boolean => {
	const code = mapLedgerError(e).code;
	return (
		code === "rejected" || code === "locked" || code === "unavailable" || code === "busy" || code === "wrong-device"
	);
};

let transport: LedgerTransport | null = null;
let queue: Promise<unknown> = Promise.resolve();

const statusOf = (e: unknown): number | undefined => (e as { statusCode?: number }).statusCode;
const nameOf = (e: unknown): string => (e as { name?: string }).name ?? "";
const messageOf = (e: unknown): string => (e as { message?: string }).message ?? String(e);

export const mapLedgerError = (e: unknown): WalletError => {
	if (e instanceof WalletError) return e;
	const status = statusOf(e);
	const name = nameOf(e);
	const message = messageOf(e);
	switch (status) {
		case 0x6985:
			return new WalletError("rejected");
		case 0x6a80:
			return new WalletError("blind-signing");
		case 0x5515:
		case 0x6b0c:
			return new WalletError("locked");
		case 0x6d00:
		case 0x6e00:
		case 0x6e01:
		case 0x6511:
		case 0x6d02:
			return new WalletError("app-closed");
		default:
			break;
	}
	if (name === "TransportOpenUserCancelled" || /no device selected|must be handling a user gesture/i.test(message)) {
		return new WalletError("unavailable", message);
	}
	if (name === "LockedDeviceError") return new WalletError("locked");
	if (name === "TransportRaceCondition" || /already open|busy|in progress/i.test(message)) {
		return new WalletError("busy");
	}
	if (
		/^Disconnected|TransportInterfaceNotAvailable|NetworkError|NotFoundError/.test(name) ||
		/disconnected/i.test(message)
	) {
		return new WalletError("unavailable", message);
	}
	if (name === "EthAppPleaseEnableContractData") return new WalletError("blind-signing");
	return new WalletError("unknown", message);
};

const dropTransport = async (): Promise<void> => {
	const t = transport;
	transport = null;
	await t?.close().catch(() => undefined);
};

const openTransport = async (): Promise<LedgerTransport> => {
	if (transport) return transport;
	let created: LedgerTransport;
	if (typeof navigator !== "undefined" && "hid" in navigator) {
		const { default: TransportWebHID } = await import("@ledgerhq/hw-transport-webhid");
		created = (await TransportWebHID.create()) as unknown as LedgerTransport;
	} else if (typeof navigator !== "undefined" && "usb" in navigator) {
		const { default: TransportWebUSB } = await import("@ledgerhq/hw-transport-webusb");
		created = (await TransportWebUSB.create()) as unknown as LedgerTransport;
	} else {
		throw new WalletError("unsupported");
	}
	created.on("disconnect", () => {
		if (transport === created) transport = null;
	});
	transport = created;
	return created;
};

const connect = async (): Promise<LedgerEth> => {
	const [{ default: Eth }, t] = await Promise.all([import("@ledgerhq/hw-app-eth"), openTransport()]);
	const EthCtor = Eth as unknown as new (transport: unknown, scrambleKey?: string, loadConfig?: unknown) => LedgerEth;
	// `{}` keeps hw-app-eth's default service URLs.
	return new EthCtor(t, undefined, lookupsAllowed() ? {} : OFFLINE_LOAD_CONFIG);
};

/**
 * Runs one device session. Calls are queued (the device handles one exchange at a time).
 * A stale transport (device re-plugged, app switched) is reopened once.
 */
const withLedger = <T>(fn: (eth: LedgerEth) => Promise<T>): Promise<T> => {
	const run = async (): Promise<T> => {
		for (let attempt = 0; ; attempt++) {
			try {
				return await fn(await connect());
			} catch (e) {
				const mapped = mapLedgerError(e);
				const stale = mapped.code === "unavailable" || mapped.code === "busy";
				if (stale) await dropTransport();
				if (!stale || attempt > 0 || nameOf(e) === "TransportOpenUserCancelled") throw mapped;
			}
		}
	};
	const next = queue.then(run, run);
	queue = next.catch(() => undefined);
	return next;
};

const requirePath = (signer: Signer): string => {
	if (!signer.path) throw new WalletError("unknown", "Signer has no derivation path");
	return stripMasterPrefix(signer.path);
};

const assertDevice = async (eth: LedgerEth, path: string, signer: Signer): Promise<void> => {
	const { address } = await eth.getAddress(path, false);
	if (!sameAddress(address, signer.address)) {
		throw new WalletError("wrong-device", undefined, { address: signer.address });
	}
};

export const ledgerAdapter: WalletAdapter = {
	kind: "ledger",
	schemes: LEDGER_SCHEMES,

	listAccounts: ({ scheme, offset = 0, count = DEFAULT_PAGE }: ListAccountsOptions): Promise<DiscoveredAccount[]> =>
		withLedger(async (eth) => {
			const derive = resolveScheme(LEDGER_SCHEMES, scheme).path;
			const out: DiscoveredAccount[] = [];
			for (let i = offset; i < offset + count; i++) {
				const path = derive(i);
				const { address } = await eth.getAddress(stripMasterPrefix(path), false);
				out.push({ address: getAddress(address) as Address, path });
			}
			return out;
		}),

	signTypedData: (signer: Signer, data: TypedDataPayload): Promise<Hex> =>
		withLedger(async (eth) => {
			const path = requirePath(signer);
			await assertDevice(eth, path, signer);
			const full = toFullTypedData(data);
			// 1) fields with descriptors from Ledger, 2) fields without descriptors, 3) hashes (blind).
			const attempts = lookupsAllowed() ? [{}, OFFLINE_LOAD_CONFIG] : [OFFLINE_LOAD_CONFIG];
			for (const loadConfig of attempts) {
				try {
					eth.setLoadConfig(loadConfig);
					const sig = await eth.signEIP712Message(path, full);
					return joinSignature(sig.r, sig.s, sig.v);
				} catch (e) {
					// Rejected / locked / unplugged are final; anything else means the lookup failed or the
					// app cannot display this structure – try the next, less descriptive way.
					if (isFinal(e)) throw e;
				}
			}
			// Last resort for devices that cannot parse EIP-712 at all (Nano S, old apps).
			const { domainSeparator, messageHash } = typedDataHashes(data);
			const sig = await eth.signEIP712HashedMessage(path, domainSeparator.slice(2), messageHash.slice(2));
			return joinSignature(sig.r, sig.s, sig.v);
		}),

	sendTransaction: async (signer: Signer, tx: TxRequest): Promise<Hex> => {
		const prepared = await prepareTx(signer.address, tx);
		const serialized = await withLedger(async (eth) => {
			const path = requirePath(signer);
			await assertDevice(eth, path, signer);
			const raw = serializeUnsigned(prepared).slice(2);
			let sig: { r: string; s: string } | undefined;
			if (lookupsAllowed()) {
				try {
					// Resolves token / plugin descriptors; falls back to blind signing by itself when none exist.
					sig = await eth.clearSignTransaction(path, raw, CLEAR_SIGN_CONFIG, false);
				} catch (e) {
					if (isFinal(e) || mapLedgerError(e).code === "blind-signing") throw e;
				}
			}
			sig ??= await eth.signTransaction(path, raw, EMPTY_RESOLUTION);
			return assembleSigned(prepared, signer.address, sig.r, sig.s);
		});
		return broadcast(tx.chainId, serialized);
	},
};
