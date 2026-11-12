import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { getChain } from "@/config/chains";
import { useT } from "@/i18n";
import { describeError } from "@/lib/describeError";
import { useStackNav } from "@/lib/navStack";
import { AppError } from "@/lib/errors";
import { getPublicClient } from "@/lib/rpc";
import { encodeCreateProxy } from "@/lib/safe/deploy";
import { fetchSafeInfo } from "@/lib/safe/info";
import { sendTransactionWith } from "@/lib/wallets";
import { accountId, useAppStore } from "@/store/appStore";
import type { SafeCreation, Signer } from "@/types/domain";
import { clearDraft } from "./useDraft";

export interface DeploymentPlan {
	chainId: number;
	creation: SafeCreation;
	address: Address;
	name?: string;
}

interface PendingDeployment extends DeploymentPlan {
	txHash: Hex;
}

const KEY = "msv:create-safe:pending";

const loadPending = (): PendingDeployment | undefined => {
	try {
		const raw = sessionStorage.getItem(KEY);
		const p = raw ? (JSON.parse(raw) as PendingDeployment) : undefined;
		return p && typeof p.txHash === "string" && typeof p.address === "string" && p.creation ? p : undefined;
	} catch {
		return undefined;
	}
};

const storePending = (p: PendingDeployment | undefined): void => {
	try {
		if (p) sessionStorage.setItem(KEY, JSON.stringify(p));
		else sessionStorage.removeItem(KEY);
	} catch {
		// Without storage the deployment simply cannot be resumed after a reload.
	}
};

export interface UseDeploymentResult {
	/** Deployment transaction that was sent and is not yet confirmed. */
	pending: PendingDeployment | undefined;
	waiting: boolean;
	error: string | undefined;
	/** Sends `createProxyWithNonce` from the signer and waits for the Safe to appear. */
	deploy: (signer: Signer, plan: DeploymentPlan) => Promise<void>;
	/** Adds a Safe that already exists at the planned address. */
	addExisting: (plan: DeploymentPlan) => Promise<void>;
	/** Looks for the receipt of the pending transaction again. */
	resume: () => void;
	/** Forgets the pending transaction (it may still confirm on-chain). */
	discard: () => void;
}

/**
 * Deployment flow of a new Safe. The transaction hash is kept in sessionStorage, so a reload
 * (or MetaMask Mobile freezing the tab) does not lose track of a Safe being created.
 */
export const useDeployment = (): UseDeploymentResult => {
	const t = useT();
	const { finishAt } = useStackNav();
	const [pending, setPending] = useState<PendingDeployment | undefined>(loadPending);
	const [waiting, setWaiting] = useState(false);
	const [error, setError] = useState<string>();
	const running = useRef<string | undefined>(undefined);
	const alive = useRef(true);

	const register = useCallback(
		async (plan: DeploymentPlan) => {
			// Reads owners/threshold/version from the chain – proves a compatible Safe really is there.
			await fetchSafeInfo(plan.chainId, plan.address);
			const id = accountId("safe", plan.chainId, plan.address);
			useAppStore.getState().addAccount({
				id,
				kind: "safe",
				env: getChain(plan.chainId).env,
				chainId: plan.chainId,
				address: plan.address,
				name: plan.name?.trim() || undefined,
				hidden: false,
				hideDust: false,
				creation: plan.creation,
				addedAt: Date.now(),
			});
			storePending(undefined);
			clearDraft();
			if (alive.current) finishAt(`/account/${encodeURIComponent(id)}`);
		},
		[finishAt],
	);

	const finalize = useCallback(
		async (p: PendingDeployment) => {
			if (running.current === p.txHash) return;
			running.current = p.txHash;
			setWaiting(true);
			setError(undefined);
			try {
				const receipt = await getPublicClient(p.chainId).waitForTransactionReceipt({
					hash: p.txHash,
					timeout: 180_000,
					pollingInterval: 3_000,
				});
				if (receipt.status !== "success") {
					storePending(undefined);
					if (alive.current) setPending(undefined);
					throw new AppError("createSafe.error.reverted");
				}
				await register(p);
			} catch (e) {
				if (alive.current) setError(describeError(e, t));
			} finally {
				running.current = undefined;
				if (alive.current) setWaiting(false);
			}
		},
		[register, t],
	);

	useEffect(() => {
		alive.current = true;
		const saved = loadPending();
		if (saved) void finalize(saved);
		return () => {
			alive.current = false;
		};
	}, [finalize]);

	const deploy = useCallback(
		async (signer: Signer, plan: DeploymentPlan) => {
			const data = encodeCreateProxy(plan.creation);
			const txHash = await sendTransactionWith(signer, { chainId: plan.chainId, to: plan.creation.factory, data });
			const next: PendingDeployment = { ...plan, txHash };
			storePending(next);
			setPending(next);
			void finalize(next);
		},
		[finalize],
	);

	const addExisting = useCallback(
		async (plan: DeploymentPlan) => {
			setError(undefined);
			try {
				await register(plan);
			} catch (e) {
				setError(describeError(e, t));
			}
		},
		[register, t],
	);

	const resume = useCallback(() => {
		if (pending) void finalize(pending);
	}, [pending, finalize]);

	const discard = useCallback(() => {
		storePending(undefined);
		setPending(undefined);
		setError(undefined);
	}, []);

	return { pending, waiting, error, deploy, addExisting, resume, discard };
};
