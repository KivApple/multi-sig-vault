// Relay for handing a request from the app in one browser to the same app inside MetaMask's browser.
//
// It is a blind mailbox. Each session has two slots, `req` and `res`, holding opaque bytes that the two
// pages encrypt with a key the relay never sees (it travels in a URL fragment). The relay cannot read a
// message, and a changed one fails authentication on the receiving page. What it can do is lose messages.
// No message is written to disk or logged; a session lives for a few minutes in memory.
//
// It also re-serves the exchange's coin icons (`/relay/coins/<coin>.svg`). The exchange sends them
// without CORS headers, so the app cannot fetch them itself. The app downloads the icons of ALL listed
// coins in list order, never the ones an account holds, so this server learns nothing about anybody's
// portfolio. Icons are public files; they are cached on disk (ICON_CACHE_DIR) for ICON_CACHE_DAYS.
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

const TTL_MS = 10 * 60_000;
const MAX_BODY = 32 * 1024;
const MAX_SESSIONS = 20_000;
const MAX_WAIT_MS = 25_000;
const RATE_PER_MINUTE = 300;
const ROUTE = /^\/relay\/v1\/([0-9a-f]{32})\/(req|res)$/;

const ICON_ROUTE = /^\/relay\/coins\/([A-Za-z0-9:_-]{1,40})\.svg$/;
const ICON_MAX_BYTES = 100 * 1024;
const ICON_RATE_PER_MINUTE = 3000;
const ICON_MAX_UPSTREAM = 8;
const ICON_MISS_TTL_MS = 6 * 3_600_000;
const ICON_MAX_MISSES = 20_000;

/** An SVG that is safe to hand out from our own origin: a plain drawing, nothing active, nothing remote. */
export const cleanSvg = (svg) => {
	const text = svg.trim();
	if (!/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text) || !/<\/svg>\s*$/i.test(text)) return undefined;
	if (/<script|<foreignObject|<iframe|<object|<embed|\son\w+\s*=|javascript:/i.test(text)) return undefined;
	if (/(href|src)\s*=\s*["'](?!#|data:image\/(png|jpeg|webp);base64,)/i.test(text)) return undefined;
	return text;
};

/**
 * Icons of exchange coins, fetched from the exchange once and kept on disk.
 * `load(name)` resolves to the SVG text, `null` when the exchange has no such icon, or throws when it
 * could not be asked and nothing is cached.
 */
export const createIconCache = ({ dir, ttlMs, upstream, fetchImpl = fetch }) => {
	const inflight = new Map();
	/** name -> time the exchange said it has no such icon (memory only: junk names must not fill the disk). */
	const misses = new Map();
	let active = 0;
	const fileOf = (name) => join(dir, `${name.replaceAll(":", "~")}.svg`);

	const refresh = async (name) => {
		if (active >= ICON_MAX_UPSTREAM) throw new Error("busy");
		active++;
		try {
			const res = await fetchImpl(`${upstream}${encodeURIComponent(name)}.svg`, { signal: AbortSignal.timeout(15_000) });
			// The exchange answers a missing icon with its HTML page.
			const svg =
				res.ok && (res.headers.get("content-type") ?? "").startsWith("image/svg") ? cleanSvg(await res.text()) : undefined;
			if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
			if (!svg || Buffer.byteLength(svg) > ICON_MAX_BYTES) {
				if (misses.size >= ICON_MAX_MISSES) misses.clear();
				misses.set(name, Date.now());
				return null;
			}
			await mkdir(dir, { recursive: true });
			const tmp = `${fileOf(name)}.${process.pid}.tmp`;
			await writeFile(tmp, svg);
			await rename(tmp, fileOf(name));
			return svg;
		} finally {
			active--;
		}
	};

	const load = async (name) => {
		const cached = await stat(fileOf(name)).catch(() => undefined);
		if (cached && Date.now() - cached.mtimeMs < ttlMs) return readFile(fileOf(name), "utf8");
		const missedAt = misses.get(name);
		if (missedAt && Date.now() - missedAt < ICON_MISS_TTL_MS) return null;
		let job = inflight.get(name);
		if (!job) {
			job = refresh(name).finally(() => inflight.delete(name));
			inflight.set(name, job);
		}
		try {
			return await job;
		} catch (e) {
			// The exchange is unreachable: an expired copy is better than nothing.
			if (cached) return readFile(fileOf(name), "utf8");
			throw e;
		}
	};
	return { load };
};

export const createRelay = ({ icons } = {}) => {
	/** id -> { at, req?: Buffer, res?: Buffer, waiters: Set<() => void> } */
	const sessions = new Map();
	/** ip -> { windowStart, count } */
	const rates = new Map();

	const sweep = () => {
		const now = Date.now();
		for (const [id, s] of sessions) if (now - s.at > TTL_MS) sessions.delete(id);
		for (const [ip, r] of rates) if (now - r.windowStart > 60_000) rates.delete(ip);
	};
	const timer = setInterval(sweep, 30_000);
	timer.unref();

	const limited = (ip, kind = "", perMinute = RATE_PER_MINUTE) => {
		const now = Date.now();
		const key = kind + ip;
		const r = rates.get(key);
		if (!r || now - r.windowStart > 60_000) {
			rates.set(key, { windowStart: now, count: 1 });
			return false;
		}
		r.count += 1;
		return r.count > perMinute;
	};

	/**
	 * An icon is a file from somebody else served under our origin: it must stay a picture. The policy
	 * makes a browser that opens it directly treat it as an inert, sandboxed document.
	 */
	const sendIcon = (res, status, body) => {
		res.writeHead(status, {
			"Content-Type": body ? "image/svg+xml" : "text/plain",
			"Cache-Control": status === 200 ? "public, max-age=86400" : status === 404 ? "public, max-age=3600" : "no-store",
			"X-Content-Type-Options": "nosniff",
			"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
		});
		res.end(body);
	};

	const send = (res, status, body) => {
		res.writeHead(status, {
			"Content-Type": body ? "application/octet-stream" : "text/plain",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		});
		res.end(body);
	};

	const server = createServer((req, res) => {
		const path = (req.url ?? "").split("?")[0];
		if (req.method === "GET" && path === "/relay/health") return send(res, 200, "ok");
		const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
		let icon = null;
		try {
			icon = ICON_ROUTE.exec(decodeURIComponent(path));
		} catch {
			// Not a valid path at all.
		}
		if (icon) {
			if (req.method !== "GET") return send(res, 405);
			if (!icons) return sendIcon(res, 404);
			// Its own allowance: a first sync asks for every listed coin and must not block a hand-off.
			if (limited(ip, "icon:", ICON_RATE_PER_MINUTE)) return sendIcon(res, 429);
			icons.load(icon[1]).then(
				(svg) => (svg ? sendIcon(res, 200, svg) : sendIcon(res, 404)),
				() => sendIcon(res, 503),
			);
			return undefined;
		}
		if (limited(ip)) return send(res, 429);
		const match = ROUTE.exec(path);
		if (!match) return send(res, 404);
		const [, id, slot] = match;

		if (req.method === "PUT") {
			const chunks = [];
			let size = 0;
			req.on("data", (chunk) => {
				size += chunk.length;
				if (size > MAX_BODY) {
					send(res, 413);
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => {
				if (res.writableEnded || size === 0) return res.writableEnded ? undefined : send(res, 400);
				let session = sessions.get(id);
				if (!session) {
					// A session starts with its request.
					if (slot !== "req") return send(res, 404);
					if (sessions.size >= MAX_SESSIONS) return send(res, 503);
					session = { at: Date.now(), waiters: new Set() };
					sessions.set(id, session);
				}
				// Write once: nobody can replace a message that is already there.
				if (session[slot]) return send(res, 409);
				session[slot] = Buffer.concat(chunks);
				for (const wake of session.waiters) wake();
				session.waiters.clear();
				return send(res, 201);
			});
			return undefined;
		}

		if (req.method === "GET") {
			const session = sessions.get(id);
			if (session?.[slot]) return send(res, 200, session[slot]);
			const wait = Math.min(MAX_WAIT_MS, Number(new URL(req.url, "http://x").searchParams.get("wait")) * 1000 || 0);
			if (!session || wait <= 0) return send(res, 404);
			// Long poll: answer as soon as the other side writes.
			const wake = () => {
				clearTimeout(timeout);
				session.waiters.delete(wake);
				if (!res.writableEnded) session[slot] ? send(res, 200, session[slot]) : send(res, 404);
			};
			const timeout = setTimeout(wake, wait);
			session.waiters.add(wake);
			req.on("close", () => {
				clearTimeout(timeout);
				session.waiters.delete(wake);
			});
			return undefined;
		}
		return send(res, 405);
	});
	server.on("close", () => clearInterval(timer));
	return server;
};

if (import.meta.url === `file://${process.argv[1]}`) {
	const port = Number(process.env.PORT) || 8080;
	const dir = process.env.ICON_CACHE_DIR;
	const icons = dir
		? createIconCache({
				dir,
				ttlMs: (Number(process.env.ICON_CACHE_DAYS) || 30) * 86_400_000,
				upstream: process.env.ICON_UPSTREAM || "https://app.hyperliquid.xyz/coins/",
			})
		: undefined;
	const server = createRelay({ icons }).listen(port, "0.0.0.0");
	process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
