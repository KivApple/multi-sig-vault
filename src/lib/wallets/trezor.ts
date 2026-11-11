import { getAddress, type Address, type Hex } from "viem";
import { WalletError } from "@/lib/errors";
import { sameAddress } from "@/lib/format";
import type { Signer } from "@/types/domain";
import { assembleSigned, broadcast, prepareTx, toRpcHex } from "./evmTx";
import { DEFAULT_PAGE, resolveScheme, TREZOR_SCHEMES } from "./paths";
import { normalizeSignature, toFullTypedData, typedDataHashes } from "./typedData";
import type { DiscoveredAccount, ListAccountsOptions, TxRequest, TypedDataPayload, WalletAdapter } from "./types";

/**
 * Trezor through Trezor Connect: UI (PIN, passphrase, confirmation) lives in Trezor Suite
 * desktop when it is running (local WebSocket), otherwise in the Trezor popup served from
 * suite.trezor.io – that popup needs a network connection unless the browser has it cached.
 */
type TrezorResponse<T> = { success: true; payload: T } | { success: false; payload: { error: string; code?: string } };

interface TrezorApi {
	init: (settings: Record<string, unknown>) => Promise<void>;
	ethereumGetAddress: (params: {
		bundle: { path: string; showOnTrezor: boolean }[];
	}) => Promise<TrezorResponse<{ address: string; serializedPath: string }[]>>;
	ethereumSignTypedData: (
		params: Record<string, unknown>,
	) => Promise<TrezorResponse<{ address: string; signature: string }>>;
	ethereumSignTransaction: (params: {
		path: string;
		transaction: Record<string, unknown>;
	}) => Promise<TrezorResponse<{ v: string; r: string; s: string }>>;
}

const MANIFEST = { appName: "Multi Sig Vault", email: "support@multisigvault.app" };

let apiPromise: Promise<TrezorApi> | undefined;

const load = (): Promise<TrezorApi> => {
	apiPromise ??= (async () => {
		const mod = (await import("@trezor/connect-web")) as unknown as { default: TrezorApi | { default: TrezorApi } };
		const api = ("default" in mod.default ? mod.default.default : mod.default) as TrezorApi;
		try {
			await api.init({ manifest: { ...MANIFEST, appUrl: window.location.origin }, coreMode: "auto" });
		} catch (e) {
			// A second init (HMR, StrictMode) is harmless.
			if (!/already.*init/i.test((e as Error).message ?? "")) throw e;
		}
		return api;
	})().catch((e: unknown) => {
		apiPromise = undefined;
		throw new WalletError("unavailable", (e as Error).message);
	});
	return apiPromise;
};

export const mapTrezorError = (payload: { error: string; code?: string }): WalletError => {
	const code = payload.code ?? "";
	const text = payload.error ?? "";
	if (
		/^(Method_Cancel|Method_Interrupted|Method_PermissionsNotGranted|Failure_ActionCancelled|Failure_PinCancelled)$/.test(
			code,
		) ||
		/cancell?ed|popup closed|permissions not granted/i.test(text)
	) {
		return new WalletError("rejected");
	}
	if (/^(Device_CallInProgress|Device_UsedElsewhere|Device_InvalidState)$/.test(code)) {
		return code === "Device_InvalidState" ? new WalletError("wrong-device", text) : new WalletError("busy");
	}
	if (/^(Transport_Missing|Device_NotFound|Device_Disconnected|Popup_ConnectionMissing|Init_|Desktop_)/.test(code)) {
		return new WalletError("unavailable", text);
	}
	if (/^Failure_PinInvalid|^Failure_PinExpected/.test(code)) return new WalletError("locked", text);
	if (/^Method_(InvalidParameter|NotAllowed)|Failure_DataError|Failure_FirmwareError/.test(code)) {
		return new WalletError("unsupported", text);
	}
	return new WalletError("unknown", text || code);
};

const unwrap = <T>(res: TrezorResponse<T>): T => {
	if (res.success) return res.payload;
	throw mapTrezorError(res.payload);
};

const call = async <T>(fn: (api: TrezorApi) => Promise<TrezorResponse<T>>): Promise<T> => {
	const api = await load();
	let res: TrezorResponse<T>;
	try {
		res = await fn(api);
	} catch (e) {
		if (e instanceof WalletError) throw e;
		throw new WalletError("unknown", (e as Error).message);
	}
	return unwrap(res);
};

const requirePath = (signer: Signer): string => {
	if (!signer.path) throw new WalletError("unknown", "Signer has no derivation path");
	return signer.path;
};

export const trezorAdapter: WalletAdapter = {
	kind: "trezor",
	schemes: TREZOR_SCHEMES,

	listAccounts: async ({
		scheme,
		offset = 0,
		count = DEFAULT_PAGE,
	}: ListAccountsOptions): Promise<DiscoveredAccount[]> => {
		const derive = resolveScheme(TREZOR_SCHEMES, scheme).path;
		const paths = Array.from({ length: count }, (_, i) => derive(offset + i));
		const result = await call((api) =>
			api.ethereumGetAddress({ bundle: paths.map((path) => ({ path, showOnTrezor: false })) }),
		);
		return result.map((item, i) => ({ address: getAddress(item.address) as Address, path: paths[i] }));
	},

	signTypedData: async (signer: Signer, data: TypedDataPayload): Promise<Hex> => {
		const { domainSeparator, messageHash } = typedDataHashes(data);
		const result = await call((api) =>
			api.ethereumSignTypedData({
				path: requirePath(signer),
				data: toFullTypedData(data),
				metamask_v4_compat: true,
				// Lets models that cannot parse the structure (Trezor One) sign the hashes.
				domain_separator_hash: domainSeparator,
				message_hash: messageHash,
			}),
		);
		if (!sameAddress(result.address, signer.address)) {
			throw new WalletError("wrong-device", undefined, { address: signer.address });
		}
		return normalizeSignature(result.signature);
	},

	sendTransaction: async (signer: Signer, tx: TxRequest): Promise<Hex> => {
		const prepared = await prepareTx(signer.address, tx);
		const common = {
			to: prepared.to,
			value: toRpcHex(prepared.value),
			data: prepared.data,
			chainId: prepared.chainId,
			nonce: toRpcHex(prepared.nonce),
			gasLimit: toRpcHex(prepared.gas),
		};
		const transaction =
			prepared.type === "eip1559"
				? {
						...common,
						maxFeePerGas: toRpcHex(prepared.maxFeePerGas ?? 0n),
						maxPriorityFeePerGas: toRpcHex(prepared.maxPriorityFeePerGas ?? 0n),
					}
				: { ...common, gasPrice: toRpcHex(prepared.gasPrice ?? 0n) };
		const sig = await call((api) => api.ethereumSignTransaction({ path: requirePath(signer), transaction }));
		// Re-assembled locally: also proves the device signed exactly this transaction with this key.
		const serialized = await assembleSigned(prepared, signer.address, sig.r, sig.s);
		return broadcast(tx.chainId, serialized);
	},
};
