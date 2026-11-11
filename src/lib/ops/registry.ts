import { approveAgentOp, loginOp, revokeAgentOp } from "./hl/agents";
import { disableMultiSigOp, multiSigOp } from "./hl/multisig";
import { createSubOp, renameSubOp, subTransferOp } from "./hl/subs";
import { classTransferOp, spotSendOp, spotWithdrawOp, usdSendOp, withdrawOp } from "./hl/transfers";
import { callOp } from "./safe/call";
import { deployOp } from "./safe/deploy";
import { safeOwnersOp } from "./safe/owners";
import { safeSendOp } from "./safe/send";
import { signMessageOp } from "./safe/signMessage";
import { swapOp } from "./safe/swap";
import type { OpDefinition } from "./types";

let cache: OpDefinition[] | undefined;

/**
 * All operations, in the order they are offered. Adding one = a definition file + a line here.
 * Built lazily: definitions import UI that imports the engine, which imports this registry.
 */
export const allOperations = (): OpDefinition[] => {
	cache ??= [
		withdrawOp,
		usdSendOp,
		spotWithdrawOp,
		spotSendOp,
		classTransferOp,
		loginOp,
		approveAgentOp,
		revokeAgentOp,
		createSubOp,
		renameSubOp,
		subTransferOp,
		multiSigOp,
		disableMultiSigOp,
		safeSendOp,
		swapOp,
		safeOwnersOp,
		callOp,
		deployOp,
		signMessageOp,
	];
	return cache;
};

export const getOpDefinition = (type: string): OpDefinition | undefined => allOperations().find((d) => d.type === type);

/** `hl.withdraw` → `ops.hl.withdraw.title`. */
export const opTitleKey = (type: string): string => `ops.${type}.title`;
export const opDescKey = (type: string): string => `ops.${type}.desc`;
