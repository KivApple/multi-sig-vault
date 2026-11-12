import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isAddress } from "viem";
import { expect, it } from "vitest";

/**
 * viem refuses an address whose mixed-case checksum is wrong, and it does so only when the address is
 * first used – a typo in one letter's case in the configuration breaks a whole feature on one network.
 */
it("every mixed-case address literal in the source has a valid checksum", () => {
	const bad: string[] = [];
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(ts|tsx|mjs|json)$/.test(path)) {
				for (const match of readFileSync(path, "utf8").matchAll(/"(0x[0-9a-fA-F]{40})"/g)) {
					const address = match[1];
					if (address !== address.toLowerCase() && !isAddress(address)) bad.push(`${path}: ${address}`);
				}
			}
		}
	};
	walk("src");
	expect(bad).toEqual([]);
});
