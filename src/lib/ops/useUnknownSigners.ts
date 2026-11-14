import { useMemo } from "react";
import type { Address } from "viem";
import { useT } from "@/i18n";
import { parseAddress, sameAddress, shortAddress } from "@/lib/format";
import type { Signer } from "@/types/domain";
import type { OpEnv, OpNotices } from "./types";

/**
 * A signer nobody holds the key of cannot sign, and neither the Safe contract nor the exchange can
 * tell such an address from a real one: with enough of them an account can no longer be operated.
 * The app knows the keys of its own signers only, so it asks about every other address that is about
 * to become one.
 */
export const unknownSigners = (added: string[], signers: Signer[]): Address[] =>
	added.map((a) => parseAddress(a)).filter((a): a is Address => !!a && !signers.some((s) => sameAddress(s.address, a)));

export const useUnknownSigners = (added: string[], env: OpEnv): OpNotices => {
	const t = useT();
	const { signers } = env;
	return useMemo(() => {
		const unknown = unknownSigners(added, signers);
		if (unknown.length === 0) return { notices: [] };
		return {
			notices: [
				{
					// A tick is for these addresses: another set is asked about again.
					id: `signers:${unknown.join(",").toLowerCase()}`,
					text: t("owners.unknownNote", { list: unknown.map((a) => shortAddress(a)).join(", ") }),
					confirm: t("owners.unknownConfirm"),
				},
			],
		};
	}, [added, signers, t]);
};
