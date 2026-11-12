import type { Address } from "viem";
import type { NetworkEnv } from "@/types/domain";

export type ChainKey = "ethereum" | "hyperevm" | "arbitrum" | "base" | "polygon";

export interface DexConfig {
	/** Uniswap-V3 compatible router. */
	router: Address;
	quoter: Address;
	factory: Address;
	/** Wrapped native token the router uses when it differs from the chain's canonical one. */
	weth?: Address;
	feeTiers: number[];
	name: string;
}

export interface CctpConfig {
	domain: number;
	tokenMessenger: Address;
	messageTransmitter: Address;
}

export interface ChainConfig {
	id: number;
	key: ChainKey;
	env: NetworkEnv;
	name: string;
	shortName: string;
	nativeSymbol: string;
	nativeName: string;
	rpcUrls: string[];
	/** Private transaction endpoint used when MEV protection is on. */
	mevRpcUrl?: string;
	explorer: string;
	wrappedNative: Address;
	usdc?: Address;
	dex?: DexConfig;
	cctp?: CctpConfig;
	/** Safe Transaction Service base URL (used only to resolve creation parameters). */
	safeTxService?: string;
	/** Legacy (non EIP-1559) transactions only. */
	legacyTx?: boolean;
}

const UNI_TIERS = [100, 500, 3000, 10000];

/** Circle Iris API (attestations, fees) per environment. */
export const IRIS_API: Record<NetworkEnv, string> = {
	mainnet: "https://iris-api.circle.com",
	testnet: "https://iris-api-sandbox.circle.com",
};

const CCTP_MAINNET = {
	tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
	messageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
} as const;

const CCTP_TESTNET = {
	tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
	messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
} as const;

/**
 * Adding a chain: append an entry here, add a network icon in
 * `components/icons/NetworkIcon.tsx` and (optionally) built-in tokens.
 */
export const CHAINS: ChainConfig[] = [
	{
		id: 1,
		key: "ethereum",
		env: "mainnet",
		name: "Ethereum",
		shortName: "eth",
		nativeSymbol: "ETH",
		nativeName: "Ether",
		rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://eth.drpc.org"],
		mevRpcUrl: "https://rpc.flashbots.net/fast",
		explorer: "https://etherscan.io",
		wrappedNative: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
		dex: {
			name: "Uniswap V3",
			router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
			quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
			factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
			feeTiers: UNI_TIERS,
		},
		cctp: { domain: 0, ...CCTP_MAINNET },
		safeTxService: "https://api.safe.global/tx-service/eth",
	},
	{
		id: 999,
		key: "hyperevm",
		env: "mainnet",
		name: "HyperEVM",
		shortName: "hyperevm",
		nativeSymbol: "HYPE",
		nativeName: "Hyperliquid",
		rpcUrls: [
			"https://rpc.hyperliquid.xyz/evm",
			"https://hyperliquid.drpc.org",
			"https://hyperliquid-json-rpc.stakely.io",
		],
		explorer: "https://hyperevmscan.io",
		wrappedNative: "0x5555555555555555555555555555555555555555",
		usdc: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
		dex: {
			name: "HyperSwap V3",
			router: "0x6D99e7f6747AF2cDbB5164b6DD50e40D4fDe1e77",
			quoter: "0x03A918028f22D9E1473B7959C927AD7425A45C7C",
			factory: "0xB1c0fa0B789320044A6F623cFe5eBda9562602E3",
			feeTiers: UNI_TIERS,
		},
		cctp: { domain: 19, ...CCTP_MAINNET },
		safeTxService: "https://api.safe.global/tx-service/hyper",
	},
	{
		id: 42161,
		key: "arbitrum",
		env: "mainnet",
		name: "Arbitrum",
		shortName: "arb1",
		nativeSymbol: "ETH",
		nativeName: "Ether",
		rpcUrls: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com", "https://arbitrum.drpc.org"],
		explorer: "https://arbiscan.io",
		wrappedNative: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
		usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
		dex: {
			name: "Uniswap V3",
			router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
			quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
			factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
			feeTiers: UNI_TIERS,
		},
		cctp: { domain: 3, ...CCTP_MAINNET },
		safeTxService: "https://api.safe.global/tx-service/arb1",
	},
	{
		id: 8453,
		key: "base",
		env: "mainnet",
		name: "Base",
		shortName: "base",
		nativeSymbol: "ETH",
		nativeName: "Ether",
		rpcUrls: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
		explorer: "https://basescan.org",
		wrappedNative: "0x4200000000000000000000000000000000000006",
		usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
		dex: {
			name: "Uniswap V3",
			router: "0x2626664c2603336E57B271c5C0b26F421741e481",
			quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
			factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
			feeTiers: UNI_TIERS,
		},
		cctp: { domain: 6, ...CCTP_MAINNET },
		safeTxService: "https://api.safe.global/tx-service/base",
	},
	{
		id: 137,
		key: "polygon",
		env: "mainnet",
		name: "Polygon",
		shortName: "pol",
		nativeSymbol: "POL",
		nativeName: "POL",
		rpcUrls: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org", "https://polygon-rpc.com"],
		explorer: "https://polygonscan.com",
		wrappedNative: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
		// Native USDC issued by Circle, not the bridged USDC.e.
		usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
		dex: {
			name: "Uniswap V3",
			router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
			quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
			factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
			feeTiers: UNI_TIERS,
		},
		cctp: { domain: 7, ...CCTP_MAINNET },
		safeTxService: "https://api.safe.global/tx-service/pol",
	},
	{
		id: 11155111,
		key: "ethereum",
		env: "testnet",
		name: "Sepolia",
		shortName: "sep",
		nativeSymbol: "ETH",
		nativeName: "Sepolia Ether",
		rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.drpc.org"],
		explorer: "https://sepolia.etherscan.io",
		wrappedNative: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
		usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
		dex: {
			name: "Uniswap V3",
			router: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
			quoter: "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3",
			factory: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c",
			feeTiers: UNI_TIERS,
		},
		cctp: { domain: 0, ...CCTP_TESTNET },
		safeTxService: "https://api.safe.global/tx-service/sep",
	},
	{
		id: 998,
		key: "hyperevm",
		env: "testnet",
		name: "HyperEVM Testnet",
		shortName: "hyperevm-testnet",
		nativeSymbol: "HYPE",
		nativeName: "Hyperliquid",
		rpcUrls: ["https://rpc.hyperliquid-testnet.xyz/evm"],
		explorer: "https://testnet.purrsec.com",
		wrappedNative: "0x5555555555555555555555555555555555555555",
		usdc: "0x2B3370eE501B4a559b57D449569354196457D8Ab",
		dex: {
			name: "HyperSwap V3",
			router: "0x51c5958FFb3e326F8d7AA945948159f1FF27e14A",
			quoter: "0x7FEd8993828A61A5985F384Cee8bDD42177Aa263",
			factory: "0x22B0768972bB7f1F5ea7a8740BB8f94b32483826",
			weth: "0xADcb2f358Eae6492F61A5F87eb8893d09391d160",
			feeTiers: UNI_TIERS,
		},
		cctp: { domain: 19, ...CCTP_TESTNET },
	},
	{
		id: 421614,
		key: "arbitrum",
		env: "testnet",
		name: "Arbitrum Sepolia",
		shortName: "arb-sep",
		nativeSymbol: "ETH",
		nativeName: "Sepolia Ether",
		rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc", "https://arbitrum-sepolia-rpc.publicnode.com"],
		explorer: "https://sepolia.arbiscan.io",
		wrappedNative: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73",
		usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
		dex: {
			name: "Uniswap V3",
			router: "0x101F443B4d1b059569D643917553c771E1b9663E",
			quoter: "0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B",
			factory: "0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e",
			feeTiers: UNI_TIERS,
		},
		cctp: { domain: 3, ...CCTP_TESTNET },
	},
	{
		id: 84532,
		key: "base",
		env: "testnet",
		name: "Base Sepolia",
		shortName: "base-sep",
		nativeSymbol: "ETH",
		nativeName: "Sepolia Ether",
		rpcUrls: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
		explorer: "https://sepolia.basescan.org",
		wrappedNative: "0x4200000000000000000000000000000000000006",
		usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
		dex: {
			name: "Uniswap V3",
			router: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
			quoter: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
			factory: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
			feeTiers: UNI_TIERS,
		},
		cctp: { domain: 6, ...CCTP_TESTNET },
		safeTxService: "https://api.safe.global/tx-service/basesep",
	},
	{
		id: 80002,
		key: "polygon",
		env: "testnet",
		name: "Polygon Amoy",
		shortName: "amoy",
		nativeSymbol: "POL",
		nativeName: "POL",
		rpcUrls: ["https://polygon-amoy-bor-rpc.publicnode.com", "https://polygon-amoy.drpc.org"],
		explorer: "https://amoy.polygonscan.com",
		wrappedNative: "0x360ad4f9a9A8EFe9A8DCB5f461c4Cc1047E1Dcf9",
		usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
		// Uniswap is not deployed on Amoy: no swaps there, the USDC bridge works.
		cctp: { domain: 7, ...CCTP_TESTNET },
	},
];

export const CHAIN_KEYS: ChainKey[] = ["ethereum", "hyperevm", "arbitrum", "base", "polygon"];

const BY_ID = new Map(CHAINS.map((c) => [c.id, c]));

export const getChain = (id: number): ChainConfig => {
	const chain = BY_ID.get(id);
	if (!chain) throw new Error(`Unsupported chain ${id}`);
	return chain;
};

export const findChain = (id: number | undefined): ChainConfig | undefined =>
	id === undefined ? undefined : BY_ID.get(id);

export const chainFor = (key: ChainKey, env: NetworkEnv): ChainConfig =>
	CHAINS.find((c) => c.key === key && c.env === env) as ChainConfig;

export const chainsOf = (env: NetworkEnv): ChainConfig[] => CHAINS.filter((c) => c.env === env);

/** Chains used only as an EIP-712 `signatureChainId` for Hyperliquid user-signed actions. */
export const HL_SIGNATURE_CHAIN: Record<NetworkEnv, number> = {
	mainnet: 42161,
	testnet: 421614,
};

export const HL_API: Record<NetworkEnv, string> = {
	mainnet: "https://api.hyperliquid.xyz",
	testnet: "https://api.hyperliquid-testnet.xyz",
};

/** Explorer RPC: transaction details by hash (who sent it, the signed action). */
export const HL_EXPLORER_API: Record<NetworkEnv, string> = {
	mainnet: "https://rpc.hyperliquid.xyz/explorer",
	testnet: "https://rpc.hyperliquid-testnet.xyz/explorer",
};

export const HL_APP: Record<NetworkEnv, string> = {
	mainnet: "https://app.hyperliquid.xyz",
	testnet: "https://app.hyperliquid-testnet.xyz",
};

export const HL_EVM_CHAIN: Record<NetworkEnv, number> = { mainnet: 999, testnet: 998 };

/** Chain HL USDC withdrawals (`withdraw3`) arrive on. */
export const HL_BRIDGE_CHAIN: Record<NetworkEnv, number> = { mainnet: 42161, testnet: 421614 };

export const explorerTx = (chainId: number, hash: string): string => `${getChain(chainId).explorer}/tx/${hash}`;
export const explorerAddress = (chainId: number, address: string): string =>
	`${getChain(chainId).explorer}/address/${address}`;
