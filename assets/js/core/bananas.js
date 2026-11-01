// Bananas 🍌, PT Catch's play money, in the browser: the rules the site shows before you confirm, the signed-in
// session (core/you.js keeps it), the calls to the site's endpoints (economy/api.js) and the pieces the pages share.
//
// The bot is the bank. The site shows balances from economy.json (the export) and forwards requests; the bot judges
// every one (balance, the 1,000-earned gate, the monthly limit) and its answer comes back within 15 minutes. So
// everything here is a preview of the bot's rules, never the rule itself: CURRENCY-DESIGN.md has the amounts.

import { html } from './html.js';
import { meta, load } from './data.js';
import { prefs, mapLabel, myId } from './ui.js';
import { toast } from './fun.js';
import { track } from './track.js';
import * as fmt from './fmt.js';
import { t, th, tn } from './i18n.js';
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

/**
 * The shop (CURRENCY-DESIGN.md §5; prices and gates as bananas-contract.md §6 lists them, which the bot's Bananas options
 * must match: the bot doesn't export them), in two groups: `look` (cosmetics) and `community` (picks a moderator approves
 * first, `approval`, refunded if refused). `days` is how long a timed item lasts; `gate` the earned bananas it needs, as
 * for posting a bounty; `monthly` an item only one player in PT gets per Lisbon month (the first the bot accepts).
 * A timed item's `price` is per period of `days`; `periods` are how many periods can be bought at once (stacked, up to
 * a year), named by `unit`.
 */
export const SHOP = [
  { item: 'title', group: 'look', price: 500, name: t('Profile title'), about: t('Show one of your titles or badges next to your name.') },
  { item: 'signature', group: 'look', price: 350, name: t('Signature play'), about: t('Pin one of your plays to the top of your profile.') },
  { item: 'colour', group: 'look', price: 500, days: 30, periods: [1, 2, 3, 6, 12], unit: 'month', gate: 1000, name: t('Name colour'), about: t('Your name in a colour you pick on the site’s leaderboards, 30 days at a time, up to a year.') },
  { item: 'role', group: 'look', price: 150, days: 7, periods: [1, 2, 4, 8, 13, 26, 52], unit: 'week', gate: 1000, name: t('Discord colour role'), about: t('A colour role on the Discord, a week at a time, up to a year.') },
  { item: 'motw', group: 'community', price: 400, approval: true, name: t('Map of the week nomination'), about: t('Put a map forward for the map of the week.') },
  { item: 'wildcard', group: 'community', price: 1500, gate: 1000, monthly: true, approval: true, name: t('King of the hill wildcard'), about: t('Pick the convert map (4.5–6.5★) for next month’s Challenger tier.') },
];
export const shopItem = item => SHOP.find(s => s.item === item);
/** "3 months" / "26 weeks": how long `n` periods of a timed item last (a month here is 30 days). */
export const periodsText = (s, n) => (s.unit === 'week' ? tn(n, '{n} week', '{n} weeks') : tn(n, '{n} month', '{n} months'));
/** "500 🍌 per 30 days", or just the price for an item that isn't timed. */
export const priceText = s => (s.days ? t('{price} per {days} days', { price: bananas(s.price), days: s.days }) : bananas(s.price));

/** The palette a name or a Discord role can take (the bot's ShopColours), by name, as the site shows it. */
export const COLOURS = [['rosa', t('Rosa')], ['gold', t('Gold')], ['mint', t('Mint')], ['sky', t('Sky')], ['lilac', t('Lilac')], ['sand', t('Sand')]];
export const colourName = key => COLOURS.find(c => c[0] === key)?.[1] ?? key;

/** "1,234 🍌": the currency's unit follows every amount, as ★ follows stars (DESIGN.md §6). */
export const bananas = n => `${fmt.num(n)} 🍌`;
/** "+20 🍌" / "−20 🍌", for ledger lines. */
export const signedBananas = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${bananas(Math.abs(n))}`;

/** economy.json (tools/lib/economy.mjs), or null while the bot hasn't started Bananas. */
export const economy = async () => ((await meta()).files?.['economy.json'] ? load('economy.json') : null);

// ---- The session ----------------------------------------------------------------------------------------------------

/** Sign-in only works on the build's own address (core/you.js). */
export const signInHere = () => Boolean(CONFIG.signIn && (!CONFIG.home || location.origin === new URL(CONFIG.home).origin));

/** The signed-in player, { id, token, exp }, while the 30-day session lasts; null otherwise. */
export function session() {
  return myId() ? prefs.get('osuSession', null) : null;
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
  'Shield needs on or off.', 'Pick one of the six maps.', 'You already tried that one.', 'Buy 1 to 52 periods at once.',
  'You’ve played today’s map. A new one comes at midnight, Lisbon time.',
];
void SERVER_TEXT;

/**
 * The bot's refusal reasons (PT-CTB-Discord-Bot Services/EconomyService.cs, bananas-contract.md §6), written in
 * English with the bot's own wording; each {name} is a part that changes. reasonText() matches a reason against them
 * and gives it in the visitor's language. One the site doesn't know shows as the bot wrote it.
 */
const REASONS = /* i18n */ [
  'Bananas aren’t launched yet.', 'Only listed PT players have a wallet.', 'This wallet is frozen.',
  'The goal is fc, pass or snipe.', 'A bounty can demand HD, HR, DT/NC or FL, or a combination of them.',
  'A bounty runs {days} days.', 'The stake is {n} or more.', 'Posting needs {gate} 🍌 earned; you have {earned}.',
  'Not enough bananas: {stake} stake + {fee} fee = {total}, and you have {balance}.',
  'You’ve posted your bounty for {month}. Next month!', 'You have {n} bounties open already.',
  'Funding starts at {n} 🍌.', 'Not enough bananas: you have {balance}.', 'Bounty #{id} isn’t open.',
  'You can only tip listed PT players.', '{name} hasn’t signed in on the site yet, so they have no wallet to tip.',
  'Tips start at {n} 🍌.', 'You can send {n} 🍌 a day in tips; {left} left today.',
  '{name} can take {n} 🍌 a week in tips; {left} left this week.', 'You can tip {name} {n} 🍌 a month; {left} left this month.',
  'There’s no such item in the shop.', '{item} needs {gate} earned; you have {earned}.',
  '{month}’s wildcard has been taken. Try again next month.', 'Not enough bananas: {item} costs {price}, and you have {balance}.',
  'Name the title (40 characters at most).', 'already yours', 'You have no play on that map that the bot knows of.',
  'Pick a colour: {colours}.', 'Name the map by its beatmap id.',
];
const straight = s => s.replace(/[’‘]/g, '\'');
const REASON_PATTERNS = REASONS.map(template => {
  const names = [];
  const source = straight(template).replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_, name) => { names.push(name); return '(.+?)'; });
  return { template, names, re: new RegExp(`^${source}$`, 'i') };
});

/** A refusal reason from the bot, in the visitor's language when it's one the site knows. */
export function reasonText(reason) {
  if (!reason) return '';
  const text = straight(reason.trim());
  for (const { template, names, re } of REASON_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const vars = Object.fromEntries(names.map((name, i) => [name, m[i + 1]]));
    if (vars.item) vars.item = shopItem(vars.item)?.name ?? vars.item;
    return t(template, vars);
  }
  return reason;
}

/** What the site said went wrong, in the visitor's language where it's one of ours. */
const problem = (status, body) => (status === 401 ? t('Your sign-in has run out. Sign in with osu! again.')
  : status === 503 ? t('Bananas aren’t set up on this copy of the site.')
    : status === 429 ? t('You have several requests waiting for the bot already. It takes them every 15 minutes; try again after.')
      : body?.error ? t(body.error) : t('That didn’t go through. Try again in a moment.'));

/**
 * Queues a request for the bot: { ok, message }. A success is a toast (the form closes); a failure's message is for the
 * form to show in its own line, next to what the player was doing.
 */
export async function sendRequest(type, payload) {
  const res = await api('/api/wallet/request', { method: 'POST', body: { type, payload } });
  track('use', 'bananas', type);
  if (res.ok) {
    toast(t('Sent to the bot. It answers within 15 minutes; your wallet shows the result.'));
    window.dispatchEvent(new CustomEvent('ptctb:requests'));
    return { ok: true, message: '' };
  }
  return { ok: false, message: problem(res.status, res.body) };
}

/** The signed-in player's requests (newest first), or null when they can't be read. */
export async function myRequests() {
  const res = await api('/api/wallet/requests');
  return res.ok ? res.body.requests : null;
}

/** What a request takes from the wallet if the bot accepts it. */
export function requestCost(r) {
  const p = r.payload ?? {};
  switch (r.type) {
    case 'bounty.create': return (p.stake ?? 0) + fee(p.stake ?? 0);
    case 'bounty.fund': case 'tip': return p.amount ?? 0;
    case 'shop.buy': return (shopItem(p.item)?.price ?? 0) * (p.periods ?? 1);
    default: return 0;
  }
}
/** The bananas the player's requests still waiting for the bot would take: the wallet to plan with is the rest. */
export const pendingSpend = requests => (requests ?? []).filter(r => r.status === 'pending').reduce((n, r) => n + requestCost(r), 0);

/**
 * The wallet as a line: "Your wallet: 679 🍌", plus "(150 🍌 waiting for the bot)" when requests are pending, so what
 * you can still spend is what's left.
 */
export const walletLine = (w, pending) => (pending
  ? th('Your wallet: {amount}, {pending} of it waiting for the bot', { amount: html`<b>${bananas(w.b)}</b>`, pending: bananas(pending) })
  : th('Your wallet: {amount}', { amount: html`<b>${bananas(w.b)}</b>` }));

// ---- Pieces the pages share -----------------------------------------------------------------------------------------

/** "Sign in with osu!" where it works here; a sentence saying where it does otherwise. */
export const signInButton = (label = t('Sign in with osu!')) => (signInHere()
  ? html`<button class="btn btn-small" type="button" data-signin>${label}</button>`
  : html`<span class="faint small">${t('Signing in works on ptcatch.com.')}</span>`);

const MOD_TEXT = mods => (mods ? ` +${mods}` : '');
const GOAL_TEXT = { fc: t('Full combo'), pass: t('First pass'), snipe: t('Snipe') };
const mapRef = (id, maps) => html`<a href="/map/${id}">${maps?.[id] ? mapLabel(id, maps[id]) : t('map {id}', { id })}</a>`;

/** What a shop request asked for: the colour's name, the map, or the title. */
function shopChoice(p, maps) {
  if (p.item === 'colour' || p.item === 'role') return colourName(p.arg);
  if (typeof p.arg === 'number') return mapRef(p.arg, maps);
  return p.arg ?? '';
}

/** One line saying what a request asks for: "Post a bounty: FC on <map>, stake 500 🍌", "Buy Name colour (Mint) for 1,000 🍌". */
export function requestText(r, index, maps) {
  const p = r.payload;
  switch (r.type) {
    case 'bounty.create': return th('Post a bounty: {goal}{mods} on {map}, stake {stake}', {
      goal: GOAL_TEXT[p.goal], mods: MOD_TEXT(p.mods), map: mapRef(p.map, maps), stake: bananas(p.stake),
    });
    case 'bounty.fund': return t('Fund bounty #{id} with {amount}', { id: p.bountyId, amount: bananas(p.amount) });
    case 'tip': return th('Tip {who} {amount}', { who: html`<a href="/player/${p.to}">${index?.get(p.to)?.name ?? `#${p.to}`}</a>`, amount: bananas(p.amount) });
    case 'shop.buy': {
      const choice = shopChoice(p, maps);
      const s = shopItem(p.item);
      const item = s?.days ? `${s.name}, ${periodsText(s, p.periods ?? 1)}` : s?.name ?? p.item;
      const price = bananas(requestCost(r));
      return choice ? th('Buy {item} ({choice}) for {price}', { item, choice, price }) : t('Buy {item} for {price}', { item, price });
    }
    case 'shield': return p.on ? t('Turn the snipe shield on') : t('Turn the snipe shield off');
    default: return r.type;
  }
}

const STATUS = {
  pending: () => html`<span class="req-status">${t('waiting for the bot')}</span>`,
  accepted: () => html`<span class="req-status req-ok">✓ ${t('done')}</span>`,
  rejected: reason => html`<span class="req-status req-no">✕ ${reason ? t('refused: {reason}', { reason: reasonText(reason) }) : t('refused')}</span>`,
};

/** The player's requests as a list with what the bot said; nothing when there are none. `maps` names bounty maps. */
export function requestList(requests, index, { limit = 5, maps } = {}) {
  if (!requests?.length) return '';
  return html`<ul class="req-list">${requests.slice(0, limit).map(r => html`<li>
    <span>${requestText(r, index, maps)}</span> ${STATUS[r.status]?.(r.reason) ?? ''}
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

/** A wallet's latest lines (players/{id}.json `ledger`: [t, amount, kind, pouch, note]), newest first. */
export const ledgerList = rows => (rows?.length ? html`<ul class="ledger">${rows.map(([at, amount, kind, pouch, note]) => html`<li>
  <span>${kindLabel(kind)}${pouch ? html` <span class="faint">· ${t('in the pouch')}</span>` : ''}${note ? html` <span class="faint">· ${note}</span>` : ''}</span>
  <b class="${amount < 0 ? 'ledger-out' : ''}">${amount ? signedBananas(amount) : '—'}</b>
  <span class="faint" title="${fmt.dateTime(at)}">${fmt.ago(at)}</span>
</li>`)}</ul>` : '');

/** Esc closes an open form and puts focus back on what opened it (DESIGN.md §9 Menus): one handler per form. */
export function closeOnEscape(box, close) {
  box.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });
}
