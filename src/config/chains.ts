import type { Address } from "viem";
import type { NetworkEnv } from "@/types/domain";

export type ChainKey = "ethereum" | "hyperevm" | "arbitrum" | "base" | "polygon" | "bnb";

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

/** What the Across bridge carries between the networks of this app as the same asset. */
export type AcrossAsset = "USDT" | "WETH" | "WBTC";
export const ACROSS_ASSETS: AcrossAsset[] = ["USDT", "WETH", "WBTC"];

export interface AcrossToken {
	address: Address;
	decimals: number;
}

/**
 * The Across bridge on a network: its pool contract and the tokens it takes there. A token crosses
 * to another network as itself when both list the asset. It is also the only way to and from
 * BNB Chain, which has no USDC of Circle's.
 */
export interface AcrossConfig {
	spokePool: Address;
	tokens: Partial<Record<AcrossAsset, AcrossToken>>;
}

export type BridgeKind = "cctp" | "across";

export interface QuoteToken {
	address: Address;
	decimals: number;
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
	/** Circle's USDC (6 decimals): what the bridge moves, and what balances are valued in unless `quote` says otherwise. */
	usdc?: Address;
	/**
	 * The dollar token balances are valued in and swaps are routed through, where that is not USDC:
	 * a network whose liquidity sits in another stablecoin.
	 */
	quote?: QuoteToken;
	dex?: DexConfig;
	cctp?: CctpConfig;
	across?: AcrossConfig;
	/** Safe Transaction Service base URL (used only to resolve creation parameters). */
	safeTxService?: string;
	/** Legacy (non EIP-1559) transactions only. */
	legacyTx?: boolean;
}

const UNI_TIERS = [100, 500, 3000, 10000];
/** PancakeSwap V3 has a 0.25% tier where Uniswap has 0.3%. */
const PANCAKE_TIERS = [100, 500, 2500, 10000];

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
 * Adding a network: an entry here, its icon and its tokens – the steps, and what to verify on the
 * network itself first, are in docs/development.md ("Adding a network").
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
		across: {
			spokePool: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
			tokens: {
				USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
				WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
				WBTC: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
			},
		},
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
		across: {
			spokePool: "0x35E63eA3eb0fb7A3bc543C71FB66412e1F6B0E04",
			tokens: {
				USDT: { address: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", decimals: 6 },
			},
		},
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
		across: {
			spokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
			tokens: {
				USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
				WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
				WBTC: { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8 },
			},
		},
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
		across: {
			spokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
			tokens: {
				USDT: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
				WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
			},
		},
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
		across: {
			spokePool: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096",
			tokens: {
				USDT: { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
				WETH: { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 },
				WBTC: { address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8 },
			},
		},
		safeTxService: "https://api.safe.global/tx-service/pol",
	},
	{
		id: 56,
		key: "bnb",
		env: "mainnet",
		name: "BNB Chain",
		shortName: "bnb",
		nativeSymbol: "BNB",
		nativeName: "BNB",
		rpcUrls: [
			"https://bsc-dataseed.bnbchain.org",
			"https://bsc-rpc.publicnode.com",
			"https://bsc-dataseed1.binance.org",
		],
		explorer: "https://bscscan.com",
		wrappedNative: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
		// No USDC of Circle's here (the "USDC" of this network is a Binance-pegged token with 18 decimals),
		// so no CCTP: USDT crosses through Across instead. Liquidity sits in USDT on PancakeSwap: Uniswap's
		// pools here are too thin to price by.
		quote: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
		across: {
			spokePool: "0x4e8E101924eDE233C13e2D8622DC8aED2872d505",
			tokens: {
				// WETH here is Binance-pegged ETH, an ordinary token.
				USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
				WETH: { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
			},
		},
		dex: {
			name: "PancakeSwap V3",
			router: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
			quoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
			factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
			feeTiers: PANCAKE_TIERS,
		},
		safeTxService: "https://api.safe.global/tx-service/bnb",
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
	{
		id: 97,
		key: "bnb",
		env: "testnet",
		name: "BNB Testnet",
		shortName: "bnbt",
		nativeSymbol: "BNB",
		nativeName: "Testnet BNB",
		rpcUrls: [
			"https://bsc-testnet-rpc.publicnode.com",
			"https://bsc-testnet-dataseed.bnbchain.org",
			"https://data-seed-prebsc-1-s1.bnbchain.org:8545",
		],
		explorer: "https://testnet.bscscan.com",
		wrappedNative: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
		// Safes and transfers only: no swaps and no bridge on this testnet.
	},
];

export const CHAIN_KEYS: ChainKey[] = ["ethereum", "hyperevm", "arbitrum", "base", "polygon", "bnb"];

/** The dollar token of a chain: its `quote`, else its USDC. */
export const quoteTokenOf = (chain: ChainConfig): QuoteToken | undefined =>
	chain.quote ?? (chain.usdc ? { address: chain.usdc, decimals: 6 } : undefined);

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

/**
 * Hyperliquid's bridge on that chain. USDC sent to it is a deposit to the exchange in the name of the
 * sender – for a Safe, an exchange account nobody holds a key of – and under 5 USDC is lost outright.
 */
export const HL_BRIDGE: Record<NetworkEnv, Address> = {
	mainnet: "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7",
	testnet: "0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89",
};

/** Chain HL USDC withdrawals (`withdraw3`) arrive on. */
export const HL_BRIDGE_CHAIN: Record<NetworkEnv, number> = { mainnet: 42161, testnet: 421614 };

export const explorerTx = (chainId: number, hash: string): string => `${getChain(chainId).explorer}/tx/${hash}`;
export const explorerAddress = (chainId: number, address: string): string =>
	`${getChain(chainId).explorer}/address/${address}`;
