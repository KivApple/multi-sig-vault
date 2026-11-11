import { ArrowUpRight } from 'lucide-react';
import { encodeFunctionData, getAddress, parseUnits } from 'viem';
import { SafeSendForm } from '@/components/ops/safe/SafeSendForm';
import { getChain } from '@/config/chains';
import { formatAmount, isDecimal, sameAddress, trimDecimal } from '@/lib/format';
import { ERC20_ABI } from '@/lib/safe/abis';
import { formatUnits } from 'viem';
import { addressError } from '../hl/common';
import type { OpDefinition } from '../types';

export interface SafeSendParams {
  /** Token contract; empty string – native coin. */
  token: string;
  symbol: string;
  decimals: number;
  recipient: string;
  amount: string;
}

export const safeSendOp: OpDefinition<SafeSendParams> = {
  type: 'safe.send',
  kind: 'safe',
  icon: ArrowUpRight,
  available: (env) => !!env.safe,
  defaults: (env) => ({
    token: '',
    symbol: getChain(env.account.chainId as number).nativeSymbol,
    decimals: 18,
    recipient: '',
    amount: '',
  }),
  Form: SafeSendForm,
  validate: (p, env, t) => {
    const errors: Record<string, string> = {};
    const r = addressError(p.recipient, t, env.account.address);
    if (r) errors.recipient = r;
    else if (p.token && sameAddress(p.recipient, p.token)) errors.recipient = t('safe.send.tokenContract');
    const holding = env.safe?.holdings.find((h) => (h.token?.address ?? '') === p.token);
    if (!p.amount) errors.amount = t('error.required');
    else if (!isDecimal(p.amount, p.decimals) || Number(p.amount) <= 0) {
      errors.amount = t('amount.invalid', { decimals: p.decimals });
    } else if (holding && parseUnits(p.amount, p.decimals) > BigInt(holding.balance)) {
      errors.amount = t('amount.exceeds');
    }
    return errors;
  },
  buildSafe: (p) => {
    const amount = parseUnits(trimDecimal(p.amount), p.decimals);
    const recipient = getAddress(p.recipient);
    return p.token
      ? [
          {
            to: getAddress(p.token),
            value: 0n,
            data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [recipient, amount] }),
          },
        ]
      : [{ to: recipient, value: amount, data: '0x' }];
  },
  summary: (p, { t, lang, account }) => [
    { label: t('ops.amount'), value: `${formatAmount(p.amount, lang, 8)} ${p.symbol}` },
    ...(p.token ? [{ label: t('ops.tokenContract'), value: p.token, mono: true }] : []),
    { label: t('ops.recipient'), address: getAddress(p.recipient), chainId: account.chainId },
    { label: t('common.network'), value: getChain(account.chainId as number).name },
  ],
};

export const holdingAmount = (balance: string, decimals: number): string => formatUnits(BigInt(balance), decimals);
