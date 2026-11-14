# Offline use and updates

[← README](../README.md)

The service worker (`public/sw.js`) is the same file in every release and serves only the files of the active release. A new version is downloaded by the running app, each file is checked against its SHA-256, and it is activated only after you agree.

Every published release stays on the server at `releases/<id>/`, and `releases.json` lists them newest first. That gives two update channels from one deployment:

- **Stable** (the default). The app installs the newest release the developer's Safe approved on-chain, and only moves to a higher version. The site root serves the same release, so a first-time visitor gets it too.
- **Test versions** (a switch in settings). The app installs the newest release, signed or not.

Nothing changes on the server when a release gets signed: clients ask the chain which listed release is approved.

```bash
PUBLIC_RELEASE_SAFE=0x… PUBLIC_RELEASE_CHAIN_ID=999,1 pnpm build
pnpm release:info   # release id, digest and the transaction for the developer's Safe
```

The developer's Safe executes `SignMessageLib.signMessage(digest)`; in the app this is the "Sign message hash" operation. Clients call `isValidSignature(digest, "")` (EIP-1271) on two independent RPC endpoints of each network listed in `PUBLIC_RELEASE_CHAIN_ID`, and an approval on any one of them is enough. This is sound because a Safe's address commits to the signers it was created with: at the same address on another network there can only be a Safe that started with those signers. One consequence to keep in mind: a signer removed later still counts on a network where the Safe has not been created yet, so after changing signers, create the Safe on every listed network and change them there too. A build without these variables has no stable channel and follows the newest release. `scripts/release/publish.sh` is the deployment: it uploads the build, extends the list and puts the newest approved release at the root.
