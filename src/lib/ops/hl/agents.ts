import { KeyRound, KeySquare, LogIn } from 'lucide-react';
import { ApproveAgentForm } from '@/components/ops/hl/ApproveAgentForm';
import { AgentKeyResult } from '@/components/ops/hl/AgentKeyResult';
import { LoginForm } from '@/components/ops/hl/LoginForm';
import { LoginResult } from '@/components/ops/hl/LoginResult';
import { RevokeAgentForm } from '@/components/ops/hl/RevokeAgentForm';
import { ZERO_ADDRESS } from '@/config/constants';
import { parseAddress } from '@/lib/format';
import type { OpDefinition, OpErrors } from '../types';
import { ensureAgentKey, nameError } from './common';

export interface AgentParams {
  /** `generate` – the app creates the key and keeps it until the result card is deleted. */
  mode: 'generate' | 'manual';
  agentAddress: string;
  name: string;
}

const agentAction = (address: string, name: string): Record<string, unknown> => ({
  type: 'approveAgent',
  agentAddress: address.toLowerCase(),
  agentName: name.trim(),
});

export const approveAgentOp: OpDefinition<AgentParams> = {
  type: 'hl.approveAgent',
  kind: 'hl',
  icon: KeyRound,
  available: (env) => !!env.hl,
  defaults: () => ({ mode: 'generate', agentAddress: '', name: '' }),
  init: async (opId) => ({ agentAddress: await ensureAgentKey(opId) }),
  Form: ApproveAgentForm,
  validate: (p, _env, t) => {
    const errors: Record<string, string> = {};
    const n = nameError(p.name, t);
    if (n) errors.name = n;
    if (!parseAddress(p.agentAddress)) errors.agentAddress = t(p.mode === 'manual' ? 'error.invalidAddress' : 'hl.agent.noKey');
    return errors;
  },
  buildHl: (p) => agentAction(p.agentAddress, p.name),
  summary: (p, { t }) => [
    { label: t('common.name'), value: p.name.trim() },
    { label: t('hl.agent.address'), value: p.agentAddress, mono: true },
    { label: t('hl.agent.key'), value: t(p.mode === 'generate' ? 'hl.agent.keyGenerated' : 'hl.agent.keyManual') },
  ],
  Result: AgentKeyResult,
  hasSecret: (p) => p.mode === 'generate',
  deleteWarning: (op) => ((op.params as unknown as AgentParams).mode === 'generate' ? 'hl.agent.deleteWarning' : undefined),
};

export interface LoginParams {
  agentAddress: string;
  name: string;
}

/** Web login = approving a named agent whose key the app generated; the result card builds the login link. */
export const loginOp: OpDefinition<LoginParams> = {
  type: 'hl.login',
  kind: 'hl',
  icon: LogIn,
  available: (env) => !!env.hl,
  defaults: () => ({ agentAddress: '', name: 'Vault login' }),
  init: async (opId) => ({ agentAddress: await ensureAgentKey(opId) }),
  Form: LoginForm,
  validate: (p, _env, t) => {
    const errors: Record<string, string> = {};
    const n = nameError(p.name, t);
    if (n) errors.name = n;
    if (!parseAddress(p.agentAddress)) errors.agentAddress = t('hl.agent.noKey');
    return errors;
  },
  buildHl: (p) => agentAction(p.agentAddress, p.name),
  summary: (p, { t }) => [
    { label: t('hl.login.agentName'), value: p.name.trim() },
    { label: t('hl.agent.address'), value: p.agentAddress, mono: true },
  ],
  Result: LoginResult,
  hasSecret: () => true,
  deleteWarning: () => 'hl.login.deleteWarning',
};

export interface RevokeParams {
  name: string;
  address: string;
}

export const revokeAgentOp: OpDefinition<RevokeParams> = {
  type: 'hl.revokeAgent',
  kind: 'hl',
  icon: KeySquare,
  available: (env) => (env.hlExtras?.agents.length ?? 0) > 0,
  defaults: (env) => {
    const first = env.hlExtras?.agents[0];
    return { name: first?.name ?? '', address: first?.address ?? '' };
  },
  Form: RevokeAgentForm,
  validate: (p, _env, t): OpErrors => (p.name ? {} : { name: t('error.required') }),
  // Approving the zero address under the same name removes the named agent.
  buildHl: (p) => agentAction(ZERO_ADDRESS, p.name),
  summary: (p, { t }) => [
    { label: t('common.name'), value: p.name },
    { label: t('hl.agent.address'), value: p.address, mono: true },
  ],
};
