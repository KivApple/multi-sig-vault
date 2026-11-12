// Relay for handing a request from the app in one browser to the same app inside MetaMask's browser.
//
// It is a blind mailbox. Each session has two slots, `req` and `res`, holding opaque bytes that the two
// pages encrypt with a key the relay never sees (it travels in a URL fragment). The relay cannot read a
// message, and a changed one fails authentication on the receiving page. What it can do is lose messages.
// Nothing is written to disk or logged; a session lives for a few minutes in memory.
import { createServer } from "node:http";

const TTL_MS = 10 * 60_000;
const MAX_BODY = 32 * 1024;
const MAX_SESSIONS = 20_000;
const MAX_WAIT_MS = 25_000;
const RATE_PER_MINUTE = 300;
const ROUTE = /^\/relay\/v1\/([0-9a-f]{32})\/(req|res)$/;

export const createRelay = () => {
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

	const limited = (ip) => {
		const now = Date.now();
		const r = rates.get(ip);
		if (!r || now - r.windowStart > 60_000) {
			rates.set(ip, { windowStart: now, count: 1 });
			return false;
		}
		r.count += 1;
		return r.count > RATE_PER_MINUTE;
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
	const server = createRelay().listen(port, "0.0.0.0");
	process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
