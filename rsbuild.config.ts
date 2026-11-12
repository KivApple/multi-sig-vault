import { defineConfig } from "@rsbuild/core";
import { pluginNodePolyfill } from "@rsbuild/plugin-node-polyfill";
import { pluginReact } from "@rsbuild/plugin-react";
import pkg from "./package.json" with { type: "json" };
import { pluginReleaseManifest } from "./scripts/release/plugin";

const isProd = process.env.NODE_ENV === "production";

/**
 * Strict CSP (production only – the dev server needs eval/HMR):
 * no inline or remote scripts, no plugins, no form posts, frames only for Trezor Connect.
 */
const CSP = [
	"default-src 'self'",
	"script-src 'self' 'wasm-unsafe-eval'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self' https: wss: ws://127.0.0.1:21335",
	"frame-src https://connect.trezor.io https://suite.trezor.io",
	"worker-src 'self' blob:",
	"media-src 'self' blob:",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join("; ");

export default defineConfig({
	plugins: [pluginReact(), pluginNodePolyfill(), pluginReleaseManifest({ version: pkg.version })],
	source: {
		entry: { index: "./src/index.tsx" },
		define: {
			"import.meta.env.PUBLIC_APP_VERSION": JSON.stringify(pkg.version),
		},
	},
	resolve: { alias: { "@": "./src", "@react-native-async-storage/async-storage": false } },
	html: {
		template: "./src/index.html",
		title: "Multi Sig Vault",
		meta: isProd ? { csp: { "http-equiv": "Content-Security-Policy", content: CSP } } : {},
	},
	output: {
		assetPrefix: "./",
		legalComments: "none",
		sourceMap: false,
	},
	performance: {
		chunkSplit: { strategy: "split-by-experience" },
	},
	// `node relay/server.mjs` with PORT=8787 serves the MetaMask hand-off relay in development.
	server: { port: 5173, proxy: { "/relay": "http://127.0.0.1:8787" } },
});
