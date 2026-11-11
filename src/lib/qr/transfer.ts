/** Transport encoding for data moved between devices by QR or copy-paste. */
export const TRANSFER_PREFIX = "msv1:";

/** Upper bound for the decompressed JSON – protects against decompression bombs. */
export const MAX_TRANSFER_BYTES = 2 * 1024 * 1024;

const toBase64Url = (bytes: Uint8Array): string => {
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> | null => {
	if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
	try {
		const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
};

const pump = async (
	input: Uint8Array<ArrayBuffer>,
	transform: CompressionStream | DecompressionStream,
	limit: number,
): Promise<Uint8Array> => {
	const writer = transform.writable.getWriter();
	// Errors surface on the reading side; the write side must not produce unhandled rejections.
	void writer.write(input).catch(() => undefined);
	void writer.close().catch(() => undefined);
	const reader = transform.readable.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.length;
		if (size > limit) {
			void reader.cancel().catch(() => undefined);
			throw new Error("Payload too large");
		}
		chunks.push(value);
	}
	const out = new Uint8Array(size);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
};

export const isTransferText = (text: string): boolean => text.trim().startsWith(TRANSFER_PREFIX);

export const packTransfer = async (data: unknown): Promise<string> => {
	const json = new TextEncoder().encode(JSON.stringify(data));
	if (json.length > MAX_TRANSFER_BYTES) throw new Error("Payload too large");
	const packed = await pump(json, new CompressionStream("deflate-raw"), Number.MAX_SAFE_INTEGER);
	return TRANSFER_PREFIX + toBase64Url(packed);
};

/** Returns `null` for anything that is not a well-formed transfer text. */
export const unpackTransfer = async (text: string): Promise<unknown | null> => {
	const value = text.trim();
	if (!value.startsWith(TRANSFER_PREFIX)) return null;
	const bytes = fromBase64Url(value.slice(TRANSFER_PREFIX.length));
	if (!bytes) return null;
	try {
		const json = await pump(bytes, new DecompressionStream("deflate-raw"), MAX_TRANSFER_BYTES);
		const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
		return parsed ?? null;
	} catch {
		return null;
	}
};
