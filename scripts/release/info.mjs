// Prints what the developer multi-sig has to execute to approve the built release.
// Usage: pnpm build && pnpm release:info [-- path/to/release.json]
import { readFile } from "node:fs/promises";
import {
	RELEASE_DIGEST_PREFIX,
	SIGN_MESSAGE_LIB,
	isValidSignatureCalldata,
	releaseDigest,
	signMessageCalldata,
	verifyManifest,
} from "../../src/lib/update/releaseCore.mjs";

const file = process.argv[2] ?? new URL("../../dist/release.json", import.meta.url);
const manifest = await verifyManifest(JSON.parse(await readFile(file, "utf8")));
const digest = releaseDigest(manifest.id);
const safe = process.env.PUBLIC_RELEASE_SAFE ?? "<PUBLIC_RELEASE_SAFE>";
const chain = process.env.PUBLIC_RELEASE_CHAIN_ID ?? "<PUBLIC_RELEASE_CHAIN_ID>";

console.log(`Release ${manifest.version}
  id      ${manifest.id}
  files   ${manifest.files.length}
  digest  ${digest}
          = keccak256(utf8(${JSON.stringify(RELEASE_DIGEST_PREFIX)} + id))

Approve it with the developer Safe ${safe} on chain ${chain}.
Execute ONE Safe transaction (requires the Safe's threshold of owner signatures):

  to         SignMessageLib of the Safe's version:
               ${SIGN_MESSAGE_LIB["1.4.1"]}  (Safe 1.4.1)
               ${SIGN_MESSAGE_LIB["1.3.0"]}  (Safe 1.3.0)
               ${SIGN_MESSAGE_LIB["1.3.0-eip155"]}  (Safe 1.3.0, EIP-155 deployment)
  value      0
  operation  1 (DELEGATECALL)
  data       ${signMessageCalldata(digest)}
             = signMessage(bytes) with the 32-byte digest as the message

The app then verifies (EIP-1271, empty signature):

  eth_call to ${safe}
  data ${isValidSignatureCalldata(digest)}
  expected result starts with 0x1626ba7e

Check it yourself:
  cast call ${safe} "isValidSignature(bytes32,bytes)(bytes4)" ${digest} 0x --rpc-url <rpc>
`);
