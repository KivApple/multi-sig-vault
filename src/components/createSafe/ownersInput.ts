import type { Address } from "viem";
import type { TFunc } from "@/i18n";
import { parseAddress } from "@/lib/format";

export interface OwnersInput {
	/** Checksummed owners when every row is valid, otherwise `undefined`. */
	owners?: Address[];
	errors: Record<string, string>;
}

/** Validates the rows of an owners editor: addresses, duplicates, threshold. */
export const checkOwnersInput = (rows: string[], threshold: number, t: TFunc): OwnersInput => {
	const errors: Record<string, string> = {};
	const owners: Address[] = [];
	const seen = new Set<string>();
	rows.forEach((row, i) => {
		const address = parseAddress(row);
		if (!row.trim()) errors[`owner${i}`] = t("error.required");
		else if (!address) errors[`owner${i}`] = t("error.invalidAddress");
		else if (seen.has(address.toLowerCase())) errors[`owner${i}`] = t("createSafe.error.duplicateOwner");
		else {
			seen.add(address.toLowerCase());
			owners.push(address);
		}
	});
	if (Object.keys(errors).length > 0) return { errors };
	if (threshold < 1 || threshold > owners.length) return { errors: { threshold: t("createSafe.error.threshold") } };
	return { owners, errors };
};
