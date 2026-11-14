# Development

[← README](../README.md)

How to run the app, where things are, and how to add to it. Two more pages describe parts in detail: [the relay for MetaMask on a phone](relay.md) and [offline use and updates](releases.md).

## Running

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # production build in dist/, with release.json
pnpm preview
pnpm test      # unit tests, offline
pnpm format    # Biome: tabs, double quotes
```

Fork tests need `anvil` and network access:

```bash
MSV_FORK=1 pnpm vitest run tests/*.fork.test.ts
```

## Project layout

```
src/config        chains and contract addresses
src/lib/hl        Hyperliquid: API, account data, signing, Unit
src/lib/safe      Safe: transactions, simulation, creation
src/lib/evm       swap and bridge operation; providers in swaps/ and bridges/; ABIs
src/lib/ops       operations: registry, engine (freeze, verify, send), transfer
src/lib/wallets   MetaMask, Trezor and Ledger adapters
src/lib/qr        QR: addresses, packing, frames
src/lib/tokens    token lists and icons
src/lib/update    offline releases and signature check
src/lib/history   account history: Hyperliquid ledger and explorer, Safe Transaction Service
src/lib/handoff   encrypted hand-off to MetaMask's browser
relay             the relay server: blind mailbox for the hand-off, cached exchange icons
src/components    one component per file
src/i18n          en and ru
scripts           icons, token lists, dictionaries, release.json
```

## Adding an operation

An operation is one definition file (`OpDefinition` in `src/lib/ops/types.ts`: its form, validation, the pure function that builds the payload, the summary signers read) and a line in `src/lib/ops/registry.ts`. The engine freezes it at the first signature, rebuilds and compares the payload before every later step, and sends it.

## Adding a network

Any EVM network works where the canonical Safe 1.4.1 contracts and Multicall3 are deployed at their usual addresses (`src/lib/safe/deployments.ts`, `src/config/constants.ts`). Check that first, with `eth_getCode` on the network itself: the app assumes those addresses and has no per-network overrides.

1. **`src/config/chains.ts`**: add an entry to `CHAINS` for mainnet and, if there is one, for testnet. A new network also needs its key in `ChainKey` and `CHAIN_KEYS`; a testnet shares the key of its mainnet. Required: id, names, the native coin, the explorer, the wrapped native token and two or three public RPC endpoints. The endpoints are called from the browser, so they must answer cross-origin requests.
2. **What the network can do**, all optional, in the same entry:
   - `dex`: a Uniswap V3 style router, quoter and factory with their fee tiers. Without it there are no swaps and tokens are not valued.
   - `usdc` and `cctp`: Circle's USDC and its CCTP domain. Only USDC issued by Circle belongs here.
   - `quote`: the dollar token balances are valued in, where the network's liquidity is not in USDC.
   - `across`: the Across pool and the tokens it takes there.
   - `safeTxService`: the Safe Transaction Service, for history and for resolving how a Safe was created.
   - `mevRpcUrl`, `legacyTx`: a private transaction endpoint; a network without EIP-1559.
3. **Icons**: add the network mark in `scripts/tokens/extract-icons.mjs` (from the icon pack, or the network's own file in `scripts/tokens/official`), add the network's id to the list of networks whose token icons are packed, run `pnpm tokens:icons`, and add the new file to `src/components/icons/NetworkIcon.tsx`.
4. **Tokens**: `pnpm tokens:list` rebuilds the built-in token list for every network in `CHAINS`. If Trust Wallet's assets have a folder for the network, add it to `MIRROR_FOLDER` in `src/lib/tokens/sanitize.ts` as a second source of token logos.
5. **[README](../README.md)**: the table of supported networks, and the `chain` values of deep links.

Verify what you configured against the network, not against documentation: that the router and the quoter name the factory and the wrapped token you wrote down, and that the pools are deep enough to price by. A thin pool values a balance at a fraction of what it is worth; on BNB Chain that ruled out Uniswap and USDC in favour of PancakeSwap and USDT. Then run the swap on a fork: `tests/swap.fork.test.ts` has a suite per network (`MSV_FORK=1 MSV_FORK_CHAINS=<id>`), and a new one takes a few lines.

## Adding a DEX or a bridge

A swap or a transfer to another network is one operation made of two optional legs: an exchange on the Safe's own network, then a crossing. Each leg belongs to a provider, and `src/lib/evm/swapBuild.ts` only puts them together.

- A **bridge** is a `BridgeProvider` (`src/lib/evm/bridges/types.ts`): what it carries between which networks, how its leg is quoted, how the Safe's calls are built from the stored leg, how the leg reads in the summary, and when the transfer is finished. Add the provider to `BRIDGES`, a field for its leg to `SwapResolved`, and its sent card and form options to `BRIDGE_UI` (`src/components/ops/safe/bridgeUi.tsx`). Routing (`bridgeRoutes`) then offers its lanes by itself.
- A **DEX** is a `SwapProvider` (`src/lib/evm/swaps/types.ts`), added to `SWAPS`. A fork of Uniswap V3's router needs only a `dex` entry in `src/config/chains.ts`.

A provider fits only if the app can build its transaction itself from what is stored with the operation, and that transaction stays valid for as long as signatures take to collect. A service whose API returns ready calldata with a quote that expires within the hour does not fit: signers could neither check it nor finish in time.
