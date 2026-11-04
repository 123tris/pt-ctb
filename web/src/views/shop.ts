// The Shop (/shop), as assets/js/pages/shop.js draws it: what bananas buy (CURRENCY-DESIGN.md §5). Every purchase is a
// request the bot judges, like a bounty, and it can take up to 15 minutes.
//
// Each item is one disclosure: its whole header is a single button (aria-expanded) that opens or folds its panel, and
// only one is open at a time, so there's one primary action on screen. Items go cheapest first in each group. The
// header says at a glance what matters for you: the price (dim when you can't afford it, with how much you're short),
// and whether it's already yours, active, waiting for the bot or behind the 1,000-earned gate. The panel says why you
// can't buy it when you can't. Buying takes two steps (shop.mount.ts): pick what you want, then a confirmation with the
// price and your wallet after. What's already waiting for the bot comes off the wallet you plan with.
//
// From economy.json (the wallet), the visitor's head file (their badges, for a title, and best plays, for the
// signature) and the core pack (their name, for the colour preview). Their requests to the bot are the browser's to
// fetch: render() takes them, and the item that's open, as its state.

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { S, CATS } from '../kernel/model.ts';
import { pageHead, empty } from '../ui/page.ts';
import { rowOf } from '../ui/players.ts';
import { mapLabel, type MapMeta } from '../ui/maps.ts';
import { localBadge, type Badge } from '../ui/badges.ts';
import { bananas, signInButton, walletLine, type Wallet } from '../ui/bananas.ts';
import type { Cat, Play } from '../ui/scores.ts';

/** A wallet in economy.json, with what the shop sells on it. */
export interface ShopWallet extends Wallet {
  /** The pinned signature play's map, or null */
  sg: number | null;
  /** Name colour (a colours() key), and when it ends, unix seconds */
  c: string | null;
  cu: number | null;
  /** Discord colour role, and when it ends (null while the bot doesn't write it) */
  ro: string | null;
  ru: number | null;
}

export interface Economy {
  players?: Record<string, ShopWallet>;
}

/** The visitor's head file (players/{id}-head.json): the parts the shop reads. */
export interface HeadFile {
  scores?: Partial<Record<Cat, Play[]>>;
  maps: Record<string, MapMeta>;
  extras?: { badges?: Badge[] };
}

export interface Data {
  core: CorePack;
  /** null while the bot hasn't started Bananas. */
  economy: Economy | null;
  /** The signed-in visitor's head file, or null (signed out, or data without head files). */
  head: HeadFile | null;
  /** Whether sign-in works on this address (bananas.js signInHere()). */
  signInHere: boolean;
}

/** A request to the bot (economy/api.js), as myRequests() lists them, newest first. */
export interface ShopRequest {
  type: string;
  status: string;
  /** When it was sent, and when the bot answered (ISO). */
  t: string;
  decided?: string;
  reason?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

/** What the browser adds (shop.mount.ts): the open item and the visitor's requests to the bot. */
export interface State {
  open: string | null;
  requests: readonly ShopRequest[];
  /** What the requests waiting for the bot would take (bananas.js pendingSpend()). */
  pending: number;
  /** The visitor's purchases as bananas.js requestList() draws them: the old html tag's markup, so a string. */
  purchases: string;
}

/** The page as it first draws: nothing open, no requests known yet. */
export const START: State = { open: null, requests: [], pending: 0, purchases: '' };

export interface ShopItem {
  item: string;
  group: 'look' | 'community';
  /** A timed item's price is per period of `days`. */
  price: number;
  name: string;
  about: string;
  /** How long a timed item lasts, and how many periods can be bought at once (stacked, up to a year), named by `unit`. */
  days?: number;
  periods?: readonly number[];
  unit?: 'month' | 'week';
  /** The earned bananas it needs, as posting a bounty does. */
  gate?: number;
  /** Only one player in PT gets it per Lisbon month: the first the bot accepts. */
  monthly?: boolean;
  /** A moderator approves it first; refunded if refused. */
  approval?: boolean;
}

/**
 * The shop, as bananas.js SHOP has it (CURRENCY-DESIGN.md §5; prices and gates as bananas-contract.md §6 lists them,
 * which the bot's Bananas options must match: the bot doesn't export them). The same items and numbers: change both
 * together. `look` is cosmetics, `community` picks a moderator approves first.
 */
export function shopItems({ t }: Ctx): ShopItem[] {
  return [
    { item: 'title', group: 'look', price: 500, name: t('Profile title'),
      about: t('Show one of your titles or badges next to your name.') },
    { item: 'signature', group: 'look', price: 350, name: t('Signature play'),
      about: t('Pin one of your plays to the top of your profile.') },
    { item: 'colour', group: 'look', price: 500, days: 30, periods: [1, 2, 3, 6, 12], unit: 'month', gate: 1000, name: t('Name colour'),
      about: t('Your name in a colour you pick on the site’s leaderboards, 30 days at a time, up to a year.') },
    { item: 'role', group: 'look', price: 150, days: 7, periods: [1, 2, 4, 8, 13, 26, 52], unit: 'week', gate: 1000, name: t('Discord colour role'),
      about: t('A colour role on the Discord, a week at a time, up to a year.') },
    { item: 'motw', group: 'community', price: 400, approval: true, name: t('Map of the week nomination'),
      about: t('Put a map forward for the map of the week.') },
    { item: 'wildcard', group: 'community', price: 1500, gate: 1000, monthly: true, approval: true, name: t('King of the hill wildcard'),
      about: t('Pick the convert map (4.5–6.5★) for next month’s Challenger tier.') },
  ];
}

/** The palette a name or a Discord role can take (the bot's ShopColours), by name, as the site shows it. */
export const colours = ({ t }: Ctx): [string, string][] =>
  [['rosa', t('Rosa')], ['gold', t('Gold')], ['mint', t('Mint')], ['sky', t('Sky')], ['lilac', t('Lilac')], ['sand', t('Sand')]];
export const colourName = (ctx: Ctx, key: string): string => colours(ctx).find(c => c[0] === key)?.[1] ?? key;

/** "3 months" / "26 weeks": how long `n` periods of a timed item last (a month here is 30 days). */
export const periodsText = (ctx: Ctx, s: ShopItem, n: number): string =>
  (s.unit === 'week' ? ctx.tn(n, '{n} week', '{n} weeks') : ctx.tn(n, '{n} month', '{n} months'));
/** "500 🍌 per 30 days", or just the price for an item that isn't timed. */
export const priceText = (ctx: Ctx, s: ShopItem): string =>
  (s.days ? ctx.t('{price} per {days} days', { price: bananas(ctx, s.price), days: s.days }) : bananas(ctx, s.price));

const DAY = 86400;
const SIGNATURE_CHOICES = 30; // the player's best plays offered for the signature
const CHEVRON = raw('<svg class="shop-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>');

/** The visitor as the shop sees them: their wallet, what it has free, and what they could pick. */
export interface You {
  me: number | null;
  w: ShopWallet | null;
  /** The wallet less what's waiting for the bot. */
  free: number;
  /** Titles they can show: their badges, [sent in English for the bot, shown in their language]. */
  titles: [string, string][];
  /** Plays they can pin: their best by pp, one per map, [map, "map [diff] · 312 pp"]. */
  plays: [number, string][];
  /** Their name, for the colour preview. */
  name: string;
  requests: readonly ShopRequest[];
}

export function you(ctx: Ctx, { core, economy, head }: Data, state: State): You {
  const { fmt } = ctx;
  const me = ctx.me;
  const w = me !== null ? economy?.players?.[me] ?? null : null;
  const row = me === null ? -1 : rowOf(core.players, me);
  const titles = (head?.extras?.badges ?? []).map(b => [b.name, localBadge(ctx, b).name] as [string, string]);
  // One per map, through a Map by map id, as the old page picks them.
  const best = CATS.flatMap(cat => head?.scores?.[cat as Cat] ?? []).sort((a, b) => b[S.PP] - a[S.PP]);
  const plays = [...new Map(best.map(s => [s[S.MAP], s])).values()].slice(0, SIGNATURE_CHOICES)
    .map(s => [s[S.MAP], `${mapLabel(ctx, s[S.MAP], head!.maps[s[S.MAP]])} · ${fmt.pp(s[S.PP])} pp`] as [number, string]);
  return {
    me, w, free: w ? w.b - state.pending : 0, titles, plays, name: row < 0 ? '' : core.players.name.at(row), requests: state.requests,
  };
}

/** A timed item's current [palette name, end] (unix seconds). */
export type Timed = [string, number | null];

/**
 * A timed item's current [palette name, end], or null. The wallet says it (colour and colourUntil, role and
 * roleUntil); for a role, while the bot doesn't write roleUntil yet, the end is worked out from when it accepted the
 * purchase.
 */
export function currentTimed(s: ShopItem, w: ShopWallet | null, requests: readonly ShopRequest[], now: number): Timed | null {
  if (!w || !s.days) return null;
  if (s.item === 'colour') return w.c ? [w.c, w.cu] : null;
  if (w.ro && w.ru) return w.ru > now ? [w.ro, w.ru] : null;
  const accepted = requests.find(r => r.payload?.item === s.item && r.status === 'accepted');
  const until = accepted ? Date.parse(accepted.decided ?? accepted.t) / 1000 + s.days * DAY : 0;
  return until > now ? [w.ro ?? accepted!.payload.arg, until] : null;
}

/**
 * What buying `value` would do, by the bot's repeat-buy rule (bananas-contract.md §6): a colour or role's new end is the
 * later of now and the current end, plus its days, whether it's the same one or another; a new title or signature play
 * replaces the old one; the one you already have can't be bought. { text, blocked }.
 */
export function effectOf(ctx: Ctx, s: ShopItem, value: unknown, w: ShopWallet | null, cur: Timed | null, now: number, periods = 1):
  { text: string; blocked?: boolean } {
  const { t, fmt } = ctx;
  if (s.days) {
    const days = s.days * periods;
    const until = Math.max(now, cur?.[1] ?? 0) + days * DAY;
    if (cur && cur[0] === value) return { text: t('Adds {n} days: in use until {date}.', { n: days, date: fmt.date(until) }) };
    if (cur) {
      return { text: t('Switches from {current} to {colour}, keeping the time left and adding {n} days: in use until {date}.', {
        current: colourName(ctx, cur[0]), colour: colourName(ctx, String(value)), n: days, date: fmt.date(until),
      }) };
    }
    return { text: t('In use until {date}.', { date: fmt.date(until) }) };
  }
  if (s.item === 'title' && w?.t) {
    return String(value).toLowerCase() === w.t.toLowerCase() ? { text: t('Already yours.'), blocked: true } : { text: t('Replaces {current}.', { current: w.t }) };
  }
  if (s.item === 'signature' && w?.sg) {
    return value === w.sg ? { text: t('That play is already pinned.'), blocked: true } : { text: t('Replaces the play you have pinned now.') };
  }
  return { text: '' };
}

/**
 * Where an item stands for this visitor: { tag (a few words for the header), why (the reason it can't be bought, or
 * null), owned (a line for the panel), cur }.
 */
export interface Standing {
  tag: string;
  why: string | null;
  owned: string | null;
  cur?: Timed | null;
}

export function standing(ctx: Ctx, s: ShopItem, { me, w, free, titles, plays, requests }: You): Standing {
  const { t, tn, fmt } = ctx;
  const pending = requests.find(r => r.payload?.item === s.item && r.status === 'pending');
  const now = ctx.now();
  const cur = currentTimed(s, w, requests, now);
  let owned: string | null = null;
  if (w && s.item === 'title' && w.t) owned = t('Yours now: {title}.', { title: w.t });
  if (w && s.item === 'signature' && w.sg) owned = t('You have a play pinned. A new one replaces it.');
  if (cur) {
    const left = Math.max(1, Math.ceil(((cur[1] as number) - now) / DAY));
    owned = cur[0] ? tn(left, 'In use: {colour}, {n} day left.', 'In use: {colour}, {n} days left.', { colour: colourName(ctx, cur[0]) })
      : tn(left, 'In use: {n} day left.', 'In use: {n} days left.');
  }
  const gateTag = s.gate ? t('Needs {gate} earned', { gate: fmt.num(s.gate) }) : '';

  // Signed out, the page says it once at the top; each panel says it again with the button. The gate shows anyway.
  if (me === null) return { tag: gateTag, why: t('Sign in with osu! to buy. You can look around first.'), owned };
  if (!w) return { tag: '', why: t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.'), owned };
  if (pending) {
    const ago = fmt.ago(Date.parse(pending.t) / 1000);
    return { tag: t('Waiting for the bot'), why: t('You asked for this {ago}. The bot answers within 15 minutes; it shows under “Your purchases”.', { ago }), owned };
  }
  if (s.item === 'title' && !titles.length) {
    return { tag: '', why: t('You have no titles or badges to show yet. Badges come from your plays; titles from King of the hill.'), owned };
  }
  if (s.item === 'signature' && !plays.length) return { tag: '', why: t('The site has no plays of yours to pin yet.'), owned };
  if (s.gate && w.e < s.gate) {
    const vars = { gate: fmt.num(s.gate), earned: fmt.num(w.e) };
    return { tag: gateTag, why: t('This needs {gate} bananas earned, as posting a bounty does; you have {earned}. Tips, refunds and the launch grant don’t count.', vars), owned };
  }
  if (free < s.price) {
    const n = bananas(ctx, s.price - free), balance = bananas(ctx, w.b);
    return { tag: t('{n} short', { n }), why: free < w.b
      ? t('You need {n} more: your wallet has {balance}, and {pending} of it is waiting for the bot.', { n, balance, pending: bananas(ctx, w.b - free) })
      : t('You need {n} more: your wallet has {balance}.', { n, balance }), owned };
  }
  const tag = cur ? t('In use') : (s.item === 'title' && w.t) || (s.item === 'signature' && w.sg) ? t('Yours') : '';
  return { tag, why: null, owned, cur };
}

/** How an item's choice is read off its field (shop.mount.ts): as it is, as a play's map id, or as a map id or link. */
export type ArgKind = 'text' | 'play' | 'map';

export const argKind = (item: string): ArgKind => (item === 'signature' ? 'play' : item === 'motw' || item === 'wildcard' ? 'map' : 'text');

/** The extra thing an item needs: its label, its field, and what to say when it's left empty. */
export interface ArgField {
  label: string;
  field: Safe;
  missing?: string;
}

/** The item's field. A colour or role starts on the one you have, so buying it again (adding days) is the obvious pick. */
export function argField(ctx: Ctx, item: string, { titles, plays, w }: You, cur: Timed | null): ArgField {
  const { t } = ctx;
  const id = `arg-${item}`;
  const select = (options: readonly (readonly [string | number, string])[], selected: unknown) => html`<select class="select" id="${id}" aria-describedby="effect-${item}">${options
    .map(([v, label]) => html`<option value="${v}" ${String(v) === String(selected) ? raw('selected') : ''}>${label}</option>`)}</select>`;
  const map = (label: string): ArgField => ({
    label, missing: t('Add the map first: its id or its osu! link.'),
    field: html`<input class="input" id="${id}" placeholder="${t('Map id or osu! link')}" autocomplete="off" aria-describedby="effect-${item} why-${item}">`,
  });
  switch (item) {
    // Starts on a title that isn't already yours.
    case 'title': return { label: t('Which title'), field: select(titles, titles.find(([v]) => v.toLowerCase() !== w?.t?.toLowerCase())?.[0]) };
    case 'signature': return { label: t('Which play'), field: select(plays, plays.find(([v]) => v !== w?.sg)?.[0]) };
    case 'motw': return map(t('The map to nominate'));
    case 'wildcard': return map(t('The convert map for next month'));
    default: {
      const palette = colours(ctx);
      return { label: t('Colour'), field: select(palette, cur?.[0] ?? palette[0][0]) };
    }
  }
}

/** Step one: what the item does, what it needs, and why not when it can't be bought. */
function panel(ctx: Ctx, data: Data, s: ShopItem, st: Standing, me: You): Safe {
  const { t, th } = ctx;
  const arg = argField(ctx, s.item, me, currentTimed(s, me.w, me.requests, ctx.now()));
  return html`
      ${st.owned ? html`<p class="shop-owned">${st.owned}</p>` : ''}
      ${s.approval ? html`<p class="small muted">${t('A moderator checks it fits first. If they say no, the bananas come back.')}</p>` : ''}
      ${s.monthly ? html`<p class="small muted">${t('One a month for all of PT: the first one the bot accepts takes it. If it’s gone, the bot says so and nothing is charged.')}</p>` : ''}
      ${st.why ? html`<p class="small muted" id="why-${s.item}">${st.why}</p>${me.me === null ? html`<div class="btn-row">${signInButton(ctx, data.signInHere)}</div>` : ''}`
        : html`<div class="shop-step" data-step="pick">
          <div class="field"><label for="arg-${s.item}">${arg.label}</label>${arg.field}</div>
          ${s.periods ? html`<div class="field"><label for="periods-${s.item}">${t('How long')}</label><select class="select" id="periods-${s.item}">${s.periods
            .map(n => html`<option value="${n}">${periodsText(ctx, s, n)} · ${bananas(ctx, s.price * n)}</option>`)}</select></div>` : ''}
          <button class="btn btn-small" type="button" data-review>${t('Buy…')}</button>
          ${s.item === 'colour' ? html`<p class="small shop-preview">${th('Your name will look like this: {name}', { name: html`<b class="name-colour" id="colour-preview">${me.name}</b>` })}</p>` : ''}
          <p class="small shop-effect" id="effect-${s.item}" aria-live="polite"></p>
          <p class="small muted shop-why" id="why-${s.item}" aria-live="polite">${t('Your wallet: {balance}, then {after}.', { balance: bananas(ctx, me.free), after: bananas(ctx, me.free - s.price) })}</p>
        </div>`}`;
}

/** Step two: the confirmation, with the price, the choice and the wallet after; Cancel goes back. */
export function confirmStep(ctx: Ctx, s: ShopItem, choice: string, effect: string, total: number, periods: number, free: number): Safe {
  const { t, th } = ctx;
  return html`<div class="shop-step shop-confirm" data-step="confirm">
    <p>${th('Buy {item} ({choice}) for {price}?', { item: html`<b>${s.days ? `${s.name}, ${periodsText(ctx, s, periods)}` : s.name}</b>`, choice, price: html`<b>${bananas(ctx, total)}</b>` })}</p>
    ${effect ? html`<p class="small shop-effect">${effect}</p>` : ''}
    <p class="small muted">${t('Your wallet goes from {balance} to {after}. Bananas spent in the shop are burned: they don’t come back.', { balance: bananas(ctx, free), after: bananas(ctx, free - total) })}${s.approval ? ` ${t('Unless a moderator says no: then they do.')}` : ''}</p>
    <div class="btn-row">
      <button class="btn btn-small btn-primary" type="button" data-confirm>${t('Confirm purchase')}</button>
      <button class="btn btn-small" type="button" data-cancel>${t('Cancel')}</button>
    </div>
    <p class="small shop-error" aria-live="polite"></p>
  </div>`;
}

/** One item: its header button, and its panel when it's the open one. */
function itemBox(ctx: Ctx, data: Data, s: ShopItem, me: You, open: string | null): Safe {
  const { t } = ctx;
  const st = standing(ctx, s, me);
  const short = me.w && me.free < s.price;
  return html`<div class="shop-item" data-item="${s.item}">
      <button class="shop-head" type="button" id="head-${s.item}" aria-expanded="${open === s.item ? 'true' : 'false'}" aria-controls="panel-${s.item}">
        <span class="shop-name">${s.name}${s.approval ? html` <span class="shop-mark">${t('needs a moderator’s OK')}</span>` : ''}</span>
        <span class="shop-about">${s.about}</span>
        <span class="shop-side"><span class="shop-price ${short ? 'shop-short' : ''}">${priceText(ctx, s)}</span>${st.tag ? html`<span class="shop-tag">${st.tag}</span>` : ''}</span>
        ${CHEVRON}
      </button>
      <div class="shop-panel" id="panel-${s.item}" role="region" aria-labelledby="head-${s.item}" ${open === s.item ? '' : raw('hidden')}>${open === s.item ? panel(ctx, data, s, st, me) : ''}</div>
    </div>`;
}

export function render(ctx: Ctx, data: Data, state: State = START): Safe {
  const { t } = ctx;
  const me = you(ctx, data, state);
  const { w } = me;
  const items = shopItems(ctx);
  const groups: [ShopItem['group'], string][] = [['look', t('Your look')], ['community', t('Community picks')]];
  return html`
      ${pageHead({ title: t('Shop'), intro: t('Spend bananas on your look or on community picks. What you spend here is burned: bananas are never bought, sold or turned into supporter.') })}
      ${!data.economy ? empty(t('Bananas haven’t started yet. The shop opens with them.')) : html`
        <section class="shop-wallet">
          ${me.me === null ? html`<p class="muted">${t('Sign in with osu! to buy. You can look around first.')}</p><div class="btn-row">${signInButton(ctx, data.signInHere)}</div>`
            : w ? html`<p>${walletLine(ctx, w, state.pending)} <a class="small" href="/player/${me.me}">${t('See your wallet')}</a></p>
              ${!w.s && w.p ? html`<p class="small muted">${t('Plus {n} in your pouch: the bot moves it into your wallet at its next update, within 15 minutes.', { n: bananas(ctx, w.p) })}</p>` : ''}`
              : html`<p class="muted">${t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.')}</p>`}
          ${state.requests.some(r => r.type === 'shop.buy') ? html`<h2 class="small-h">${t('Your purchases')}</h2>${raw(state.purchases)}` : ''}
        </section>
        ${groups.map(([group, title]) => html`<section class="section">
          <h2>${title}</h2>
          <div class="rows shop-items">${items.filter(s => s.group === group).sort((a, b) => a.price - b.price).map(s => itemBox(ctx, data, s, me, state.open))}</div>
        </section>`)}`}
    `;
}
