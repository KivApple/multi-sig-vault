import { getAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { dropCached, getCached } from "@/lib/dataCache";
import { AppError } from "@/lib/errors";
import { sameAddress } from "@/lib/format";
import { hlExchange } from "@/lib/hl/api";
import type { HlAccountData } from "@/lib/hl/account";
import {
	hlChainName,
	hlMultiSigWrapper,
	hlOuterTypedData,
	hlSignatureChainId,
	hlSignerTypedData,
	splitSignature,
	USER_SIGNED,
} from "@/lib/hl/signing";
import { getPublicClient } from "@/lib/rpc";
import type { SafeAccountData } from "@/lib/safe/account";
import { fetchSafeInfo } from "@/lib/safe/info";
import { computeSafeTxHash, encodeExecTransaction, safeErrorKey, safeTxTypedData, toSafeTx } from "@/lib/safe/tx";
import { agentKeyId, secureDelete } from "@/lib/secureStore";
import { sendTransactionWith, signTypedDataWith, type TypedDataPayload } from "@/lib/wallets";
import { useAppStore } from "@/store/appStore";
import type { Account, HlPayload, Operation, OpPayload, OpSignature, SafePayload, Signer } from "@/types/domain";
import { getOpDefinition } from "./registry";
import type { OpEnv } from "./types";

export const accountCacheKey = (account: Account): string => `account:${account.id}`;
export const extrasCacheKey = (account: Account): string => `extras:${account.id}`;

export interface OwnerSet {
	owners: Address[];
	threshold: number;
	/** Hyperliquid multi-sig user (as opposed to an ordinary account signing for itself). */
	multiSig: boolean;
}

/** Who has to sign operations of the account, from live or cached data. */
export const ownerSetOf = (env: OpEnv): OwnerSet | undefined => {
	if (env.account.kind === "safe") {
		return env.safe ? { owners: env.safe.owners, threshold: env.safe.threshold, multiSig: true } : undefined;
	}
	if (!env.hl) return undefined;
	return env.hl.multiSig
		? {
				owners: env.hl.multiSig.authorizedUsers.map((a) => getAddress(a)),
				threshold: env.hl.multiSig.threshold,
				multiSig: true,
			}
		: { owners: [env.account.address], threshold: 1, multiSig: false };
};

const nextHlNonce = (accountId: string): number => {
	const used = useAppStore
		.getState()
		.operations.filter((o) => o.accountId === accountId && o.payload?.kind === "hl")
		.map((o) => (o.payload as HlPayload).nonce);
	return Math.max(Date.now(), ...used.map((n) => n + 1));
};

const nextSafeNonce = (accountId: string, onChain: string): string => {
	let next = BigInt(onChain);
	for (const o of useAppStore.getState().operations) {
		if (o.accountId !== accountId || o.status !== "signing" || o.payload?.kind !== "safe") continue;
		const n = BigInt(o.payload.tx.nonce);
		if (n >= next) next = n + 1n;
	}
	return next.toString();
};

interface PayloadSeed {
	multiSig: boolean;
	leader: Address;
	nonce: number | string;
}

/** Deterministically derives the signed payload from operation parameters. */
export const buildPayload = (
	op: Pick<Operation, "type" | "params">,
	account: Account,
	seed: PayloadSeed,
): OpPayload => {
	const def = getOpDefinition(op.type);
	if (!def || def.kind !== account.kind) throw new AppError("ops.error.unknownType", { type: op.type });
	if (account.kind === "hl") {
		if (!def.buildHl) throw new AppError("ops.error.unknownType", { type: op.type });
		const nonce = Number(seed.nonce);
		const body = def.buildHl(op.params, { env: account.env, nonce, user: account.address });
		const signing = def.hlSigning ?? "user";
		let action = body;
		if (signing === "user") {
			const typeDef = USER_SIGNED[String(body.type)];
			if (!typeDef) throw new AppError("ops.error.unknownType", { type: String(body.type) });
			// Wire order: type, signatureChainId, hyperliquidChain, fields in EIP-712 order (nonce/time last).
			action = {
				type: body.type,
				signatureChainId: hlSignatureChainId(account.env),
				hyperliquidChain: hlChainName(account.env),
			};
			for (const f of typeDef.fields.slice(1)) {
				action[f.name] = f.name === "nonce" || f.name === "time" ? nonce : body[f.name];
				if (action[f.name] === undefined) throw new Error(`Missing field ${f.name}`);
			}
		}
		return {
			kind: "hl",
			multiSig: seed.multiSig,
			leader: seed.leader.toLowerCase() as Address,
			nonce,
			signing,
			action,
		};
	}
	if (!def.buildSafe || account.chainId === undefined) throw new AppError("ops.error.unknownType", { type: op.type });
	const tx = toSafeTx(def.buildSafe(op.params, { chainId: account.chainId, safe: account.address }), seed.nonce);
	return { kind: "safe", tx, safeTxHash: computeSafeTxHash(account.chainId, account.address, tx) };
};

const stable = (v: unknown): string => JSON.stringify(v);

/**
 * Proves that the stored payload is what the operation parameters describe.
 * Runs before every signature, before sending and on import – a mismatch blocks the operation.
 */
export const verifyOperation = (op: Operation, account: Account): void => {
	if (!op.payload) return;
	if (op.accountId !== account.id) throw new AppError("ops.error.mismatch");
	const rebuilt =
		op.payload.kind === "hl"
			? buildPayload(op, account, { multiSig: op.payload.multiSig, leader: op.payload.leader, nonce: op.payload.nonce })
			: buildPayload(op, account, { multiSig: true, leader: account.address, nonce: op.payload.tx.nonce });
	if (stable(rebuilt) !== stable(op.payload)) throw new AppError("ops.error.mismatch");
};

/** The EIP-712 message each signer signs for this payload. */
export const signerTypedData = (payload: OpPayload, account: Account): TypedDataPayload =>
	payload.kind === "hl"
		? hlSignerTypedData(payload, account.address, account.env)
		: safeTxTypedData(account.chainId as number, account.address, payload.tx);

export const recoverSigner = (payload: OpPayload, account: Account, signature: Hex): Promise<Address> => {
	const data = signerTypedData(payload, account);
	return recoverTypedDataAddress({ ...data, signature } as never);
};

/** Throws unless every signature is valid for the payload and made by the signer it claims. */
export const verifySignatures = async (op: Operation, account: Account): Promise<void> => {
	if (!op.payload) return;
	const seen = new Set<string>();
	for (const s of op.signatures) {
		const recovered = await recoverSigner(op.payload, account, s.signature).catch(() => undefined);
		if (!recovered || !sameAddress(recovered, s.signer) || seen.has(recovered.toLowerCase())) {
			throw new AppError("ops.error.badSignature");
		}
		seen.add(recovered.toLowerCase());
	}
};

export const hasSigned = (op: Operation, address: string): boolean =>
	op.signatures.some((s) => sameAddress(s.signer, address));

export const validSignatureCount = (op: Operation, owners: Address[]): number =>
	op.signatures.filter((s) => owners.some((o) => sameAddress(o, s.signer))).length;

/** Hyperliquid nonces expire 2 days after their timestamp (minus a safety margin). */
export const HL_NONCE_TTL_MS = 2 * 24 * 3600 * 1000 - 10 * 60 * 1000;

export const opExpiresAt = (op: Operation): number | undefined =>
	op.payload?.kind === "hl" && op.status === "signing" ? op.payload.nonce + HL_NONCE_TTL_MS : undefined;

/**
 * Collects one signature. The first signature freezes the operation: parameters are resolved,
 * the payload is built and from then on only that payload is ever signed or sent.
 */
export const signOperation = async (opId: string, signer: Signer, env: OpEnv): Promise<void> => {
	const store = useAppStore.getState();
	const op = store.operations.find((o) => o.id === opId);
	if (!op) throw new AppError("ops.error.gone");
	const { account } = env;
	const set = ownerSetOf(env);
	const owners = op.owners ?? set?.owners;
	const threshold = op.threshold ?? set?.threshold;
	if (!owners || threshold === undefined) throw new AppError("ops.error.noAccountData");
	if (!owners.some((o) => sameAddress(o, signer.address))) throw new AppError("ops.error.notOwner");
	if (hasSigned(op, signer.address)) throw new AppError("ops.error.alreadySigned");

	let payload = op.payload;
	let params = op.params;
	if (!payload) {
		const def = getOpDefinition(op.type);
		if (!def) throw new AppError("ops.error.unknownType", { type: op.type });
		if (def.prepare) params = await def.prepare(params, env);
		payload =
			account.kind === "hl"
				? buildPayload({ type: op.type, params }, account, {
						multiSig: !!set?.multiSig,
						leader: set?.multiSig ? signer.address : account.address,
						nonce: nextHlNonce(account.id),
					})
				: buildPayload({ type: op.type, params }, account, {
						multiSig: true,
						leader: account.address,
						nonce: nextSafeNonce(account.id, (env.safe as SafeAccountData).nonce),
					});
	} else {
		verifyOperation(op, account);
	}

	const signature = await signTypedDataWith(signer, signerTypedData(payload, account));
	const recovered = await recoverSigner(payload, account, signature);
	if (!sameAddress(recovered, signer.address)) throw new AppError("ops.error.badSignature");

	const frozen = payload;
	const resolved = params;
	useAppStore.getState().updateOperation(opId, (current) => {
		if (hasSigned(current, signer.address)) return {};
		const entry: OpSignature = { signer: signer.address, signature };
		return current.payload
			? { signatures: [...current.signatures, entry] }
			: {
					params: resolved,
					payload: frozen,
					status: "signing",
					frozenAt: Date.now(),
					owners,
					threshold,
					signatures: [entry],
				};
	});
};

/** Drops signatures and returns the operation to editing. */
export const resetOperation = (opId: string): void => {
	useAppStore.getState().updateOperation(opId, {
		status: "draft",
		payload: undefined,
		signatures: [],
		frozenAt: undefined,
		owners: undefined,
		threshold: undefined,
		result: undefined,
	});
};

export const deleteOperation = (opId: string): void => {
	useAppStore.getState().removeOperation(opId);
	void secureDelete(agentKeyId(opId)).catch(() => undefined);
};

const markSent = (op: Operation, account: Account, result: Operation["result"]): void => {
	useAppStore.getState().updateOperation(op.id, { status: "sent", result });
	dropCached(accountCacheKey(account));
	dropCached(extrasCacheKey(account));
};

/**
 * Submits a Hyperliquid operation. Multi-sig: the leader signs the envelope first
 * (`leaderSigner` must be the outer signer chosen with the first signature).
 */
export const sendHlOperation = async (op: Operation, account: Account, leaderSigner?: Signer): Promise<void> => {
	const payload = op.payload as HlPayload;
	verifyOperation(op, account);
	await verifySignatures(op, account);

	if (!payload.multiSig) {
		const own = op.signatures.find((s) => sameAddress(s.signer, account.address));
		if (!own) throw new AppError("ops.error.notEnough");
		await hlExchange(account.env, {
			action: payload.action,
			nonce: payload.nonce,
			signature: splitSignature(own.signature),
		});
		markSent(op, account, { sentAt: Date.now(), sender: account.address });
		return;
	}

	if (!leaderSigner || !sameAddress(leaderSigner.address, payload.leader))
		throw new AppError("ops.error.leaderRequired");
	const live = getCached<HlAccountData>(accountCacheKey(account))?.data.multiSig;
	const owners = live?.authorizedUsers ?? op.owners ?? [];
	const threshold = live?.threshold ?? op.threshold ?? 1;
	// Leader first, then the rest in signing order; signatures of removed signers are left out.
	const valid = op.signatures.filter((s) => owners.some((o) => sameAddress(o, s.signer)));
	if (valid.length < threshold) throw new AppError("ops.error.notEnough");
	const ordered = [...valid].sort(
		(a, b) => Number(sameAddress(b.signer, payload.leader)) - Number(sameAddress(a.signer, payload.leader)),
	);
	const wrapper = hlMultiSigWrapper(payload, account.address, account.env, ordered);
	const outer = await signTypedDataWith(leaderSigner, hlOuterTypedData(wrapper, payload.nonce, account.env));
	await hlExchange(account.env, { action: wrapper, nonce: payload.nonce, signature: splitSignature(outer) });
	markSent(op, account, { sentAt: Date.now(), sender: getAddress(payload.leader) });
};

export interface SafeSendPlan {
	data: Hex;
	gas: bigint;
}

/** Checks the Safe state, dry-runs `execTransaction` and estimates its cost for `from`. */
export const planSafeSend = async (op: Operation, account: Account, from: Address): Promise<SafeSendPlan> => {
	const payload = op.payload as SafePayload;
	const chainId = account.chainId as number;
	verifyOperation(op, account);
	await verifySignatures(op, account);
	const info = await fetchSafeInfo(chainId, account.address);
	if (BigInt(info.nonce) > BigInt(payload.tx.nonce)) throw new AppError("ops.error.nonceUsed");
	if (BigInt(info.nonce) < BigInt(payload.tx.nonce)) throw new AppError("ops.error.nonceAhead", { nonce: info.nonce });
	const valid = op.signatures.filter((s) => info.owners.some((o) => sameAddress(o, s.signer)));
	if (valid.length < info.threshold) throw new AppError("ops.error.notEnough");
	const data = encodeExecTransaction(payload.tx, valid);
	const client = getPublicClient(chainId);
	let gas: bigint;
	try {
		gas = await client.estimateGas({ account: from, to: account.address, data });
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		const key = safeErrorKey(message);
		if (key) throw new AppError(key, { detail: /GS\d{3}/.exec(message)?.[0] ?? "" });
		if (/insufficient funds/i.test(message)) throw new AppError("ops.error.noGas");
		throw new AppError("ops.error.simulation", { detail: message.split("\n")[0].slice(0, 200) });
	}
	// Safe needs headroom: the inner call gets 63/64 of what is left.
	gas = (gas * 13n) / 10n + 20_000n;
	return { data, gas };
};

/** Executes the Safe transaction from `executor` (any address may pay for gas). */
export const sendSafeOperation = async (op: Operation, account: Account, executor: Signer): Promise<void> => {
	const plan = await planSafeSend(op, account, executor.address);
	const txHash = await sendTransactionWith(executor, {
		chainId: account.chainId as number,
		to: account.address,
		data: plan.data,
		gas: plan.gas,
	});
	markSent(op, account, { sentAt: Date.now(), txHash, sender: executor.address });
};

/** Sent Safe transaction reverted – signatures are still valid, allow another attempt. */
export const retrySafeOperation = (opId: string): void => {
	useAppStore.getState().updateOperation(opId, { status: "signing", result: undefined });
};

export const patchResultExtra = (opId: string, extra: Record<string, unknown>): void => {
	useAppStore
		.getState()
		.updateOperation(opId, (op) =>
			op.result ? { result: { ...op.result, extra: { ...op.result.extra, ...extra } } } : {},
		);
};
