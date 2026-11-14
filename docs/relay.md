# MetaMask on a phone

[← README](../README.md)

In Chrome on a phone the app cannot talk to the MetaMask app directly, and Android freezes the page while MetaMask is in front, so answers sent to it get lost. Instead the request is handed to the app's own signing page inside MetaMask's built-in browser, where the wallet is part of the page:

1. The app encrypts the request (AES-256-GCM) and leaves it on a small relay (`relay/server.mjs`).
2. You tap "Open MetaMask". The signing page opens in MetaMask's browser, decrypts the request, shows it and asks MetaMask.
3. The encrypted answer goes back through the relay, and the app picks it up when you return.

The key belongs to the connection between your app and your MetaMask browser. On first use the app shows a six-digit code that you type into the signing page; from then on both sides hold a shared key, and each request is encrypted with a key derived from it for that one request. The signing page shows only what it can decrypt with that key, so a link somebody sends you cannot ask you to sign anything: it ends in an error.

The relay is a blind mailbox. It sees ciphertext only, cannot read or change a request or an answer without failing authentication, keeps a session in memory for ten minutes and writes no logs of its own (the proxy in front of the hosted one keeps access logs: IP address, time, the random session id). The worst it can do is lose a message. Every signature is still verified against the signer's address. The desktop extension and MetaMask's own browser need no relay; a copy of the app hosted without one falls back to MetaMask SDK.
