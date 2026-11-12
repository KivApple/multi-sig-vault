/**
 * MetaMask adapter.
 *
 * Two transports, chosen automatically:
 *
 * 1. Injected provider – the Chrome extension on desktop (found through EIP-6963 by rdns, so
 *    another wallet that took over `window.ethereum` is never mistaken for MetaMask), or
 *    MetaMask's in-app browser on a phone. Requests are plain in-page calls; nothing special.
 *
 * 2. MetaMask mobile app via `@metamask/sdk` (loaded on demand) – used when nothing is injected,
 *    i.e. Chrome on Android. Every request deeplinks into the app and the answer comes back over
 *    the SDK's encrypted relay channel.
 *
 * The Android problem: while the user is in MetaMask, Chrome freezes our tab and its socket, so
 * the answer can be missed. The SDK reconnects on window focus and the relay keeps undelivered
 * messages; on top of that this adapter
 *   - nudges the SDK the moment the tab becomes visible again (Android does not always fire
 *     `focus`), and
 *   - measures waiting time only while the tab is visible: after the user comes back the answer
 *     gets `RESUME_GRACE_MS` to arrive, otherwise the request fails instead of hanging forever.
 * What happens next depends on the request:
 *   - typed-data signatures are deterministic, so the caller may simply ask again ('timeout');
 *   - a transaction is NOT repeated automatically – its fate is unknown, and the error tells the
 *     user to check MetaMask's activity first ('txUnknown').
 * One more Android rule: every request deeplinks into MetaMask, and Chrome lets a page open another
 * app only from a user gesture. A request that follows another one (connect -> switch chain -> sign)
 * has no gesture left, so its deeplink is dropped and MetaMask shows nothing. Hence after each
 * preparatory step that sent the user to the app the adapter stops with 'continue', and the next
 * tap starts the next step.
 * Signing needs no network on the injected path. The SDK relay needs a connection; offline on
 * Android the app should be opened inside MetaMask's browser instead.
 */
import { getAddress, numberToHex, type Address, type Hex } from "viem";
import { findChain } from "@/config/chains";
import { WalletError } from "@/lib/errors";
import { sameAddress } from "@/lib/format";
import type { Signer } from "@/types/domain";
import { relayAvailable, requestInMetaMaskBrowser } from "@/lib/handoff/client";
import { toWireTx } from "@/lib/handoff/protocol";
import { toFullTypedData } from "./typedData";
import type { DiscoveredAccount, ListAccountsOptions, TxRequest, TypedDataPayload, WalletAdapter } from "./types";

export interface Eip1193Provider {
	request: (args: { method: string; params?: unknown }) => Promise<unknown>;
	isMetaMask?: boolean;
	providers?: Eip1193Provider[];
	[flag: string]: unknown;
}

interface Session {
	provider: Eip1193Provider;
	/** Requests travel to the mobile app (SDK) – apply the background-freeze guard. */
	remote: boolean;
	connect?: () => Promise<unknown>;
}

interface Eip6963Detail {
	info: { rdns: string };
	provider: Eip1193Provider;
}

const METAMASK_RDNS = ["io.metamask", "io.metamask.flask", "io.metamask.mobile"];
/** Flags set by wallets that pose as MetaMask on `window.ethereum`. */
const IMPOSTOR_FLAGS = [
	"isBraveWallet",
	"isRabby",
	"isCoinbaseWallet",
	"isTrust",
	"isTrustWallet",
	"isPhantom",
	"isOkxWallet",
	"isOKExWallet",
	"isTokenPocket",
	"isBitKeep",
	"isExodus",
	"isZerion",
	"isFrame",
];
const DISCOVERY_WAIT_MS = 250;
/** Time the answer may take after the user returns to the tab. */
const RESUME_GRACE_MS = 15_000;
/** Visible-time budget when the user never left the tab (deeplink did not open, QR pairing). */
const VISIBLE_BUDGET_MS = 60_000;

/** The outcome of a transaction request is unknown – it must not be blindly repeated. */
export class TxOutcomeUnknownError extends WalletError {
	constructor() {
		super("timeout");
		Object.defineProperty(this, "key", { value: "walletError.txUnknown" });
		this.name = "TxOutcomeUnknownError";
	}
}

const isGenuine = (p: Eip1193Provider | undefined): p is Eip1193Provider =>
	!!p && p.isMetaMask === true && !IMPOSTOR_FLAGS.some((flag) => p[flag]);

/** Picks MetaMask among legacy `window.ethereum` providers. */
export const pickInjected = (ethereum: Eip1193Provider | undefined): Eip1193Provider | undefined => {
	if (!ethereum) return undefined;
	if (Array.isArray(ethereum.providers)) return ethereum.providers.find(isGenuine);
	return isGenuine(ethereum) ? ethereum : undefined;
};

const announced = new Map<string, Eip1193Provider>();
let discovery: Promise<void> | undefined;

const discover = (): Promise<void> => {
	discovery ??= new Promise<void>((resolve) => {
		window.addEventListener("eip6963:announceProvider", (event) => {
			const detail = (event as CustomEvent<Eip6963Detail>).detail;
			if (detail?.info?.rdns && detail.provider) announced.set(detail.info.rdns, detail.provider);
		});
		window.dispatchEvent(new Event("eip6963:requestProvider"));
		setTimeout(resolve, DISCOVERY_WAIT_MS);
	});
	return discovery;
};

const findInjected = async (): Promise<Eip1193Provider | undefined> => {
	await discover();
	for (const rdns of METAMASK_RDNS) {
		const provider = announced.get(rdns);
		if (provider) return provider;
	}
	return pickInjected((window as unknown as { ethereum?: Eip1193Provider }).ethereum);
};

let sdkSession: Promise<Session> | undefined;
let appSession = false;

const loadSdkSession = (): Promise<Session> => {
	sdkSession ??= (async (): Promise<Session> => {
		const { MetaMaskSDK } = await import("@metamask/sdk");
		const sdk = new MetaMaskSDK({
			dappMetadata: { name: "Multi Sig Vault", url: window.location.origin },
			enableAnalytics: false,
			checkInstallationImmediately: false,
			injectProvider: false,
			shouldShimWeb3: false,
			extensionOnly: false,
			logging: { developerMode: false },
		});
		await sdk.init();
		const provider = sdk.getProvider() as unknown as Eip1193Provider | undefined;
		if (!provider) throw new WalletError("unavailable");
		appSession = !sdk.isExtensionActive();
		return { provider, remote: appSession, connect: () => sdk.connect() };
	})().catch((e: unknown) => {
		sdkSession = undefined;
		throw e instanceof WalletError ? e : new WalletError("unavailable", (e as Error).message);
	});
	return sdkSession;
};

const getSession = async (): Promise<Session> => {
	const injected = await findInjected();
	if (injected) return { provider: injected, remote: false };
	return loadSdkSession();
};

interface RpcError {
	code?: number;
	message?: string;
	data?: { originalError?: { code?: number } };
}

export const mapMetaMaskError = (e: unknown, vars?: Record<string, string | number>): WalletError => {
	if (e instanceof WalletError) return e;
	const err = (e ?? {}) as RpcError;
	const code = err.code ?? err.data?.originalError?.code;
	const message = err.message ?? String(e);
	if (code === 4001 || /user (rejected|denied|cancell?ed)/i.test(message)) return new WalletError("rejected");
	if (code === -32002 || /already (pending|processing)/i.test(message)) return new WalletError("busy");
	if (code === 4100) return new WalletError("wrong-account", message, vars);
	if (code === 4900 || code === 4901 || /disconnected|not connected|terminated/i.test(message)) {
		return new WalletError("unavailable", message);
	}
	if (code === 4200 || /not supported|does not exist/i.test(message)) return new WalletError("unsupported", message);
	return new WalletError("unknown", message);
};

const isUnknownChain = (e: unknown): boolean => {
	const err = (e ?? {}) as RpcError;
	return (
		err.code === 4902 ||
		err.data?.originalError?.code === 4902 ||
		/unrecognized chain|chain .*not (been )?added|unknown chain/i.test(err.message ?? "")
	);
};

/**
 * Waits for a request sent to the mobile app without hanging when the tab was frozen.
 * The clock only runs while the tab is visible.
 */
export const guardRemote = <T>(run: () => Promise<T>, onExpire: () => WalletError): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const arm = (ms: number): void => {
			if (timer !== undefined) clearTimeout(timer);
			timer = setTimeout(() => finish(() => reject(onExpire())), ms);
		};
		const onVisibility = (): void => {
			if (document.visibilityState === "visible") {
				// Android does not reliably fire `focus`; the SDK reconnects its socket on it.
				window.dispatchEvent(new Event("focus"));
				arm(RESUME_GRACE_MS);
			} else if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
		};
		const finish = (settle: () => void): void => {
			if (timer !== undefined) clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisibility);
			settle();
		};
		document.addEventListener("visibilitychange", onVisibility);
		if (document.visibilityState === "visible") arm(VISIBLE_BUDGET_MS);
		run().then(
			(value) => finish(() => resolve(value)),
			(error: unknown) => finish(() => reject(error)),
		);
	});

const request = async <T>(
	session: Session,
	method: string,
	params?: unknown,
	onExpire: () => WalletError = () => new WalletError("timeout"),
): Promise<T> => {
	const run = (): Promise<T> => session.provider.request({ method, params }) as Promise<T>;
	try {
		return await (session.remote ? guardRemote(run, onExpire) : run());
	} catch (e) {
		throw mapMetaMaskError(e);
	}
};

const readAccounts = async (session: Session): Promise<Address[]> => {
	const accounts = await request<string[] | undefined>(session, "eth_accounts");
	return (accounts ?? []).map((a) => getAddress(a));
};

const requestAccounts = async (session: Session, reselect: boolean): Promise<Address[]> => {
	if (reselect) {
		try {
			await request(session, "wallet_requestPermissions", [{ eth_accounts: {} }]);
			return await readAccounts(session);
		} catch (e) {
			// Older mobile builds lack the method – fall back to a plain connect.
			if (!(e instanceof WalletError) || e.code !== "unsupported") throw e;
		}
	}
	if (session.connect) {
		try {
			const connected = (await (session.remote
				? guardRemote(session.connect, () => new WalletError("timeout"))
				: session.connect())) as string[] | undefined;
			if (connected?.length) return connected.map((a) => getAddress(a));
		} catch (e) {
			throw mapMetaMaskError(e);
		}
		return readAccounts(session);
	}
	const accounts = await request<string[] | undefined>(session, "eth_requestAccounts");
	return (accounts ?? []).map((a) => getAddress(a));
};

/** The mobile app was opened for a preparatory step: the next request needs a new user gesture. */
const stepDone = (session: Session): void => {
	if (session.remote) throw new WalletError("continue");
};

/** Makes sure the app may use `address`; asks for access again when it was revoked. */
const ensureAccount = async (session: Session, address: Address): Promise<void> => {
	const has = (list: Address[]): boolean => list.some((a) => sameAddress(a, address));
	let accounts = await readAccounts(session).catch(() => [] as Address[]);
	if (has(accounts)) return;
	accounts = await requestAccounts(session, accounts.length > 0);
	if (!has(accounts)) throw new WalletError("wrong-account", undefined, { address });
	stepDone(session);
};

const switchOrAdd = async (session: Session, chainId: number): Promise<void> => {
	const hexId = numberToHex(chainId);
	try {
		await session.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
	} catch (e) {
		if (!isUnknownChain(e)) {
			const mapped = mapMetaMaskError(e);
			throw mapped.code === "unknown" ? new WalletError("chain", mapped.message, { chainId }) : mapped;
		}
		const chain = findChain(chainId);
		if (!chain) throw new WalletError("chain", undefined, { chainId });
		await request(session, "wallet_addEthereumChain", [
			{
				chainId: hexId,
				chainName: chain.name,
				nativeCurrency: { name: chain.nativeName, symbol: chain.nativeSymbol, decimals: 18 },
				rpcUrls: chain.rpcUrls,
				blockExplorerUrls: [chain.explorer],
			},
		]);
	}
};

/**
 * Chain the mobile app was last switched to from this page, and when. The SDK answers `eth_chainId`
 * from a cache that goes stale while the tab is frozen behind MetaMask, so on the app path the
 * cache is never trusted: the adapter switches explicitly and remembers that it did.
 */
let appChain: { id: number; at: number } | undefined;
/** A chain MetaMask did not know: the next tap adds it (adding needs its own gesture too). */
let appChainToAdd: number | undefined;
/** A transaction is only sent right after a switch; a signature is checked by MetaMask itself. */
const TX_SWITCH_FRESH_MS = 120_000;

const ensureAppChain = async (session: Session, chainId: number, forTx: boolean): Promise<void> => {
	if (appChain?.id === chainId && (!forTx || Date.now() - appChain.at < TX_SWITCH_FRESH_MS)) return;
	const hexId = numberToHex(chainId);
	const chain = findChain(chainId);
	if (appChainToAdd === chainId && chain) {
		appChainToAdd = undefined;
		await request(session, "wallet_addEthereumChain", [
			{
				chainId: hexId,
				chainName: chain.name,
				nativeCurrency: { name: chain.nativeName, symbol: chain.nativeSymbol, decimals: 18 },
				rpcUrls: chain.rpcUrls,
				blockExplorerUrls: [chain.explorer],
			},
		]);
	} else {
		try {
			await guardRemote(
				() => session.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] }),
				() => new WalletError("timeout"),
			);
		} catch (e) {
			if (isUnknownChain(e) && chain) {
				appChainToAdd = chainId;
				throw new WalletError("continue");
			}
			const mapped = mapMetaMaskError(e);
			throw mapped.code === "unknown" ? new WalletError("chain", mapped.message, { chainId }) : mapped;
		}
	}
	appChain = { id: chainId, at: Date.now() };
	throw new WalletError("continue");
};

/** MetaMask only signs typed data / sends transactions for its active chain. */
const ensureChain = async (session: Session, chainId: number, forTx = false): Promise<void> => {
	if (session.remote) return ensureAppChain(session, chainId, forTx);
	const current = await request<string>(session, "eth_chainId");
	if (Number(current) === chainId) return;
	await switchOrAdd(session, chainId);
	const after = await request<string>(session, "eth_chainId");
	if (Number(after) !== chainId) {
		// Adding a chain does not always switch to it.
		try {
			await request(session, "wallet_switchEthereumChain", [{ chainId: numberToHex(chainId) }]);
		} catch (e) {
			throw e instanceof WalletError && e.code === "rejected" ? e : new WalletError("chain", undefined, { chainId });
		}
	}
};

/** MetaMask refused because it is on another chain than this page believed: switch on the next tap. */
const chainMoved = (session: Session, e: unknown): unknown => {
	if (!session.remote || !/chain ?id/i.test(e instanceof Error ? e.message : "")) return e;
	appChain = undefined;
	return new WalletError("continue");
};

/** Requests go (or are about to go) to the MetaMask mobile app: nothing is injected on a phone. */
export const metamaskUsesApp = (): boolean =>
	appSession ||
	(/Android|iPhone|iPad/i.test(navigator.userAgent) && !(window as unknown as { ethereum?: unknown }).ethereum);

/**
 * MetaMask Mobile answers "must provide an Ethereum address" when the sender is not an account it
 * currently lets this site use – also when `eth_accounts` has just listed it. Ask the user to pick the
 * accounts again and repeat the request once; if that does not help, say which account is needed.
 */
const withAccountAccess = async <T>(session: Session, address: Address, run: () => Promise<T>): Promise<T> => {
	const refused = (e: unknown): boolean =>
		/must provide an? (permitted )?Ethereum address/i.test((e as Error)?.message ?? "");
	try {
		return await run();
	} catch (e) {
		if (!refused(e)) throw e;
	}
	await requestAccounts(session, true).catch(() => undefined);
	try {
		return await run();
	} catch (e) {
		throw refused(e) ? new WalletError("wrong-account", undefined, { address }) : e;
	}
};

/** Talks to MetaMask from this page: the extension, the in-app browser, or the SDK relay as a last resort. */
export const metamaskDirect: WalletAdapter = {
	kind: "metamask",
	schemes: [],

	listAccounts: async ({ reselect = false }: ListAccountsOptions): Promise<DiscoveredAccount[]> => {
		const session = await getSession();
		const accounts = await requestAccounts(session, reselect);
		// MetaMask exposes no account names to dapps.
		return accounts.map((address) => ({ address }));
	},

	signTypedData: async (signer: Signer, data: TypedDataPayload): Promise<Hex> => {
		const session = await getSession();
		await ensureAccount(session, signer.address);
		if (data.domain.chainId !== undefined) await ensureChain(session, data.domain.chainId);
		try {
			return await withAccountAccess(session, signer.address, () =>
				request<Hex>(session, "eth_signTypedData_v4", [signer.address, JSON.stringify(toFullTypedData(data))]),
			);
		} catch (e) {
			throw chainMoved(session, e);
		}
	},

	sendTransaction: async (signer: Signer, tx: TxRequest): Promise<Hex> => {
		const session = await getSession();
		await ensureAccount(session, signer.address);
		await ensureChain(session, tx.chainId, true);
		try {
			return await withAccountAccess(session, signer.address, () =>
				request<Hex>(
					session,
					"eth_sendTransaction",
					[
						{
							from: signer.address,
							to: tx.to,
							data: tx.data,
							value: numberToHex(tx.value ?? 0n),
							// MetaMask rejects a transaction whose chain is not its active one.
							chainId: numberToHex(tx.chainId),
							...(tx.gas !== undefined ? { gas: numberToHex(tx.gas) } : {}),
						},
					],
					() => new TxOutcomeUnknownError(),
				),
			);
		} catch (e) {
			throw chainMoved(session, e);
		}
	},
};

export const hasInjectedMetaMask = async (): Promise<boolean> => !!(await findInjected());

/**
 * On a phone outside MetaMask's browser, requests are handed to the app's signing page inside that
 * browser through the encrypted relay (src/lib/handoff): the SDK's own channel loses answers when
 * Android freezes the tab. Without a relay (a self-hosted copy) the SDK is still used.
 */
const viaBrowserHandoff = async (): Promise<boolean> =>
	/Android|iPhone|iPad/i.test(navigator.userAgent) && !(await findInjected()) && (await relayAvailable());

export const metamaskAdapter: WalletAdapter = {
	kind: "metamask",
	schemes: [],

	listAccounts: async (opts: ListAccountsOptions): Promise<DiscoveredAccount[]> => {
		if (!(await viaBrowserHandoff())) return metamaskDirect.listAccounts(opts);
		const accounts = (await requestInMetaMaskBrowser({ v: 1, method: "accounts" })) as Address[];
		return accounts.map((address) => ({ address }));
	},

	signTypedData: async (signer: Signer, data: TypedDataPayload): Promise<Hex> => {
		if (!(await viaBrowserHandoff())) return metamaskDirect.signTypedData(signer, data);
		return (await requestInMetaMaskBrowser({ v: 1, method: "signTypedData", address: signer.address, data })) as Hex;
	},

	sendTransaction: async (signer: Signer, tx: TxRequest): Promise<Hex> => {
		if (!(await viaBrowserHandoff())) return metamaskDirect.sendTransaction(signer, tx);
		return (await requestInMetaMaskBrowser(
			{ v: 1, method: "sendTransaction", address: signer.address, tx: toWireTx(tx) },
			() => new TxOutcomeUnknownError(),
		)) as Hex;
	},
};
