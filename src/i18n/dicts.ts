import core from './dict/core';
import wallets from './dict/wallets';
import qr from './dict/qr';
import update from './dict/update';
import tokens from './dict/tokens';
import accounts from './dict/accounts';
import signers from './dict/signers';
import settings from './dict/settings';
import ops from './dict/ops';
import hl from './dict/hl';
import safe from './dict/safe';
import type { ModuleDict } from './define';

export const DICTS: ModuleDict[] = [core, wallets, qr, update, tokens, accounts, signers, settings, ops, hl, safe];
