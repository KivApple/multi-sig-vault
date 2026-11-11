import {
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  pad,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { ZERO_ADDRESS } from '@/config/constants';
import type { SafeCreation } from '@/types/domain';
import { PROXY_FACTORY_ABI, SAFE_ABI } from './abis';
import { SAFE_141 } from './deployments';
import { PROXY_CREATION_CODE } from './proxyCode';

export interface SafeSetup {
  owners: Address[];
  threshold: number;
  fallbackHandler: Address;
  /** Optional delegatecall executed during setup – only zero is accepted by this app. */
  to: Address;
  data: Hex;
  paymentToken: Address;
  payment: bigint;
  paymentReceiver: Address;
}

export const encodeSetup = (owners: Address[], threshold: number): Hex =>
  encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'setup',
    args: [owners, BigInt(threshold), ZERO_ADDRESS, '0x', SAFE_141.fallbackHandler, ZERO_ADDRESS, 0n, ZERO_ADDRESS],
  });

export const decodeSetup = (initializer: Hex): SafeSetup => {
  const { functionName, args } = decodeFunctionData({ abi: SAFE_ABI, data: initializer });
  if (functionName !== 'setup') throw new Error('Initializer is not a Safe setup call');
  const [owners, threshold, to, data, fallbackHandler, paymentToken, payment, paymentReceiver] = args;
  return {
    owners: owners.map((o) => getAddress(o)),
    threshold: Number(threshold),
    to: getAddress(to),
    data,
    fallbackHandler: getAddress(fallbackHandler),
    paymentToken: getAddress(paymentToken),
    payment,
    paymentReceiver: getAddress(paymentReceiver),
  };
};

/** Default creation parameters used by this app: Safe L2 v1.4.1, no modules, no payment. */
export const defaultCreation = (owners: Address[], threshold: number, saltNonce: bigint): SafeCreation => ({
  factory: SAFE_141.proxyFactory,
  singleton: SAFE_141.singletonL2,
  initializer: encodeSetup(owners, threshold),
  saltNonce: saltNonce.toString(),
});

export const proxyInitCodeHash = (factory: Address, singleton: Address): Hex | undefined => {
  const code = PROXY_CREATION_CODE[factory.toLowerCase()];
  return code ? keccak256(concat([code, pad(singleton)])) : undefined;
};

/** CREATE2 address of the proxy `createProxyWithNonce` will deploy. */
export const predictSafeAddress = (c: SafeCreation): Address => {
  const initCodeHash = proxyInitCodeHash(c.factory, c.singleton);
  if (!initCodeHash) throw new Error('Unknown proxy factory');
  const salt = keccak256(
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [keccak256(c.initializer), BigInt(c.saltNonce)]),
  );
  return getContractAddress({ opcode: 'CREATE2', from: c.factory, salt, bytecodeHash: initCodeHash });
};

export const encodeCreateProxy = (c: SafeCreation): Hex =>
  encodeFunctionData({
    abi: PROXY_FACTORY_ABI,
    functionName: 'createProxyWithNonce',
    args: [c.singleton, c.initializer, BigInt(c.saltNonce)],
  });

/** Extracts creation parameters from `createProxyWithNonce` calldata (e.g. printed by a vanity miner). */
export const decodeCreateProxy = (data: Hex): Omit<SafeCreation, 'factory'> | undefined => {
  try {
    const { functionName, args } = decodeFunctionData({ abi: PROXY_FACTORY_ABI, data });
    if (functionName !== 'createProxyWithNonce') return undefined;
    return { singleton: getAddress(args[0]), initializer: args[1], saltNonce: args[2].toString() };
  } catch {
    return undefined;
  }
};

export const randomSaltNonce = (): bigint => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return BigInt(toHex(bytes));
};
