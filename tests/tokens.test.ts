import { describe, expect, it } from 'vitest';
import {
  cleanText,
  deriveHyperEvmTokens,
  mirrorLogoUrl,
  normalizeLogoUrl,
  packTokens,
  parseTokenList,
  sanitizeToken,
  unpackTokens,
  withEssentials,
} from '@/lib/tokens/sanitize';
import { iconSymbol, symbolHue } from '@/lib/tokens/symbols';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

describe('token sanitization', () => {
  it('normalizes a valid token and checksums its address', () => {
    const t = sanitizeToken({
      chainId: 1,
      address: USDC.toLowerCase(),
      symbol: ' USDC\u0000 ',
      name: 'USD‮ Coin',
      decimals: 6,
      logoURI: 'https://assets.coingecko.com/coins/images/6319/thumb/usdc.png?1696506694',
    });
    expect(t).toEqual({
      chainId: 1,
      address: USDC,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      logoURI: 'https://coin-images.coingecko.com/coins/images/6319/small/usdc.png',
    });
  });

  it('rejects malformed tokens', () => {
    const base = { chainId: 1, address: USDC, symbol: 'X', name: 'X', decimals: 18 };
    expect(sanitizeToken({ ...base, address: '0x123' })).toBeUndefined();
    expect(sanitizeToken({ ...base, address: `0x${'0'.repeat(40)}` })).toBeUndefined();
    expect(sanitizeToken({ ...base, decimals: 77 })).toBeUndefined();
    expect(sanitizeToken({ ...base, decimals: '18' })).toBeUndefined();
    expect(sanitizeToken({ ...base, decimals: 1.5 })).toBeUndefined();
    expect(sanitizeToken({ ...base, symbol: '\u0007' })).toBeUndefined();
    expect(sanitizeToken({ ...base, chainId: '1' })).toBeUndefined();
    expect(sanitizeToken(null)).toBeUndefined();
    expect(sanitizeToken('token')).toBeUndefined();
  });

  it('caps text length and falls back to the symbol for a missing name', () => {
    const t = sanitizeToken({ chainId: 1, address: USDC, symbol: 'S'.repeat(100), decimals: 0 });
    expect(t?.symbol).toHaveLength(16);
    expect(t?.name).toBe(t?.symbol);
    expect(cleanText('a\n\tb   c', 10)).toBe('a b c');
  });

  it('accepts only safe logo URLs', () => {
    expect(normalizeLogoUrl('http://example.com/a.png')).toBeUndefined();
    expect(normalizeLogoUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeLogoUrl('data:image/svg+xml,<svg/>')).toBeUndefined();
    expect(normalizeLogoUrl('https://user:pw@example.com/a.png')).toBeUndefined();
    expect(normalizeLogoUrl(42)).toBeUndefined();
    expect(normalizeLogoUrl('ipfs://QmXttGpZrECX5qCyXbBQiqgQNytVGeZW5Anewvh2jc4psg')).toBe(
      'https://ipfs.io/ipfs/QmXttGpZrECX5qCyXbBQiqgQNytVGeZW5Anewvh2jc4psg',
    );
    expect(normalizeLogoUrl('https://coin-images.coingecko.com/coins/images/1/large/x.png?1')).toBe(
      'https://coin-images.coingecko.com/coins/images/1/small/x.png',
    );
  });

  it('builds mirror URLs only for chains the mirror has', () => {
    expect(mirrorLogoUrl(1, USDC.toLowerCase())).toBe(
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${USDC}/logo.png`,
    );
    expect(mirrorLogoUrl(999, USDC)).toBeUndefined();
  });

  it('parses a token list, filters chains and de-duplicates', () => {
    const list = {
      version: { major: 1, minor: 2, patch: 3 },
      tokens: [
        { chainId: 1, address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
        { chainId: 1, address: USDC.toLowerCase(), symbol: 'FAKE', name: 'Dup', decimals: 6 },
        { chainId: 10, address: WETH, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
        { chainId: 1, address: 'nope', symbol: 'BAD', name: 'Bad', decimals: 18 },
        'garbage',
      ],
    };
    const parsed = parseTokenList(list, [1, 8453]);
    expect(parsed.version).toBe('1.2.3');
    expect(parsed.byChain.get(1)?.map((t) => t.symbol)).toEqual(['USDC']);
    expect(parsed.byChain.has(10)).toBe(false);
    expect(() => parseTokenList({ tokens: 'x' }, [1])).toThrow();
    expect(() => parseTokenList(null, [1])).toThrow();
  });

  it('round-trips the compact form', () => {
    const tokens = [
      { chainId: 1, address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: 'https://x.io/a.png' },
      { chainId: 1, address: WETH, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    ] as const;
    expect(unpackTokens(1, packTokens([...tokens]))).toEqual(tokens);
    expect(unpackTokens(1, [['bad', 'X', 'X', 18], 5, null])).toEqual([]);
    expect(unpackTokens(1, 'nope')).toEqual([]);
  });

  it('always puts USDC and the wrapped native token first', () => {
    const chain = { id: 1, nativeSymbol: 'ETH', nativeName: 'Ether', wrappedNative: WETH, usdc: USDC } as const;
    const out = withEssentials(
      [{ chainId: 1, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai', decimals: 18 }],
      chain,
    );
    expect(out.map((t) => t.symbol)).toEqual(['USDC', 'WETH', 'DAI']);
    expect(out[0].decimals).toBe(6);
    expect(out[1].name).toBe('Wrapped Ether');
  });
});

describe('HyperEVM token list', () => {
  const spotMeta = {
    tokens: [
      {
        name: 'USDC',
        weiDecimals: 8,
        index: 0,
        evmContract: { address: '0x6b9e773128f453f5c2c60935ee2de2cbc5390a24', evm_extra_wei_decimals: -2 },
        fullName: null,
      },
      {
        name: 'PURR',
        weiDecimals: 5,
        index: 1,
        evmContract: { address: '0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e', evm_extra_wei_decimals: 13 },
        fullName: null,
      },
      { name: 'HYPE', weiDecimals: 8, index: 150, evmContract: null, fullName: 'Hyperliquid' },
      {
        name: 'UBTC',
        weiDecimals: 10,
        index: 197,
        evmContract: { address: '0x9fdbda0a5e284c32744d2f17ee5c74b284993463', evm_extra_wei_decimals: -2 },
        fullName: 'Unit Bitcoin',
      },
      {
        name: 'ZERO',
        weiDecimals: 8,
        index: 300,
        evmContract: { address: '0x0000000000000000000000000000000000000000', evm_extra_wei_decimals: 10 },
        fullName: null,
      },
      { name: 'BROKEN', weiDecimals: 8, index: 301, evmContract: { address: '0x12' } },
    ],
  };

  it('derives tokens from spotMeta', () => {
    const tokens = deriveHyperEvmTokens(spotMeta, 999);
    expect(tokens).toEqual([
      {
        chainId: 999,
        address: '0x9b498C3c8A0b8CD8BA1D9851d40D186F1872b44E',
        symbol: 'PURR',
        name: 'PURR',
        decimals: 18,
      },
      {
        chainId: 999,
        address: '0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463',
        symbol: 'UBTC',
        name: 'Unit Bitcoin',
        decimals: 8,
      },
    ]);
    expect(() => deriveHyperEvmTokens({}, 999)).toThrow();
  });

  it('adds native USDC and WHYPE from the chain config', () => {
    const out = withEssentials(deriveHyperEvmTokens(spotMeta, 999), {
      id: 999,
      nativeSymbol: 'HYPE',
      nativeName: 'Hyperliquid',
      wrappedNative: '0x5555555555555555555555555555555555555555',
      usdc: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
    });
    expect(out.map((t) => t.symbol)).toEqual(['USDC', 'WHYPE', 'PURR', 'UBTC']);
  });
});

describe('icon symbol aliases', () => {
  it('maps wrapped and bridged variants to the base icon', () => {
    expect(iconSymbol('WETH')).toBe('ETH');
    expect(iconSymbol('whype')).toBe('HYPE');
    expect(iconSymbol('USDT0')).toBe('USDT');
    expect(iconSymbol('USD₮0')).toBe('USDT');
    expect(iconSymbol('UBTC')).toBe('BTC');
    expect(iconSymbol('USOL')).toBe('SOL');
    expect(iconSymbol('LINK')).toBe('LINK');
  });

  it('handles Hyperliquid coin names', () => {
    expect(iconSymbol('kPEPE', true)).toBe('PEPE');
    expect(iconSymbol('xyz:AMZN', true)).toBe('AMZN');
    expect(iconSymbol('km:kBONK', true)).toBe('BONK');
    expect(iconSymbol('UETH', true)).toBe('ETH');
    // Without the flag a leading "k" is part of the symbol.
    expect(iconSymbol('kPEPE')).toBe('KPEPE');
    expect(iconSymbol('KHYPE', true)).toBe('KHYPE');
  });

  it('gives a stable hue', () => {
    expect(symbolHue('PURR')).toBe(symbolHue('PURR'));
    expect(symbolHue('PURR')).toBeGreaterThanOrEqual(0);
    expect(symbolHue('PURR')).toBeLessThan(360);
  });
});
