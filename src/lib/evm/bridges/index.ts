import type { BridgeKind, ChainConfig } from "@/config/chains";
import { swapProviderFor } from "../swaps";
import { acrossBridge } from "./across";
import { cctpBridge } from "./cctp";
import type { BridgeProvider, BridgeRoute, ReceiveAsset } from "./types";

export type { BridgeProgress, BridgeProvider, BridgeRoute, Lane, LegCtx, LegView, ReceiveAsset } from "./types";

/**
 * Every bridge the app knows. Where two of them carry the same thing between two networks, the one
 * listed first is used.
 */
export const BRIDGES: BridgeProvider[] = [acrossBridge, cctpBridge];

export const bridgeOf = (kind: BridgeKind): BridgeProvider => {
	const provider = BRIDGES.find((b) => b.id === kind);
	if (!provider) throw new Error(`Unknown bridge ${kind}`);
	return provider;
};

/** What is offered, when a bridge cannot carry an amount, by a bridge that can. */
export const FALLBACK_RECEIVE: ReceiveAsset = "USDC";

const sameToken = (a: string | undefined, b: string | undefined): boolean =>
	!!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Every way `token` (an address; the wrapped coin stands for the native one) can cross between two
 * networks, the one taken by default first. Each way is a lane of a bridge: the token of the lane
 * crosses as it is, anything else is swapped into it on the source network first.
 *
 * The default, in this order: the token itself, where a bridge carries it; USDC (through Circle's
 * bridge wherever both networks have it); USDT, where there is no USDC to receive (BNB Chain).
 * Without `token` nothing is ruled out for want of a DEX to swap on.
 */
export const bridgeRoutes = (src: ChainConfig, dst: ChainConfig, token?: string): BridgeRoute[] => {
	if (src.id === dst.id || src.env !== dst.env) return [];
	const routes: BridgeRoute[] = [];
	for (const bridge of BRIDGES) {
		for (const lane of bridge.lanes(src, dst)) {
			if (!routes.some((r) => r.receive === lane.receive)) routes.push({ ...lane, kind: bridge.id });
		}
	}
	const canSwap = !!swapProviderFor(src);
	const rank = (r: BridgeRoute): number =>
		sameToken(r.token, token) ? 0 : r.receive === "USDC" ? 1 : r.receive === "USDT" ? 2 : 3;
	return routes.filter((r) => !token || canSwap || sameToken(r.token, token)).sort((x, y) => rank(x) - rank(y));
};

/** The way `token` crosses: the one that makes it arrive as `want` if there is such, else the default. */
export const bridgeRoute = (
	src: ChainConfig,
	dst: ChainConfig,
	token?: string,
	want?: ReceiveAsset,
): BridgeRoute | undefined => {
	const routes = bridgeRoutes(src, dst, token);
	return routes.find((r) => r.receive === want) ?? routes[0];
};

/** The cross-chain leg an operation carries, with the bridge it belongs to. */
export const legOf = (
	resolved: object | undefined,
): { provider: BridgeProvider; leg: unknown; count: number } | undefined => {
	if (!resolved) return undefined;
	const found = BRIDGES.filter((b) => (resolved as Record<string, unknown>)[b.legKey] !== undefined);
	if (found.length === 0) return undefined;
	return { provider: found[0], leg: (resolved as Record<string, unknown>)[found[0].legKey], count: found.length };
};
