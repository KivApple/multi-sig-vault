import { CircleAlert, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { Address } from "viem";
import { NetworkFields } from "@/components/addAccount/NetworkFields";
import { useUrlState } from "@/components/addAccount/useUrlState";
import { LinkNotice } from "@/components/common/LinkNotice";
import { TextField } from "@/components/common/TextField";
import { AddressPreview } from "@/components/createSafe/AddressPreview";
import { CopyPanel } from "@/components/createSafe/CopyPanel";
import { DeploymentStatus } from "@/components/createSafe/DeploymentStatus";
import { NewAddressPanel } from "@/components/createSafe/NewAddressPanel";
import { OwnersSummary } from "@/components/createSafe/OwnersSummary";
import { checkOwnersInput } from "@/components/createSafe/ownersInput";
import { TargetNotice } from "@/components/createSafe/TargetNotice";
import { useDeployment, type DeploymentPlan } from "@/components/createSafe/useDeployment";
import { useDraft, type CreateMode } from "@/components/createSafe/useDraft";
import { useTargetState } from "@/components/createSafe/useTargetState";
import { VanityPanel } from "@/components/createSafe/VanityPanel";
import { SignerPickerDialog } from "@/components/ops/SignerPickerDialog";
import { Field } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import { chainFor, type ChainKey } from "@/config/chains";
import { useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { sameAddress } from "@/lib/format";
import { getPublicClient } from "@/lib/rpc";
import {
	defaultCreation,
	encodeCreateProxy,
	predictSafeAddress,
	randomSaltNonce,
	validateCreation,
	type CheckedCreation,
} from "@/lib/safe/deploy";
import { parseMinerOutput } from "@/lib/safe/vanity";
import { accountId, useAppStore } from "@/store/appStore";
import type { NetworkEnv, SafeCreation, Signer } from "@/types/domain";

interface Resolved {
	creation: SafeCreation;
	checked: CheckedCreation;
	address: Address;
}

const newSalt = (): string => randomSaltNonce().toString();

/**
 * Creates a Safe on the chosen network: with a fresh address, with the address of a Safe that
 * already exists on another network, or with a vanity address mined outside the app.
 * Network and mode live in the URL, the rest of the form in sessionStorage – a reload loses nothing.
 */
export const CreateSafePage: React.FC = () => {
	const t = useT();
	const { params, patch, env, chain } = useUrlState();
	const accounts = useAppStore((s) => s.accounts);
	const signers = useAppStore((s) => s.signers);
	const [draft, setDraft] = useDraft(newSalt);
	const deployment = useDeployment();
	const [picking, setPicking] = useState(false);
	const [feeGas, setFeeGas] = useState<bigint | null | undefined>(null);

	const modeParam = params.get("mode");
	const mode: CreateMode = modeParam === "copy" || modeParam === "vanity" ? modeParam : "new";
	const chainConfig = chainFor(chain, env);
	const chainId = chainConfig.id;
	const busy = !!deployment.pending;

	const modeOptions = useMemo<SegmentedOption<CreateMode>[]>(
		() => [
			{ value: "new", label: t("createSafe.mode.new") },
			{ value: "copy", label: t("createSafe.mode.copy") },
			{ value: "vanity", label: t("createSafe.mode.vanity") },
		],
		[t],
	);

	const setChain = useCallback((c: ChainKey) => patch({ chain: c }), [patch]);
	const setEnv = useCallback((e: NetworkEnv) => patch({ env: e }), [patch]);
	const setMode = useCallback((m: CreateMode) => patch({ mode: m === "new" ? undefined : m }), [patch]);
	const setOwners = useCallback((owners: string[], threshold: number) => setDraft({ owners, threshold }), [setDraft]);
	const regenerate = useCallback(() => setDraft({ saltNonce: newSalt() }), [setDraft]);

	const ownersInput = useMemo(
		() => checkOwnersInput(draft.owners, draft.threshold, t),
		[draft.owners, draft.threshold, t],
	);

	// Safes of the app whose address is free on the target network.
	const sources = useMemo(
		() =>
			accounts.filter(
				(a) =>
					a.kind === "safe" &&
					a.chainId !== chainId &&
					!accounts.some((b) => b.id === accountId("safe", chainId, a.address)),
			),
		[accounts, chainId],
	);
	const source = useMemo(() => sources.find((a) => a.id === draft.sourceId), [sources, draft.sourceId]);
	const handleSource = useCallback((id: string) => setDraft({ sourceId: id, sourceCreation: undefined }), [setDraft]);
	const handleResolved = useCallback(
		(creation: SafeCreation | undefined) => setDraft({ sourceCreation: creation }),
		[setDraft],
	);

	/** Creation parameters of the selected mode, validated; or the reason they are not usable. */
	const { resolved, problem, minerError } = useMemo((): {
		resolved?: Resolved;
		problem?: string;
		minerError?: string;
	} => {
		const finish = (creation: SafeCreation): { resolved?: Resolved; problem?: string } => {
			try {
				return { resolved: { creation, checked: validateCreation(creation), address: predictSafeAddress(creation) } };
			} catch (e) {
				return { problem: describeError(e, t) };
			}
		};
		if (mode === "new") {
			return ownersInput.owners
				? finish(defaultCreation(ownersInput.owners, draft.threshold, BigInt(draft.saltNonce)))
				: {};
		}
		if (mode === "copy") {
			if (!source || !draft.sourceCreation) return {};
			const out = finish(draft.sourceCreation);
			return out.resolved && !sameAddress(out.resolved.address, source.address)
				? { problem: t("createSafe.error.sourceMismatch") }
				: out;
		}
		if (!draft.minerOutput.trim()) return {};
		try {
			return { resolved: parseMinerOutput(draft.minerOutput) };
		} catch (e) {
			return { minerError: describeError(e, t) };
		}
	}, [mode, ownersInput.owners, draft.threshold, draft.saltNonce, draft.sourceCreation, draft.minerOutput, source, t]);

	const { target, recheck } = useTargetState(chainId, resolved?.creation, resolved?.address);
	const alreadyAdded = useMemo(
		() => (resolved ? accounts.find((a) => a.id === accountId("safe", chainId, resolved.address)) : undefined),
		[accounts, chainId, resolved],
	);

	const plan = useMemo<DeploymentPlan | undefined>(
		() =>
			resolved ? { chainId, creation: resolved.creation, address: resolved.address, name: draft.name } : undefined,
		[resolved, chainId, draft.name],
	);
	const ready = target.status === "ready" && target.missing.length === 0 && !alreadyAdded;
	const exists = ready && target.status === "ready" && target.deployed;

	// Network fee shown in the payer dialog.
	const payerAddresses = useMemo(() => signers.map((s) => s.address), [signers]);
	useEffect(() => {
		if (!picking || !plan || payerAddresses.length === 0) return undefined;
		let cancelled = false;
		setFeeGas(null);
		const client = getPublicClient(plan.chainId);
		client
			.estimateGas({
				account: payerAddresses[0],
				to: plan.creation.factory,
				data: encodeCreateProxy(plan.creation),
			})
			.then((gas) => !cancelled && setFeeGas(gas))
			.catch(() => !cancelled && setFeeGas(undefined));
		return () => {
			cancelled = true;
		};
	}, [picking, plan, payerAddresses]);

	const { deploy, addExisting } = deployment;
	const handlePay = useCallback(
		async (signer: Signer) => {
			if (plan) await deploy(signer, plan);
		},
		[deploy, plan],
	);
	const handleAddExisting = useCallback(() => {
		if (plan) void addExisting(plan);
	}, [addExisting, plan]);

	return (
		<>
			<PageHeader title={t("createSafe.title")} back={`/accounts/new?kind=safe&chain=${chain}&env=${env}`} />
			{!deployment.pending && <LinkNotice />}
			{deployment.pending ? (
				<DeploymentStatus
					chainId={deployment.pending.chainId}
					txHash={deployment.pending.txHash}
					waiting={deployment.waiting}
					error={deployment.error}
					onRetry={deployment.resume}
					onDiscard={deployment.discard}
				/>
			) : (
				<div className="flex flex-col gap-4">
					<NetworkFields showChain chain={chain} env={env} onChain={setChain} onEnv={setEnv} disabled={busy} />
					<Field label={t("createSafe.mode")}>
						<Segmented
							value={mode}
							options={modeOptions}
							onChange={setMode}
							size="sm"
							ariaLabel={t("createSafe.mode")}
						/>
					</Field>

					{mode === "new" && (
						<NewAddressPanel
							owners={draft.owners}
							threshold={draft.threshold}
							onChange={setOwners}
							errors={ownersInput.errors}
						/>
					)}
					{mode === "copy" && (
						<CopyPanel
							key={chainId}
							sources={sources}
							sourceId={source?.id}
							creation={source ? draft.sourceCreation : undefined}
							onSource={handleSource}
							onResolved={handleResolved}
						/>
					)}
					{mode === "vanity" && (
						<VanityPanel
							chainId={chainId}
							owners={draft.owners}
							threshold={draft.threshold}
							validOwners={ownersInput.owners}
							ownerErrors={ownersInput.errors}
							onOwners={setOwners}
							prefix={draft.prefix}
							onPrefix={(prefix) => setDraft({ prefix })}
							output={draft.minerOutput}
							onOutput={(minerOutput) => setDraft({ minerOutput })}
							outputError={minerError}
							locked={!!resolved}
						/>
					)}

					{problem && (
						<div className="alert alert-soft alert-error text-sm" role="alert">
							<CircleAlert className="size-4 shrink-0" />
							<span className="min-w-0 break-words">{problem}</span>
						</div>
					)}

					{resolved && (
						<>
							{mode !== "new" && (
								<OwnersSummary
									owners={resolved.checked.setup.owners}
									threshold={resolved.checked.setup.threshold}
									reason={t(mode === "copy" ? "createSafe.copy.locked" : "createSafe.vanity.locked")}
								/>
							)}
							<AddressPreview address={resolved.address} onRegenerate={mode === "new" ? regenerate : undefined} />
							{resolved.checked.noFallbackHandler && (
								<p className="bg-warning/15 rounded-box flex items-start gap-2 px-3 py-2 text-xs">
									<TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" />
									{t("createSafe.noFallbackHandler")}
								</p>
							)}
							<TextField
								label={`${t("common.name")} · ${t("common.optional")}`}
								value={draft.name}
								onChange={(name) => setDraft({ name })}
								maxLength={40}
							/>
							{alreadyAdded ? (
								<div className="alert alert-soft alert-info text-sm" role="status">
									<span>
										{t("addAccount.alreadyAdded")}{" "}
										<Link className="link" to={`/account/${encodeURIComponent(alreadyAdded.id)}`}>
											{t("common.open")}
										</Link>
									</span>
								</div>
							) : (
								<TargetNotice target={target} network={chainConfig.name} onRetry={recheck} />
							)}
							{deployment.error && <p className="text-error text-sm">{deployment.error}</p>}
							{exists ? (
								<button type="button" className="btn btn-primary" onClick={handleAddExisting}>
									{t("createSafe.addExisting")}
								</button>
							) : (
								<button
									type="button"
									className="btn btn-primary"
									disabled={!ready || signers.length === 0}
									onClick={() => setPicking(true)}
								>
									{t("createSafe.submit", { network: chainConfig.name })}
								</button>
							)}
							{signers.length === 0 && !exists && (
								<p className="text-base-content/70 text-sm">
									{t("createSafe.noSigners")}{" "}
									<Link className="link" to="/signers">
										{t("createSafe.addSigner")}
									</Link>
								</p>
							)}
						</>
					)}
				</div>
			)}
			<SignerPickerDialog
				open={picking}
				onClose={() => setPicking(false)}
				title={t("createSafe.payer.title")}
				hint={t("createSafe.payer.hint", { network: chainConfig.name })}
				addresses={payerAddresses}
				balanceChainId={chainId}
				feeGas={feeGas}
				onPick={handlePay}
			/>
		</>
	);
};
