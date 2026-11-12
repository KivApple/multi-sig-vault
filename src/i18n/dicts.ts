import core from "./dict/core";
import shared from "./dict/shared";
import wallets from "./dict/wallets";
import qr from "./dict/qr";
import update from "./dict/update";
import tokens from "./dict/tokens";
import accounts from "./dict/accounts";
import signers from "./dict/signers";
import settings from "./dict/settings";
import ops from "./dict/ops";
import hl from "./dict/hl";
import safe from "./dict/safe";
import swap from "./dict/swap";
import advanced from "./dict/advanced";
import addAccount from "./dict/addAccount";
import handoff from "./dict/handoff";
import type { ModuleDict } from "./define";

export const DICTS: ModuleDict[] = [
	core,
	shared,
	wallets,
	qr,
	update,
	tokens,
	accounts,
	signers,
	settings,
	ops,
	hl,
	safe,
	swap,
	advanced,
	addAccount,
	handoff,
];
