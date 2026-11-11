import ARB from "@/assets/icons/token/ARB.svg";
import BTC from "@/assets/icons/token/BTC.svg";
import DAI from "@/assets/icons/token/DAI.svg";
import ETH from "@/assets/icons/token/ETH.svg";
import HYPE from "@/assets/icons/token/HYPE.svg";
import USDC from "@/assets/icons/token/USDC.svg";
import USDT from "@/assets/icons/token/USDT.svg";
import WBTC from "@/assets/icons/token/WBTC.svg";
import { bumpIconEpoch } from "./store";

/** Icons that must never wait for a network or a lazy chunk. */
const CORE: Record<string, string> = { ARB, BTC, DAI, ETH, HYPE, USDC, USDT, WBTC };

let pack: Record<string, string> | undefined;
let loading: Promise<void> | undefined;
const urls = new Map<string, string>();

/** Loads the built-in icon pack (a separate chunk, ~350 icons). */
export const loadBuiltinPack = (): Promise<void> => {
	loading ??= import("@/assets/icons/token-pack.json")
		.then((mod) => {
			pack = (mod as { default: Record<string, string> }).default;
			bumpIconEpoch();
		})
		.catch(() => {
			loading = undefined;
		});
	return loading;
};

/** Built-in icon for an (already aliased, upper-case) symbol; starts loading the pack on a miss. */
export const builtinIconUrl = (symbol: string): string | undefined => {
	const core = CORE[symbol];
	if (core) return core;
	if (!pack) {
		void loadBuiltinPack();
		return undefined;
	}
	let url = urls.get(symbol);
	if (url === undefined && Object.hasOwn(pack, symbol)) {
		// Rendered only through <img>, where SVG cannot run scripts or load external resources.
		url = `data:image/svg+xml,${encodeURIComponent(pack[symbol])}`;
		urls.set(symbol, url);
	}
	return url;
};
