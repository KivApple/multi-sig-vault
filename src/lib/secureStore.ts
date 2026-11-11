import { idbDel, idbGet, idbSet } from './idb';

/**
 * Storage for the only secrets the app ever holds: Hyperliquid agent keys it generated itself.
 * Values are encrypted with a non-extractable AES-GCM key kept in IndexedDB, so the raw secret
 * never sits in storage in plain text and the wrapping key cannot be exported by script.
 * A native shell (Capacitor/Electron) can swap this module for Keychain/Keystore.
 */
const KEY_ID = 'wrapping-key';

let keyPromise: Promise<CryptoKey> | undefined;

const getKey = (): Promise<CryptoKey> => {
  keyPromise ??= (async () => {
    const existing = await idbGet<CryptoKey>('meta', KEY_ID);
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idbSet('meta', KEY_ID, key);
    return key;
  })();
  return keyPromise;
};

interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

export const secureSet = async (id: string, secret: string): Promise<void> => {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret));
  await idbSet('secure', id, { iv, data } satisfies Sealed);
};

export const secureGet = async (id: string): Promise<string | undefined> => {
  const sealed = await idbGet<Sealed>('secure', id);
  if (!sealed) return undefined;
  const key = await getKey();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.data);
  return new TextDecoder().decode(plain);
};

export const secureDelete = (id: string): Promise<unknown> => idbDel('secure', id);

export const agentKeyId = (opId: string): string => `agent:${opId}`;
