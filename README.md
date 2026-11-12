# Multi Sig Vault

**[multi-sig.quoi.dev](https://multi-sig.quoi.dev)**

A PWA for operating Hyperliquid multi-sig accounts and Safe wallets on Ethereum, HyperEVM, Arbitrum and Base (mainnet and testnet).

It is built for signers who are never in the same place. You sign with the first key, carry the operation to the second device as a QR code, sign there, and broadcast from wherever you end up. Keys stay on MetaMask, Trezor and Ledger; the network is needed only to read balances and to send.

The code was written with AI, directed and reviewed by a developer with many years of hands-on programming experience.

## Don't trust, verify

This app builds the payloads your wallets sign, so a backdoor in it could drain every account it touches. Do not take the author's word that there is none: before using it, point your own AI agent at this repository and have it audit the code and dependencies for swapped recipients, altered payloads, key exfiltration and unexpected network calls. Then build from the commit you reviewed instead of using a copy somebody else hosts.

## What it does

**Accounts**

- Hyperliquid: plain and multi-sig accounts in standard, unified and portfolio margin modes.
- Safe 1.3.0, 1.4.1 and 1.5.0.
- Balances refresh every 30 seconds and stay visible offline from cache.

**Signers**

- MetaMask: the browser extension on desktop, the MetaMask app on Android.
- Trezor, with the same derivation paths as Trezor Suite.
- Ledger, with the same derivation paths as Ledger Live.

**Hyperliquid operations**

- Withdraw and send USDC, send spot tokens, move funds between perps and spot.
- Withdraw spot assets to their native chain through Unit (BTC, ETH, SOL and others) or to HyperEVM.
- Approve and revoke agent keys, and log in to the exchange web UI by link or QR. A key is valid for a chosen term: 1, 7, 30, 90 (default) or 180 days, or any number of days up to the 180 the exchange allows.
- Create and manage sub-accounts.
- Convert an account to multi-sig, change its signers, or convert it back.

**Safe operations**

- Send native coins and tokens.
- Every transaction the app sends offers a slower and a faster fee, taken from the tips recent blocks accepted. One that stays unconfirmed can be sent again with the same signatures.
- Swap on Uniswap V3 (HyperSwap V3 on HyperEVM), quoted directly from the pools.
- Bridge USDC between any two supported chains through Circle CCTP V2.
- Change owners and threshold.
- Call a contract by ABI, deploy a contract, sign a message hash (EIP-1271).

**Creating a Safe**

- At a new address.
- At the same address as an existing Safe on another chain.
- At a vanity address: the app prints the command for `deadbeef` and parses its output.

**Moving an operation between devices**

- An operation is exported as a QR code, animated when it does not fit in one frame.
- QR is the only export channel, because an operation may carry an agent private key.
- One scanner on the home screen accepts addresses and operations. Imports are deduplicated by UUID and their signatures merged.

## Deep links

A link can open the form for adding an account or creating a Safe already filled in:

```
https://multi-sig.quoi.dev/#/link?action=add&kind=hl&env=testnet&address=0x…&name=Desk
https://multi-sig.quoi.dev/#/link?action=add&kind=safe&chain=base&address=0x…
https://multi-sig.quoi.dev/#/link?action=create&chain=arbitrum&owners=0x…,0x…&threshold=2&name=Treasury
https://multi-sig.quoi.dev/#/link?action=create&chain=base&mode=vanity&owners=0x…,0x…&threshold=2&prefix=0xdead
```

| Parameter | Used by | Values |
|---|---|---|
| `action` | both | `add` (existing account) or `create` (new Safe) |
| `kind` | `add` | `hl` or `safe` |
| `chain` | Safe | `ethereum`, `hyperevm`, `arbitrum`, `base` |
| `env` | both | `mainnet` (default) or `testnet` |
| `address`, `name` | `add` | account address and an optional name |
| `owners`, `threshold`, `name` | `create` | comma-separated owner addresses, signatures required, optional name |
| `mode` | `create` | `new` (default), `copy` (same address as a Safe on another chain) or `vanity` |
| `salt` | `create` | decimal salt nonce, to reproduce an exact address in `new` mode |
| `prefix` | `create` | hex address prefix for `vanity` mode |

A link only fills the form. The form says it came from a link, every field can be changed, and nothing is added or created until you confirm. Unknown parameters are ignored. Links can be turned off in settings.

## How signing is protected

1. The first signature freezes the operation. Quotes, nonces and fees are resolved, and the payload is built from them.
2. Building a payload is a pure, deterministic function. Before every signature, before broadcast and on import, the payload is rebuilt from the parameters shown on screen and compared with the stored one. A mismatch blocks the operation.
3. Every signature is checked by recovering its address. An imported operation with an invalid signature is rejected whole.
4. Safe transactions are simulated before signing and before sending (`SimulateTxAccessor`, `eth_estimateGas`).
5. Unit deposit addresses are accepted only with valid guardian signatures (2 of 3), verified in the app each time the operation is built.

The app stores no private keys, with one exception: a Hyperliquid agent key you ask it to generate. That key is kept in IndexedDB, encrypted with a non-extractable WebCrypto key, and is erased together with the result card.

Wherever the wallet supports it, operations are signed as structured EIP-712 data that the device can display. For Ledger, the "clear signing" setting (on by default) allows fetching field descriptors from Ledger's servers. The order of attempts is fields with descriptors, then fields without, then blind signing only when the device accepts nothing else.

The production build ships a strict CSP with no inline or third-party scripts. External data (token lists, API responses, QR contents) is validated, and remote SVGs are rendered only through `<img>`.

## MetaMask on a phone

In Chrome on a phone the app cannot talk to the MetaMask app directly, and Android freezes the page while MetaMask is in front, so answers sent to it get lost. Instead the request is handed to the app's own signing page inside MetaMask's built-in browser, where the wallet is part of the page:

1. The app encrypts the request (AES-256-GCM) and leaves it on a small relay (`relay/server.mjs`).
2. You tap "Open MetaMask". The signing page opens in MetaMask's browser, decrypts the request, shows it and asks MetaMask.
3. The encrypted answer goes back through the relay, and the app picks it up when you return.

The key belongs to the connection between your app and your MetaMask browser. On first use the app shows a six-digit code that you type into the signing page; from then on both sides hold a shared key, and each request is encrypted with a key derived from it for that one request. The signing page shows only what it can decrypt with that key, so a link somebody sends you cannot ask you to sign anything: it ends in an error.

The relay is a blind mailbox. It sees ciphertext only, cannot read or change a request or an answer without failing authentication, keeps a session in memory for ten minutes and logs nothing. The worst it can do is lose a message. Every signature is still verified against the signer's address. The desktop extension and MetaMask's own browser need no relay; a copy of the app hosted without one falls back to MetaMask SDK.

## Offline use and updates

The service worker (`public/sw.js`) is the same file in every release and serves only the files of the active release. A new version is downloaded by the running app, each file is checked against its SHA-256, and it is activated only after you agree.

Every published release stays on the server at `releases/<id>/`, and `releases.json` lists them newest first. That gives two update channels from one deployment:

- **Stable** (the default). The app installs the newest release the developer's Safe approved on-chain, and only moves to a higher version. The site root serves the same release, so a first-time visitor gets it too.
- **Test versions** (a switch in settings). The app installs the newest release, signed or not.

Nothing changes on the server when a release gets signed: clients ask the chain which listed release is approved.

```bash
PUBLIC_RELEASE_SAFE=0x… PUBLIC_RELEASE_CHAIN_ID=1 pnpm build
pnpm release:info   # release id, digest and the transaction for the developer's Safe
```

The developer's Safe executes `SignMessageLib.signMessage(digest)`; in the app this is the "Sign message hash" operation. Clients call `isValidSignature(digest, "")` (EIP-1271) on two independent RPC endpoints. A build without these variables has no stable channel and follows the newest release. `scripts/release/publish.sh` is the deployment: it uploads the build, extends the list and puts the newest approved release at the root.

## Tech stack

- TypeScript, React 19, React Router (hash routing)
- Rsbuild, Tailwind CSS 4, DaisyUI 5
- zustand, persisted to IndexedDB and synced between tabs over BroadcastChannel
- viem for EVM, `@msgpack/msgpack` and `@noble/curves` for Hyperliquid and Unit
- `@metamask/sdk`, `@trezor/connect-web`, `@ledgerhq/hw-app-eth` over WebHID and WebUSB
- vitest, Biome, pnpm

There is no backend. The app talks directly to chain RPC endpoints and to the Hyperliquid, Unit, Circle and Safe transaction service APIs.

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

## Limitations

- **Hyperliquid L1 actions** (creating and renaming a sub-account) are signed in a domain with chainId 1337, which MetaMask refuses. They need a Ledger or Trezor, and they are signed as a hash.
- **Spot withdrawal to HyperEVM** always arrives at the same address. For a multi-sig account, that address on HyperEVM is controlled by the original key. The app warns about this.
- **Unit minimum amounts** are taken from the Unit documentation, not from an API.
- **Trezor** opens a Trezor Connect window, which needs either network access or a running Trezor Suite. **Ledger** connects directly and works offline.
- **MetaMask on a phone** signs in MetaMask's built-in browser, reached through the relay described above, and needs network access. To work fully offline, open the whole app in MetaMask's browser and move operations by QR.
- **MEV protection** (Flashbots Protect) applies to Ethereum transactions signed with Ledger or Trezor. MetaMask broadcasts its own transactions.
- **USDC bridge**: by default Circle's Forwarding Service delivers the funds, and the fee is taken exactly from Circle's API. If delivery does not happen, the result card lets any signer pay the gas for it.
- The first install, and any change to `sw.js` itself, cannot be covered by the on-chain release check. This is a limitation of the web platform.

## Project layout

```
src/config        chains and contract addresses
src/lib/hl        Hyperliquid: API, account data, signing, Unit
src/lib/safe      Safe: transactions, simulation, creation
src/lib/evm       DEX quotes, CCTP, ABIs
src/lib/ops       operations: registry, engine (freeze, verify, send), transfer
src/lib/wallets   MetaMask, Trezor and Ledger adapters
src/lib/qr        QR: addresses, packing, frames
src/lib/tokens    token lists and icons
src/lib/update    offline releases and signature check
src/lib/handoff   encrypted hand-off to MetaMask's browser
relay             the blind relay server for it
src/components    one component per file
src/i18n          en and ru
scripts           icons, token lists, dictionaries, release.json
```

To add a chain, add an entry to `src/config/chains.ts` and an icon. To add an operation, add a definition file and a line in `src/lib/ops/registry.ts`.

## License

[MIT](LICENSE)
