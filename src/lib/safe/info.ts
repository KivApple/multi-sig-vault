import { getAddress, type Address } from 'viem';
import { AppError } from '@/lib/errors';
import { getPublicClient } from '@/lib/rpc';
import { SAFE_ABI } from './abis';
import { isSupportedSafeVersion } from './deployments';

export interface SafeInfo {
  version: string;
  owners: Address[];
  threshold: number;
  /** Decimal string. */
  nonce: string;
}

/** Reads the Safe state in one multicall. Throws `AppError` when the address is not a compatible Safe. */
export const fetchSafeInfo = async (chainId: number, address: Address): Promise<SafeInfo> => {
  const client = getPublicClient(chainId);
  const contract = { address, abi: SAFE_ABI } as const;
  const [version, owners, threshold, nonce] = await client.multicall({
    contracts: [
      { ...contract, functionName: 'VERSION' },
      { ...contract, functionName: 'getOwners' },
      { ...contract, functionName: 'getThreshold' },
      { ...contract, functionName: 'nonce' },
    ],
    allowFailure: true,
  });
  if (version.status !== 'success' || owners.status !== 'success' || threshold.status !== 'success') {
    const code = await client.getCode({ address });
    throw new AppError(code && code !== '0x' ? 'safe.error.notSafe' : 'safe.error.noContract');
  }
  if (!isSupportedSafeVersion(version.result)) {
    throw new AppError('safe.error.version', { version: version.result });
  }
  return {
    version: version.result,
    owners: owners.result.map((o) => getAddress(o)),
    threshold: Number(threshold.result),
    nonce: (nonce.status === 'success' ? nonce.result : 0n).toString(),
  };
};
