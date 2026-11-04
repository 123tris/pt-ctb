// Bananas 🍌, PT Catch's play money, in markup: the amounts, a wallet's ledger and the sign-in button, as
// assets/js/core/bananas.js draws them. What talks to the site's endpoints (requests, the session) stays the old
// module's, for mount() through client/legacy.ts: it needs the browser.
//
// The bot is the bank: everything here is a preview of its rules (CURRENCY-DESIGN.md has the amounts), never the rule.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';

/** The rules the site shows before you confirm: bananas.js RULES, the same numbers (change both together). */
export const RULES = {
  gate: 1000, // earned before you can post a bounty
  minStake: 500,
  feeRate: 0.2, // of the stake, burned
  postsPerMonth: 1,
  openAtOnce: 2,
  minFund: 25,
  tipMin: 5,
  tipMax: 50,
  pouchCap: 300,
  days: [30, 60, 90],
  defaultDays: 60,
  mods: ['HD', 'HR', 'DT', 'FL'],
} as const;

/** A player's wallet in economy.json (tools/lib/economy.mjs). */
export interface Wallet {
  /** Balance */
  b: number;
  /** In the pouch, while they've never signed in */
  p: number;
  /** Earned (what the bounty gate counts) */
  e: number;
  /** In open bounties */
  x: number;
  /** Signed in on the site (1) */
  s: number;
  /** Snipe shield on (1) */
  sh: number;
  /** Profile title, or null */
  t: string | null;
}

/** A wallet's ledger line (players/{id}.json `ledger`): [time, amount, kind, in the pouch, note]. */
export type LedgerRow = readonly [number, number, string, number, string | null];

/** "1,234 🍌": the currency's unit follows every amount, as ★ follows stars (DESIGN.md §6). */
export const bananas = (ctx: Ctx, n: number): string => `${ctx.fmt.num(n)} 🍌`;
/** "+20 🍌" / "−20 🍌", for ledger lines. */
export const signedBananas = (ctx: Ctx, n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${bananas(ctx, Math.abs(n))}`;

/** What each kind of ledger line is, in a few words (the contract's kinds). */
export function kindLabel(ctx: Ctx, kind: string): string {
  const { t } = ctx;
  const labels: Record<string, string> = {
    'daily.play': t('Daily play'), 'daily.game': t('Daily game'), snipe: t('Snipe'),
    'hill.take': t('King of the hill slot'), 'fc.first': t('First PT FC'), 'pass.first': t('First PT pass'),
    'hill.crown': t('Crown'), 'hill.title': t('King of the hill title'), 'motw.play': t('Map of the week'),
    'motw.top': t('Map of the week top 3'), vote: t('Weekly vote'), dan: t('Dan stage'), badge: t('Badge'),
    record: t('Site record'), 'bounty.claim': t('Bounty claimed'), grant: t('Launch grant'),
    'tip.in': t('Tip received'), 'tip.out': t('Tip sent'), 'bounty.stake': t('Bounty stake'),
    'bounty.fee': t('Posting fee'), 'bounty.fund': t('Bounty funded'), 'bounty.refund': t('Bounty refund'),
    shop: t('Shop'), collect: t('Pouch collected'), adjust: t('Correction'), reverse: t('Reversed'),
    lost: t('Lost: the pouch was full'),
  };
  return labels[kind] ?? kind;
}

/** A wallet's latest lines, newest first; nothing when there are none. */
export const ledgerList = (ctx: Ctx, rows: readonly LedgerRow[] | null | undefined): Safe | '' => (rows?.length
  ? html`<ul class="ledger">${rows.map(([at, amount, kind, pouch, note]) => html`<li>
  <span>${kindLabel(ctx, kind)}${pouch ? html` <span class="faint">· ${ctx.t('in the pouch')}</span>` : ''}${note ? html` <span class="faint">· ${note}</span>` : ''}</span>
  <b class="${amount < 0 ? 'ledger-out' : ''}">${amount ? signedBananas(ctx, amount) : '—'}</b>
  <span class="faint" title="${ctx.fmt.dateTime(at)}">${ctx.fmt.ago(at)}</span>
</li>`)}</ul>`
  : '');

/**
 * "Sign in with osu!" where it works (`signInHere`: bananas.js signInHere(), the build's own address), a sentence saying
 * where it does otherwise. The old app's sign-in takes the clicks on [data-signin].
 */
export const signInButton = (ctx: Ctx, signInHere: boolean, label = ctx.t('Sign in with osu!')): Safe => (signInHere
  ? html`<button class="btn btn-small" type="button" data-signin>${label}</button>`
  : html`<span class="faint small">${ctx.t('Signing in works on ptcatch.com.')}</span>`);

/**
 * The wallet as a line: "Your wallet: 679 🍌", plus "150 🍌 of it waiting for the bot" when requests are pending (`pending`
 * is pendingSpend() of them), so what can still be spent is what's left.
 */
export function walletLine(ctx: Ctx, w: Pick<Wallet, 'b'>, pending: number): Safe {
  const amount = html`<b>${bananas(ctx, w.b)}</b>`;
  return pending ? ctx.th('Your wallet: {amount}, {pending} of it waiting for the bot', { amount, pending: bananas(ctx, pending) })
    : ctx.th('Your wallet: {amount}', { amount });
}
