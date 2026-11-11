import type { Address } from 'viem';

/**
 * Canonical Safe contracts (same addresses on every supported chain, verified on-chain – see tests/README).
 * New Safes are created with v1.4.1; existing Safes of the versions below can be imported.
 */
export const SAFE_141 = {
  proxyFactory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
  singleton: '0x41675C099F32341bf84BFc5382aF534df5C7461a',
  singletonL2: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
  fallbackHandler: '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99',
  multiSend: '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526',
  multiSendCallOnly: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
  createCall: '0x9b35Af71d77eaf8d7e40252370304687390A1A52',
  signMessageLib: '0xd53cd0aB83D845Ac265BE939c57F53AD838012c9',
  simulateTxAccessor: '0x3d4BA2E0884aa488718476ca2FB8Efc291A46199',
  safeToL2Setup: '0xBD89A1CE4DDe368FFAB0eC35506eEcE0b1fFdc54',
} as const satisfies Record<string, Address>;

/** Helper libraries used for every Safe regardless of its own version. */
export const SAFE_LIBS = {
  multiSendCallOnly: SAFE_141.multiSendCallOnly,
  createCall: SAFE_141.createCall,
  simulateTxAccessor: SAFE_141.simulateTxAccessor,
} as const;

/** Safe versions whose EIP-712 domain and `execTransaction` ABI this app implements. */
export const SUPPORTED_SAFE_VERSIONS = ['1.3.0', '1.4.1', '1.5.0'];

export const isSupportedSafeVersion = (version: string): boolean =>
  SUPPORTED_SAFE_VERSIONS.includes(version.split('+')[0]);

/** Proxy factories and singletons a Safe may legitimately be created from (lowercase). */
export const KNOWN_FACTORIES = new Set([
  '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67',
  '0xa6b71e26c5e0845f74c812102ca7114b6a896ab2',
  '0xc22834581ebc8527d974f8a1c97e1bea4ef910bc',
  '0x14f2982d601c9458f93bd70b218933a6f8165e7b',
]);

export const KNOWN_SINGLETONS = new Set([
  '0x41675c099f32341bf84bfc5382af534df5c7461a',
  '0x29fcb43b46531bca003ddc8fcb67ffe91900c762',
  '0xd9db270c1b5e3bd161e8c8503c55ceabee709552',
  '0x3e5c63644e683549055b9be8653de26e0b4cd36e',
  '0x69f4d1788e39c87893c980c06edf4b7f686e2938',
  '0xfb1bffc9d739b8d520daf37df666da4c687191ea',
  '0xff51a5898e281db6dfc7855790607438df2ca44b',
  '0xedd160febbd92e350d4d398fb636302fccd67c7e',
]);
