/**
 * End-to-end encryption of hand-off messages.
 *
 * The app instance in the user's browser and the signing page in MetaMask's browser share a PAIR KEY,
 * created by the app and stored by both. Every request and answer is encrypted with a key derived from
 * it for that one session, so:
 *   - the relay sees ciphertext only and cannot alter it (AES-GCM, bound to session and direction);
 *   - a link made by anybody else carries a request the signing page cannot decrypt – it is refused
 *     before anything is shown, so a planted link cannot ask for a signature.
 *
 * Pairing happens once. The link then also carries a random LINK KEY in its fragment (never sent to a
 * server), and the app shows a six-digit code the user TYPES into the signing page. The pairing message
 * is encrypted with a key derived from both: the relay lacks the link key, the sender of a planted link
 * lacks a code the user's own app displays.
 */
export type Slot = "req" | "res";

const ID_BYTES = 16;
const KEY_BYTES = 32;
const IV_BYTES = 12;

type Bytes = Uint8Array<ArrayBuffer>;

const utf8 = (text: string): Bytes => new TextEncoder().encode(text);

export const toBase64Url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

export const fromBase64Url = (text: string): Bytes | undefined => {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
	try {
		const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
		const out = new Uint8Array(raw.length);
		for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
		return out;
	} catch {
		return undefined;
	}
};

export const newSessionId = (): string =>
	Array.from(crypto.getRandomValues(new Uint8Array(ID_BYTES)), (b) => b.toString(16).padStart(2, "0")).join("");

export const newKey = (): Bytes => crypto.getRandomValues(new Uint8Array(KEY_BYTES));

/** Six uniformly random digits. */
export const newCode = (): string => {
	const limit = 4_294_000_000; // largest multiple of 1e6 below 2^32, to avoid modulo bias
	for (;;) {
		const n = crypto.getRandomValues(new Uint32Array(1))[0];
		if (n < limit) return String(n % 1_000_000).padStart(6, "0");
	}
};

export const parseKey = (text: string): Bytes | undefined => {
	const key = fromBase64Url(text);
	return key?.length === KEY_BYTES ? key : undefined;
};

export interface LinkToken {
	id: string;
	/** Present only in a pairing link. */
	linkKey?: Bytes;
}

export const formatLinkToken = (token: LinkToken): string =>
	token.linkKey ? `${token.id}.${toBase64Url(token.linkKey)}` : token.id;

export const parseLinkToken = (text: string): LinkToken | undefined => {
	const match = /^([0-9a-f]{32})(?:\.([A-Za-z0-9_-]{43}))?$/.exec(text);
	if (!match) return undefined;
	if (!match[2]) return { id: match[1] };
	const linkKey = parseKey(match[2]);
	return linkKey ? { id: match[1], linkKey } : undefined;
};

const derive = async (secret: Bytes, salt: string, info: string): Promise<CryptoKey> =>
	crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: utf8(salt), info: utf8(info) },
		await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]),
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);

/** Key of one session between paired instances. */
export const sessionKey = (pairKey: Bytes, id: string): Promise<CryptoKey> =>
	derive(pairKey, id, "msv-handoff-v2 session");

/** Key of a pairing message: needs both the link key and the code typed by the user. */
export const pairingKey = (linkKey: Bytes, code: string, id: string): Promise<CryptoKey> =>
	derive(linkKey, `${id}|${code}`, "msv-handoff-v2 pairing");

const aad = (id: string, slot: Slot): Bytes => utf8(`msv-handoff-v2|${id}|${slot}`);

export const seal = async (key: CryptoKey, id: string, slot: Slot, value: unknown): Promise<Bytes> => {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const body = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: aad(id, slot) },
		key,
		utf8(JSON.stringify(value)),
	);
	const out = new Uint8Array(IV_BYTES + body.byteLength);
	out.set(iv);
	out.set(new Uint8Array(body), IV_BYTES);
	return out;
};

/** Throws when the message was not produced with this key for this session and direction. */
export const open = async (key: CryptoKey, id: string, slot: Slot, data: Bytes): Promise<unknown> => {
	const body = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: data.slice(0, IV_BYTES), additionalData: aad(id, slot) },
		key,
		data.slice(IV_BYTES),
	);
	return JSON.parse(new TextDecoder().decode(body));
};
