import { getAddress, type Address, type Hex } from 'viem';
import { WalletError } from '@/lib/errors';
import { sameAddress } from '@/lib/format';
import type { Signer } from '@/types/domain';
import { assembleSigned, broadcast, prepareTx, serializeUnsigned } from './evmTx';
import { DEFAULT_PAGE, LEDGER_SCHEMES, resolveScheme, stripMasterPrefix } from './paths';
import { joinSignature, toFullTypedData, typedDataHashes } from './typedData';
import type { DiscoveredAccount, ListAccountsOptions, TxRequest, TypedDataPayload, WalletAdapter } from './types';

/**
 * Ledger over WebHID (desktop Chrome) with WebUSB fallback (Chrome on Android has no WebHID).
 * Talks to the device directly – works offline. All of hw-app-eth's network lookups
 * (clear-signing descriptors, token lists, plugins) are disabled: nothing about the user's
 * transactions leaves the device, and contract calls are confirmed as raw data / blind signed.
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
}

/** No remote services: privacy + offline. */
const OFFLINE_LOAD_CONFIG = {
  nftExplorerBaseURL: null,
  pluginBaseURL: null,
  extraPlugins: null,
  cryptoassetsBaseURL: null,
  calServiceURL: null,
};

const EMPTY_RESOLUTION = { erc20Tokens: [], nfts: [], externalPlugin: [], plugin: [], domains: [] };

let transport: LedgerTransport | null = null;
let queue: Promise<unknown> = Promise.resolve();

const statusOf = (e: unknown): number | undefined => (e as { statusCode?: number }).statusCode;
const nameOf = (e: unknown): string => (e as { name?: string }).name ?? '';
const messageOf = (e: unknown): string => (e as { message?: string }).message ?? String(e);

export const mapLedgerError = (e: unknown): WalletError => {
  if (e instanceof WalletError) return e;
  const status = statusOf(e);
  const name = nameOf(e);
  const message = messageOf(e);
  switch (status) {
    case 0x6985:
      return new WalletError('rejected');
    case 0x6a80:
      return new WalletError('blind-signing');
    case 0x5515:
    case 0x6b0c:
      return new WalletError('locked');
    case 0x6d00:
    case 0x6e00:
    case 0x6e01:
    case 0x6511:
    case 0x6d02:
      return new WalletError('app-closed');
    default:
      break;
  }
  if (name === 'TransportOpenUserCancelled' || /no device selected|must be handling a user gesture/i.test(message)) {
    return new WalletError('unavailable', message);
  }
  if (name === 'LockedDeviceError') return new WalletError('locked');
  if (name === 'TransportRaceCondition' || /already open|busy|in progress/i.test(message)) {
    return new WalletError('busy');
  }
  if (/^Disconnected|TransportInterfaceNotAvailable|NetworkError|NotFoundError/.test(name) || /disconnected/i.test(message)) {
    return new WalletError('unavailable', message);
  }
  if (name === 'EthAppPleaseEnableContractData') return new WalletError('blind-signing');
  return new WalletError('unknown', message);
};

const dropTransport = async (): Promise<void> => {
  const t = transport;
  transport = null;
  await t?.close().catch(() => undefined);
};

const openTransport = async (): Promise<LedgerTransport> => {
  if (transport) return transport;
  let created: LedgerTransport;
  if (typeof navigator !== 'undefined' && 'hid' in navigator) {
    const { default: TransportWebHID } = await import('@ledgerhq/hw-transport-webhid');
    created = (await TransportWebHID.create()) as unknown as LedgerTransport;
  } else if (typeof navigator !== 'undefined' && 'usb' in navigator) {
    const { default: TransportWebUSB } = await import('@ledgerhq/hw-transport-webusb');
    created = (await TransportWebUSB.create()) as unknown as LedgerTransport;
  } else {
    throw new WalletError('unsupported');
  }
  created.on('disconnect', () => {
    if (transport === created) transport = null;
  });
  transport = created;
  return created;
};

const connect = async (): Promise<LedgerEth> => {
  const [{ default: Eth }, t] = await Promise.all([import('@ledgerhq/hw-app-eth'), openTransport()]);
  const EthCtor = Eth as unknown as new (transport: unknown, scrambleKey?: string, loadConfig?: unknown) => LedgerEth;
  return new EthCtor(t, undefined, OFFLINE_LOAD_CONFIG);
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
        const stale = mapped.code === 'unavailable' || mapped.code === 'busy';
        if (stale) await dropTransport();
        if (!stale || attempt > 0 || nameOf(e) === 'TransportOpenUserCancelled') throw mapped;
      }
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
};

const requirePath = (signer: Signer): string => {
  if (!signer.path) throw new WalletError('unknown', 'Signer has no derivation path');
  return stripMasterPrefix(signer.path);
};

const assertDevice = async (eth: LedgerEth, path: string, signer: Signer): Promise<void> => {
  const { address } = await eth.getAddress(path, false);
  if (!sameAddress(address, signer.address)) {
    throw new WalletError('wrong-device', undefined, { address: signer.address });
  }
};

export const ledgerAdapter: WalletAdapter = {
  kind: 'ledger',
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
      try {
        const sig = await eth.signEIP712Message(path, toFullTypedData(data));
        return joinSignature(sig.r, sig.s, sig.v);
      } catch (e) {
        const code = mapLedgerError(e).code;
        // Rejected / locked / unplugged are final; anything else means the app or device
        // cannot display this structure – sign the two hashes instead (Nano S, old apps).
        if (code === 'rejected' || code === 'locked' || code === 'unavailable' || code === 'busy') throw e;
      }
      const { domainSeparator, messageHash } = typedDataHashes(data);
      const sig = await eth.signEIP712HashedMessage(path, domainSeparator.slice(2), messageHash.slice(2));
      return joinSignature(sig.r, sig.s, sig.v);
    }),

  sendTransaction: async (signer: Signer, tx: TxRequest): Promise<Hex> => {
    const prepared = await prepareTx(signer.address, tx);
    const serialized = await withLedger(async (eth) => {
      const path = requirePath(signer);
      await assertDevice(eth, path, signer);
      const sig = await eth.signTransaction(path, serializeUnsigned(prepared).slice(2), EMPTY_RESOLUTION);
      return assembleSigned(prepared, signer.address, sig.r, sig.s);
    });
    return broadcast(tx.chainId, serialized);
  },
};
