import { ArrowDownUp, ArrowUpFromLine, Landmark, Send, SendHorizontal } from 'lucide-react';
import { getChain, HL_BRIDGE_CHAIN, HL_EVM_CHAIN } from '@/config/chains';
import { ClassTransferForm } from '@/components/ops/hl/ClassTransferForm';
import { SpotSendForm } from '@/components/ops/hl/SpotSendForm';
import { SpotWithdrawForm } from '@/components/ops/hl/SpotWithdrawForm';
import { UsdSendForm } from '@/components/ops/hl/UsdSendForm';
import { WithdrawForm } from '@/components/ops/hl/WithdrawForm';
import { formatAmount, trimDecimal } from '@/lib/format';
import { HL_WITHDRAW_FEE, hlSystemAddress } from '@/lib/hl/account';
import type { OpDefinition, OpErrors } from '../types';
import { addressError, amountError } from './common';

export interface UsdParams {
  destination: string;
  amount: string;
}

export const withdrawOp: OpDefinition<UsdParams> = {
  type: 'hl.withdraw',
  kind: 'hl',
  icon: ArrowUpFromLine,
  available: (env) => !!env.hl,
  defaults: () => ({ destination: '', amount: '' }),
  Form: WithdrawForm,
  validate: (p, env, t) => {
    const errors: Record<string, string> = {};
    const d = addressError(p.destination, t);
    if (d) errors.destination = d;
    const a = amountError(p.amount, t, {
      decimals: 6,
      max: env.hl?.withdrawable,
      min: HL_WITHDRAW_FEE,
      minExclusive: true,
      symbol: 'USDC',
    });
    if (a) errors.amount = a;
    return errors;
  },
  buildHl: (p) => ({ type: 'withdraw3', destination: p.destination.toLowerCase(), amount: trimDecimal(p.amount) }),
  summary: (p, { t, lang, account }) => [
    { label: t('ops.amount'), value: `${formatAmount(p.amount, lang)} USDC` },
    { label: t('ops.fee'), value: `${HL_WITHDRAW_FEE} USDC` },
    { label: t('ops.receives'), value: `${formatAmount(Number(p.amount) - HL_WITHDRAW_FEE, lang)} USDC` },
    { label: t('ops.recipient'), address: p.destination as never, chainId: HL_BRIDGE_CHAIN[account.env] },
    { label: t('common.network'), value: getChain(HL_BRIDGE_CHAIN[account.env]).name },
  ],
};

export const usdSendOp: OpDefinition<UsdParams> = {
  type: 'hl.usdSend',
  kind: 'hl',
  icon: Send,
  available: (env) => !!env.hl,
  defaults: () => ({ destination: '', amount: '' }),
  Form: UsdSendForm,
  validate: (p, env, t) => {
    const errors: Record<string, string> = {};
    const d = addressError(p.destination, t, env.account.address);
    if (d) errors.destination = d;
    const a = amountError(p.amount, t, { decimals: 6, max: env.hl?.withdrawable });
    if (a) errors.amount = a;
    return errors;
  },
  buildHl: (p) => ({ type: 'usdSend', destination: p.destination.toLowerCase(), amount: trimDecimal(p.amount) }),
  summary: (p, { t, lang }) => [
    { label: t('ops.amount'), value: `${formatAmount(p.amount, lang)} USDC` },
    { label: t('ops.recipient'), address: p.destination as never },
    { label: t('common.network'), value: 'Hyperliquid' },
  ],
};

export interface SpotParams {
  destination: string;
  /** Token index on HyperCore. */
  token: number | null;
  /** `NAME:0xTokenId` – resolved when the token is picked. */
  tokenRef: string;
  coin: string;
  amount: string;
}

const spotErrors: OpDefinition<SpotParams>['validate'] = (p, env, t) => {
  const errors: Record<string, string> = {};
  const held = env.hl?.spot.find((s) => s.token === p.token);
  if (p.token === null || !p.tokenRef) errors.token = t('error.required');
  const a = amountError(p.amount, t, { decimals: 8, max: held?.available });
  if (a) errors.amount = a;
  return errors;
};

export const spotSendOp: OpDefinition<SpotParams> = {
  type: 'hl.spotSend',
  kind: 'hl',
  icon: SendHorizontal,
  available: (env) => !!env.hl && env.hl.spot.length > 0,
  defaults: () => ({ destination: '', token: null, tokenRef: '', coin: '', amount: '' }),
  Form: SpotSendForm,
  validate: (p, env, t) => {
    const errors = spotErrors(p, env, t);
    const d = addressError(p.destination, t, env.account.address);
    if (d) errors.destination = d;
    return errors;
  },
  buildHl: (p) => ({
    type: 'spotSend',
    destination: p.destination.toLowerCase(),
    token: p.tokenRef,
    amount: trimDecimal(p.amount),
  }),
  summary: (p, { t, lang }) => [
    { label: t('ops.amount'), value: `${formatAmount(p.amount, lang, 8)} ${p.coin}` },
    { label: t('ops.recipient'), address: p.destination as never },
    { label: t('common.network'), value: 'Hyperliquid' },
  ],
};

/** Spot token → HyperEVM: a spot transfer to the token's system address credits the same address on HyperEVM. */
export const spotWithdrawOp: OpDefinition<SpotParams> = {
  type: 'hl.spotWithdraw',
  kind: 'hl',
  icon: Landmark,
  available: (env) => !!env.hl && env.hl.spot.some((s) => s.evm && s.token !== 0),
  defaults: () => ({ destination: '', token: null, tokenRef: '', coin: '', amount: '' }),
  Form: SpotWithdrawForm,
  validate: spotErrors,
  buildHl: (p) => ({
    type: 'spotSend',
    destination: hlSystemAddress(p.token as number, p.coin).toLowerCase(),
    token: p.tokenRef,
    amount: trimDecimal(p.amount),
  }),
  summary: (p, { t, lang, account }) => [
    { label: t('ops.amount'), value: `${formatAmount(p.amount, lang, 8)} ${p.coin}` },
    { label: t('ops.recipient'), address: account.address, chainId: HL_EVM_CHAIN[account.env] },
    { label: t('common.network'), value: getChain(HL_EVM_CHAIN[account.env]).name },
    { label: t('hl.evmKeyNote.label'), value: t('hl.evmKeyNote'), tone: 'warning' },
  ],
};

export interface ClassTransferParams {
  amount: string;
  toPerp: boolean;
}

export const classTransferOp: OpDefinition<ClassTransferParams> = {
  type: 'hl.classTransfer',
  kind: 'hl',
  icon: ArrowDownUp,
  available: (env) => !!env.hl && !env.hl.unified,
  defaults: () => ({ amount: '', toPerp: true }),
  Form: ClassTransferForm,
  validate: (p, env, t): OpErrors => {
    const max = p.toPerp ? (env.hl?.spot.find((s) => s.token === 0)?.available ?? '0') : env.hl?.withdrawable;
    const a = amountError(p.amount, t, { decimals: 6, max });
    return a ? { amount: a } : {};
  },
  buildHl: (p) => ({ type: 'usdClassTransfer', amount: trimDecimal(p.amount), toPerp: p.toPerp }),
  summary: (p, { t, lang }) => [
    { label: t('ops.amount'), value: `${formatAmount(p.amount, lang)} USDC` },
    { label: t('ops.direction'), value: t(p.toPerp ? 'hl.spotToPerp' : 'hl.perpToSpot') },
  ],
};
