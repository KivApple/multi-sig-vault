/**
 * End-to-end encryption of hand-off messages. The key is created by the requesting page and reaches the
 * signing page inside a URL fragment, which browsers never send to a server – the relay only sees
 * ciphertext. AES-GCM authenticates every message together with its session and slot, so the relay can
 * neither alter a message nor answer a request with a message from another slot or session.
 */
export type Slot = "req" | "res";

const ID_BYTES = 16;
const KEY_BYTES = 32;
const IV_BYTES = 12;

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const toBase64Url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
	const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
};

export interface HandoffToken {
	/** Session id – the only thing the relay knows. */
	id: string;
	key: Uint8Array<ArrayBuffer>;
}

export const newToken = (): HandoffToken => ({
	id: toHex(crypto.getRandomValues(new Uint8Array(ID_BYTES))),
	key: crypto.getRandomValues(new Uint8Array(KEY_BYTES)),
});

export const formatToken = (token: HandoffToken): string => `${token.id}.${toBase64Url(token.key)}`;

export const parseToken = (text: string): HandoffToken | undefined => {
	const match = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(text);
	if (!match) return undefined;
	try {
		const key = fromBase64Url(match[2]);
		return key.length === KEY_BYTES ? { id: match[1], key } : undefined;
	} catch {
		return undefined;
	}
};

const aad = (id: string, slot: Slot): Uint8Array<ArrayBuffer> =>
	new TextEncoder().encode(`msv-handoff-v1|${id}|${slot}`);

const importKey = (key: Uint8Array<ArrayBuffer>): Promise<CryptoKey> =>
	crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);

export const seal = async (token: HandoffToken, slot: Slot, value: unknown): Promise<Uint8Array<ArrayBuffer>> => {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const body = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: aad(token.id, slot) },
		await importKey(token.key),
		new TextEncoder().encode(JSON.stringify(value)),
	);
	const out = new Uint8Array(IV_BYTES + body.byteLength);
	out.set(iv);
	out.set(new Uint8Array(body), IV_BYTES);
	return out;
};

/** Throws when the message was not produced with this key for this session and slot. */
export const open = async (token: HandoffToken, slot: Slot, data: Uint8Array<ArrayBuffer>): Promise<unknown> => {
	const body = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: data.slice(0, IV_BYTES), additionalData: aad(token.id, slot) },
		await importKey(token.key),
		data.slice(IV_BYTES),
	);
	return JSON.parse(new TextDecoder().decode(body));
};

/**
 * Six digits shown by both pages. They come from the key, so a signing page opened from somebody
 * else's link shows a code the user's own app never displayed.
 */
export const sessionCode = async (token: HandoffToken): Promise<string> => {
	const input = new Uint8Array([...new TextEncoder().encode("msv-handoff-code"), ...token.key]);
	const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
	const n = ((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]) >>> 0;
	return String(n % 1_000_000).padStart(6, "0");
};
