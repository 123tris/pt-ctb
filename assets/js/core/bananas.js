// Bananas 🍌, PT Catch's play money, in the browser: the rules the site shows before you confirm, the signed-in
// session (core/you.js keeps it), the calls to the site's endpoints (economy/api.js) and the pieces the pages share.
//
// The bot is the bank. The site shows balances from economy.json (the export) and forwards requests; the bot judges
// every one (balance, the 1,000-earned gate, the monthly limit) and its answer comes back within 15 minutes. So
// everything here is a preview of the bot's rules, never the rule itself: CURRENCY-DESIGN.md has the amounts.

import { html } from './html.js';
import { meta, load } from './data.js';
import { prefs } from './ui.js';
import { toast } from './fun.js';
import { track } from './track.js';
import * as fmt from './fmt.js';
import { t, th } from './i18n.js';
import { CONFIG } from '../config.js';

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
};
export const fee = stake => Math.round(stake * RULES.feeRate);

/** The shop (CURRENCY-DESIGN.md §5). `approval`: a moderator says yes first, and it's refunded if not. */
export const SHOP = [
  { item: 'title', price: 150, name: t('Profile title'), about: t('Show one of your titles or badges next to your name on your profile.') },
  { item: 'signature', price: 100, name: t('Signature play'), about: t('Pin one of your plays to the top of your profile.') },
  { item: 'colour', price: 250, name: t('Name colour, 30 days'), about: t('Your name in a colour of your choice on the site’s leaderboards for 30 days.') },
  { item: 'motw', price: 120, approval: true, name: t('Map of the week nomination'), about: t('Put a map forward for the map of the week.') },
  { item: 'wildcard', price: 400, approval: true, name: t('King of the hill wildcard'), about: t('Pick next month’s Challenger convert map, within the pool’s rules.') },
  { item: 'role', price: 200, name: t('Discord colour role, 7 days'), about: t('A colour role on the Discord for a week.') },
];

/** "1,234 🍌": the currency's unit follows the number, as ★ does (DESIGN.md §6). */
export const bananas = n => `${fmt.num(n)} 🍌`;

/** economy.json (tools/lib/economy.mjs), or null while the bot hasn't started Bananas. */
export const economy = async () => ((await meta()).files?.['economy.json'] ? load('economy.json') : null);

// ---- The session ----------------------------------------------------------------------------------------------------

/** Sign-in only works on the build's own address (core/you.js). */
export const signInHere = () => Boolean(CONFIG.signIn && (!CONFIG.home || location.origin === new URL(CONFIG.home).origin));

/** The signed-in player, { id, token, exp }, while the 30-day session lasts; null otherwise. */
export function session() {
  const s = prefs.get('osuSession', null);
  return s?.token && s.exp > Date.now() / 1000 && prefs.get('osuMe', null) === s.id ? s : null;
}

/** Asks the site's endpoints, signed in. { ok, status, body }; a refused session is forgotten. */
export async function api(path, { method = 'GET', body } = {}) {
  const s = session();
  if (!s) return { ok: false, status: 401, body: { error: t('Sign in with osu! first.') } };
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, body: { error: t('The site couldn’t be reached. Check your connection and try again.') } };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) prefs.set('osuSession', null);
  return { ok: res.ok, status: res.status, body: data };
}

/** The endpoints' own messages (economy/store.js, economy/api.js), so they can be shown in Portuguese too. */
const SERVER_TEXT = /* i18n */ [
  'That isn’t a request the bot takes.', 'The bounty needs a map, a goal, a stake and a duration of 30, 60 or 90 days.',
  'Funding needs a bounty and an amount.', 'A tip needs a player and an amount.', 'You can’t tip yourself.', 'That isn’t in the shop.',
  'Shield needs on or off.', 'Pick one of the six maps.', 'You already tried that one.',
  'You’ve played today’s map. A new one comes at midnight, Lisbon time.',
];
void SERVER_TEXT;

/** What the site said went wrong, in the visitor's language where it's one of ours. */
const problem = (status, body) => (status === 401 ? t('Your sign-in has run out. Sign in with osu! again.')
  : status === 503 ? t('Bananas aren’t set up on this copy of the site.')
    : status === 429 ? t('You have several requests waiting for the bot already. It takes them every 15 minutes; try again after.')
      : body?.error ? t(body.error) : t('That didn’t go through. Try again in a moment.'));

/** Queues a request for the bot. True when it's queued; says why when not. */
export async function sendRequest(type, payload) {
  const res = await api('/api/wallet/request', { method: 'POST', body: { type, payload } });
  track('use', 'bananas', type);
  if (res.ok) {
    toast(t('Sent to the bot. It answers within 15 minutes; your wallet shows the result.'));
    window.dispatchEvent(new CustomEvent('ptctb:requests'));
    return true;
  }
  toast(problem(res.status, res.body));
  return false;
}

/** The signed-in player's requests (newest first), or null when they can't be read. */
export async function myRequests() {
  const res = await api('/api/wallet/requests');
  return res.ok ? res.body.requests : null;
}

// ---- Pieces the pages share -----------------------------------------------------------------------------------------

/** "Sign in with osu!" where it works here; a sentence saying where it does otherwise. */
export const signInButton = (label = t('Sign in with osu!')) => (signInHere()
  ? html`<button class="btn btn-small" type="button" data-signin>${label}</button>`
  : html`<span class="faint small">${t('Signing in works on ptcatch.com.')}</span>`);

const MOD_TEXT = mods => (mods ? ` +${mods}` : '');
const GOAL_TEXT = { fc: t('Full combo'), pass: t('First pass'), snipe: t('Snipe') };
const ITEM_NAME = Object.fromEntries(SHOP.map(s => [s.item, s.name]));

/** One line saying what a request asks for: "Post a bounty: FC on map 123, stake 500". */
export function requestText(r, index) {
  const p = r.payload;
  switch (r.type) {
    case 'bounty.create': return th('Post a bounty: {goal}{mods} on {map}, stake {stake}', {
      goal: GOAL_TEXT[p.goal], mods: MOD_TEXT(p.mods), map: html`<a href="#/map/${p.map}">${t('map {id}', { id: p.map })}</a>`, stake: bananas(p.stake),
    });
    case 'bounty.fund': return t('Fund bounty #{id} with {amount}', { id: p.bountyId, amount: bananas(p.amount) });
    case 'tip': return th('Tip {who} {amount}', { who: html`<a href="#/player/${p.to}">${index?.get(p.to)?.name ?? `#${p.to}`}</a>`, amount: bananas(p.amount) });
    case 'shop.buy': return t('Buy: {item}', { item: ITEM_NAME[p.item] ?? p.item });
    case 'shield': return p.on ? t('Turn the snipe shield on') : t('Turn the snipe shield off');
    default: return r.type;
  }
}

const STATUS = {
  pending: () => html`<span class="req-status">${t('waiting for the bot')}</span>`,
  accepted: () => html`<span class="req-status req-ok">✓ ${t('done')}</span>`,
  rejected: reason => html`<span class="req-status req-no">✕ ${reason ? t('refused: {reason}', { reason }) : t('refused')}</span>`,
};

/** The player's requests as a list with what the bot said; nothing when there are none. */
export function requestList(requests, index, { limit = 5 } = {}) {
  if (!requests?.length) return '';
  return html`<ul class="req-list">${requests.slice(0, limit).map(r => html`<li>
    <span>${requestText(r, index)}</span> ${STATUS[r.status]?.(r.reason) ?? ''}
    <span class="faint" title="${fmt.dateTime(Date.parse(r.t) / 1000)}">${fmt.ago(Date.parse(r.t) / 1000)}</span>
  </li>`)}</ul>`;
}

/** Reads a map id from what someone typed: an id, or an osu! beatmap link ("…/beatmaps/123", "…#fruits/123"). */
export function mapIdFrom(text) {
  const s = String(text).trim();
  const m = /^(\d{1,10})$/.exec(s) ?? /\/beatmaps\/(\d{1,10})(?:\b|$)/.exec(s) ?? /#(?:osu|taiko|fruits|mania)\/(\d{1,10})/.exec(s) ?? /\/b\/(\d{1,10})/.exec(s);
  return m ? Number(m[1]) : null;
}

/** What each kind of ledger line is, in a few words (the contract's kinds). */
const KIND_LABEL = {
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
export const kindLabel = kind => KIND_LABEL[kind] ?? kind;

/** A wallet's latest lines (economy.json `r`: [t, amount, kind, pouch, note]), newest first. */
export const ledgerList = rows => (rows?.length ? html`<ul class="ledger">${rows.map(([at, amount, kind, pouch, note]) => html`<li>
  <span>${kindLabel(kind)}${pouch ? html` <span class="faint">· ${t('in the pouch')}</span>` : ''}${note ? html` <span class="faint">· ${note}</span>` : ''}</span>
  <b class="${amount < 0 ? 'ledger-out' : ''}">${amount > 0 ? '+' : amount < 0 ? '−' : ''}${fmt.num(Math.abs(amount))}</b>
  <span class="faint" title="${fmt.dateTime(at)}">${fmt.ago(at)}</span>
</li>`)}</ul>` : '');
