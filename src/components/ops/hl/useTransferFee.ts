import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { parseAddress } from "@/lib/format";
import { hlTransferCheck } from "@/lib/hl/account";
import type { Account } from "@/types/domain";

/**
 * Asks the exchange what sending to `destination` costs (a new account costs an activation fee)
 * and returns a ready hint; `undefined` while unknown or free.
 */
export const useTransferFee = (account: Account, destination: string): string | undefined => {
	const t = useT();
	const [hint, setHint] = useState<string>();
	useEffect(() => {
		setHint(undefined);
		const address = parseAddress(destination);
		if (!address || !navigator.onLine) return undefined;
		let stale = false;
		const timer = setTimeout(() => {
			hlTransferCheck(account.env, account.address, address)
				.then((res) => {
					if (stale) return;
					if (res.isSanctioned) setHint(t("hl.transfer.sanctioned"));
					else if (Number(res.fee) > 0) setHint(t("hl.transfer.activationFee", { fee: res.fee }));
				})
				.catch(() => undefined);
		}, 400);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	}, [account.env, account.address, destination, t]);
	return hint;
};
