import { Plus } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Link } from "react-router";
import { CheckResult } from "@/components/addAccount/CheckResult";
import { ChoiceCard } from "@/components/addAccount/ChoiceCard";
import { NetworkFields } from "@/components/addAccount/NetworkFields";
import { useAccountCheck } from "@/components/addAccount/useAccountCheck";
import { useUrlState } from "@/components/addAccount/useUrlState";
import { AddressField } from "@/components/common/AddressField";
import { LinkNotice } from "@/components/common/LinkNotice";
import { TextField } from "@/components/common/TextField";
import { BrandIcon } from "@/components/icons/BrandIcon";
import { Field } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { chainFor, type ChainKey } from "@/config/chains";
import { useT } from "@/i18n";
import { parseAddress, sameAddress } from "@/lib/format";
import { useStackNav } from "@/lib/navStack";
import type { KnownAddress } from "@/lib/known";
import { accountId, useAppStore } from "@/store/appStore";
import type { AccountKind, NetworkEnv } from "@/types/domain";

/**
 * Adds an existing Hyperliquid account or Safe. The whole form lives in the URL
 * (`?kind=&env=&chain=&address=&name=`), so it survives reloads and can be opened pre-filled by the QR scanner.
 */
export const AddAccountPage: React.FC = () => {
	const t = useT();
	const { finishAt } = useStackNav();
	const { params, patch, env, chain } = useUrlState();
	const accounts = useAppStore((s) => s.accounts);
	const addAccount = useAppStore((s) => s.addAccount);
	const signers = useAppStore((s) => s.signers);

	const kindParam = params.get("kind");
	const kind: AccountKind | undefined = kindParam === "hl" || kindParam === "safe" ? kindParam : undefined;
	const addressInput = params.get("address") ?? "";
	const name = params.get("name") ?? "";
	const address = useMemo(() => parseAddress(addressInput), [addressInput]);
	const chainConfig = chainFor(chain, env);
	const network = kind === "hl" ? (env === "mainnet" ? "Hyperliquid" : "Hyperliquid Testnet") : chainConfig.name;

	const id = kind && address ? accountId(kind, kind === "hl" ? env : chainConfig.id, address) : undefined;
	const existing = useMemo(() => accounts.find((a) => a.id === id), [accounts, id]);

	// Addresses of accounts of the same type that are not yet added for the selected network.
	const known = useMemo<KnownAddress[]>(() => {
		if (!kind) return [];
		const scope = kind === "hl" ? env : chainConfig.id;
		const out: KnownAddress[] = [];
		for (const account of accounts) {
			if (account.kind !== kind || out.some((k) => sameAddress(k.address, account.address))) continue;
			if (accounts.some((a) => a.id === accountId(kind, scope, account.address))) continue;
			out.push({ address: account.address, account });
		}
		// An exchange account is an ordinary key, so any signer may own one (a Safe never is a signer).
		if (kind === "hl") {
			for (const signer of signers) {
				if (out.some((k) => sameAddress(k.address, signer.address))) continue;
				if (accounts.some((a) => a.id === accountId("hl", env, signer.address))) continue;
				out.push({ address: signer.address, signer });
			}
		}
		return out;
	}, [accounts, signers, kind, env, chainConfig.id]);

	const check = useAccountCheck({
		kind: kind ?? "hl",
		env,
		chainId: kind === "safe" ? chainConfig.id : undefined,
		address: kind ? address : undefined,
		skip: !!existing,
	});

	const setKind = useCallback((k: AccountKind) => patch({ kind: k }), [patch]);
	const setChain = useCallback((c: ChainKey) => patch({ chain: c }), [patch]);
	const setEnv = useCallback((e: NetworkEnv) => patch({ env: e }), [patch]);
	const setAddress = useCallback((a: string) => patch({ address: a }), [patch]);
	const setName = useCallback((n: string) => patch({ name: n }), [patch]);

	const canAdd = check.status === "ok" && !!id && !!address && !!kind && !existing;

	const handleAdd = useCallback(() => {
		if (!canAdd || !id || !address || !kind) return;
		addAccount({
			id,
			kind,
			env,
			chainId: kind === "safe" ? chainConfig.id : undefined,
			address,
			name: name.trim() || undefined,
			hidden: false,
			hideDust: false,
			addedAt: Date.now(),
		});
		finishAt(`/account/${encodeURIComponent(id)}`);
	}, [canAdd, id, address, kind, env, chainConfig.id, name, addAccount, finishAt]);

	const addressError = addressInput && !address ? t("error.invalidAddress") : undefined;

	return (
		<>
			<PageHeader title={t("addAccount.title")} back="/" />
			<LinkNotice />
			<div className="flex flex-col gap-4">
				<Field label={t("addAccount.type")}>
					<div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("addAccount.type")}>
						<ChoiceCard
							selected={kind === "hl"}
							onSelect={() => setKind("hl")}
							icon={<BrandIcon name="hyperliquid" size={36} />}
							title="Hyperliquid"
							subtitle={t("addAccount.hlHint")}
						/>
						<ChoiceCard
							selected={kind === "safe"}
							onSelect={() => setKind("safe")}
							icon={<BrandIcon name="safe" size={36} />}
							title="Safe"
							subtitle={t("addAccount.safeHint")}
						/>
					</div>
				</Field>

				{kind && (
					<>
						<NetworkFields showChain={kind === "safe"} chain={chain} env={env} onChain={setChain} onEnv={setEnv} />
						{/* Remount when the scope changes so the picker/manual mode matches the new known list. */}
						<AddressField
							key={`${kind}|${env}|${chain}`}
							label={t("addAccount.address")}
							value={addressInput}
							onChange={setAddress}
							known={known}
							error={addressError}
						/>
						<CheckResult
							check={check}
							network={network}
							notice={
								existing && (
									<span>
										{t("addAccount.alreadyAdded")}{" "}
										<Link className="link" to={`/account/${encodeURIComponent(existing.id)}`}>
											{t("common.open")}
										</Link>
									</span>
								)
							}
						/>
						{check.status === "ok" && !existing && (
							<TextField
								label={`${t("common.name")} · ${t("common.optional")}`}
								value={name}
								onChange={setName}
								maxLength={40}
							/>
						)}
						<button type="button" className="btn btn-primary" disabled={!canAdd} onClick={handleAdd}>
							{t("addAccount.submit")}
						</button>
						{kind === "safe" && (
							<Link className="btn btn-ghost" to={`/accounts/create-safe?chain=${chain}&env=${env}`}>
								<Plus className="size-4" />
								{t("addAccount.createSafe")}
							</Link>
						)}
					</>
				)}
			</div>
		</>
	);
};
