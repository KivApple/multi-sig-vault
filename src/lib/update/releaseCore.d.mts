import type { Hex } from 'viem';

export interface ReleaseFile {
  path: string;
  /** Lowercase hex SHA-256 of the file bytes. */
  sha256: string;
  size: number;
}

export interface ReleaseManifest {
  version: string;
  /** Lowercase hex SHA-256 of `canonicalRelease(version, files)`. */
  id: string;
  files: ReleaseFile[];
  /** Informational only – not part of the id. */
  builtAt?: string;
}

export declare const RELEASE_FORMAT: string;
export declare const RELEASE_DIGEST_PREFIX: string;
export declare const EIP1271_MAGIC: Hex;
export declare const SIGN_MESSAGE_LIB: Record<'1.4.1' | '1.3.0' | '1.3.0-eip155', `0x${string}`>;

export declare const sha256Hex: (data: BufferSource) => Promise<string>;
export declare const isSafePath: (path: unknown) => boolean;
export declare const sortFiles: <T extends { path: string }>(files: T[]) => T[];
export declare const canonicalRelease: (version: string, files: Pick<ReleaseFile, 'path' | 'sha256'>[]) => string;
export declare const computeReleaseId: (
  version: string,
  files: Pick<ReleaseFile, 'path' | 'sha256'>[],
) => Promise<string>;
export declare const parseManifest: (raw: unknown) => ReleaseManifest;
export declare const verifyManifest: (raw: unknown) => Promise<ReleaseManifest>;
export declare const releaseDigest: (id: string) => Hex;
export declare const signMessageCalldata: (digest: Hex) => Hex;
export declare const isValidSignatureCalldata: (digest: Hex) => Hex;
