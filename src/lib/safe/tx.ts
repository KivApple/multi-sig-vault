import {
  concat,
  encodeFunctionData,
  encodePacked,
  getAddress,
  hashTypedData,
  size,
  type Address,
  type Hex,
} from 'viem';
import { ZERO_ADDRESS } from '@/config/constants';
import type { TypedDataPayload } from '@/lib/wallets/types';
import type { OpSignature, SafeTxData } from '@/types/domain';
import { MULTISEND_ABI, SAFE_ABI } from './abis';
import { SAFE_LIBS } from './deployments';

/** A call the Safe should make. */
export interface MetaTx {
  to: Address;
  value: bigint;
  data: Hex;
  /** 0 – call, 1 – delegatecall (only for audited Safe libraries). */
  operation?: 0 | 1;
}

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
};

/** EIP-712 payload of a Safe transaction (Safe ≥ 1.3.0: domain = chainId + verifyingContract). */
export const safeTxTypedData = (chainId: number, safe: Address, tx: SafeTxData): TypedDataPayload => ({
  domain: { chainId, verifyingContract: getAddress(safe) },
  types: SAFE_TX_TYPES,
  primaryType: 'SafeTx',
  message: { ...tx },
});

export const computeSafeTxHash = (chainId: number, safe: Address, tx: SafeTxData): Hex =>
  hashTypedData({
    domain: { chainId, verifyingContract: getAddress(safe) },
    types: SAFE_TX_TYPES,
    primaryType: 'SafeTx',
    message: {
      ...tx,
      value: BigInt(tx.value),
      safeTxGas: BigInt(tx.safeTxGas),
      baseGas: BigInt(tx.baseGas),
      gasPrice: BigInt(tx.gasPrice),
      nonce: BigInt(tx.nonce),
    },
  });

/** Wraps calls into a Safe transaction: single call as is, several via MultiSendCallOnly (delegatecall). */
export const toSafeTx = (calls: MetaTx[], nonce: string | number | bigint): SafeTxData => {
  if (calls.length === 0) throw new Error('No calls');
  const single = calls.length === 1 ? calls[0] : batch(calls);
  return {
    to: getAddress(single.to),
    value: single.value.toString(),
    data: single.data,
    operation: single.operation ?? 0,
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
    nonce: BigInt(nonce).toString(),
  };
};

const batch = (calls: MetaTx[]): MetaTx => {
  if (calls.some((c) => c.operation === 1)) throw new Error('Delegatecall is not allowed inside a batch');
  const packed = concat(
    calls.map((c) =>
      encodePacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [0, c.to, c.value, BigInt(size(c.data)), c.data],
      ),
    ),
  );
  return {
    to: SAFE_LIBS.multiSendCallOnly,
    value: 0n,
    data: encodeFunctionData({ abi: MULTISEND_ABI, functionName: 'multiSend', args: [packed] }),
    operation: 1,
  };
};

/** Signatures concatenated in ascending owner order, as `checkSignatures` requires. */
export const encodeSignatures = (signatures: OpSignature[]): Hex => {
  const sorted = [...signatures].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1));
  return concat(sorted.map((s) => s.signature));
};

export const encodeExecTransaction = (tx: SafeTxData, signatures: OpSignature[]): Hex =>
  encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'execTransaction',
    args: [
      tx.to,
      BigInt(tx.value),
      tx.data,
      tx.operation,
      BigInt(tx.safeTxGas),
      BigInt(tx.baseGas),
      BigInt(tx.gasPrice),
      tx.gasToken,
      tx.refundReceiver,
      encodeSignatures(signatures),
    ],
  });

const SAFE_ERRORS: Record<string, string> = {
  GS013: 'safeError.GS013',
  GS020: 'safeError.GS020',
  GS025: 'safeError.GS025',
  GS026: 'safeError.GS026',
};

/** Maps a Safe revert code found in an error message to a translation key. */
export const safeErrorKey = (message: string): string | undefined => {
  const code = /GS\d{3}/.exec(message)?.[0];
  return code ? (SAFE_ERRORS[code] ?? 'safeError.other') : undefined;
};
