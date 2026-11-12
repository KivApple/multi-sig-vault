import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { useParams } from "react-router";
import { Notice } from "@/components/common/Notice";
import { chainFor, CHAIN_KEYS } from "@/config/chains";
import { useT } from "@/i18n";
import { metamaskUsesApp } from "@/lib/wallets/metamask";
import { useAppStore } from "@/store/appStore";

/**
 * Chrome on a phone talks to the MetaMask app through a relay socket, and Android freezes the tab – and the
 * socket – while MetaMask is in front, so answers get lost. Inside MetaMask's own browser the wallet is
 * injected into the page and nothing can be lost. The link opens this app there, on the "add this account" form.
 */
export const MetaMaskBrowserHint: React.FC = () => {
	const t = useT();
	const { id } = useParams();
	const account = useAppStore((s) => s.accounts.find((a) => a.id === id));

	const href = useMemo(() => {
		const query = new URLSearchParams();
		if (account) {
			query.set("action", "add");
			query.set("kind", account.kind);
			query.set("env", account.env);
			const chain = CHAIN_KEYS.find((key) => chainFor(key, account.env).id === account.chainId);
			if (chain) query.set("chain", chain);
			query.set("address", account.address);
			if (account.name) query.set("name", account.name);
		}
		const { host, pathname } = window.location;
		return `https://link.metamask.io/dapp/${host}${pathname}${account ? `#/link?${query}` : ""}`;
	}, [account]);

	if (!metamaskUsesApp()) return null;
	return (
		<Notice tone="warning" className="mt-3">
			<p>{t("wallets.mmBrowser.text")}</p>
			<a className="btn btn-sm mt-2" href={href}>
				<ExternalLink className="size-4" />
				{t("wallets.mmBrowser.open")}
			</a>
		</Notice>
	);
};
