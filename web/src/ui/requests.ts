// A player's requests to the bot (economy/api.js), as assets/js/core/bananas.js shows them: what each asks for, what it
// would take from the wallet, and what the bot said, in the visitor's language where it's a reason the site knows. The
// shop, a profile and the bounties list them; client/bananas.ts sends them and fetches the list.

import { html, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { bananas, fee } from './bananas.ts';
import { mapLabel, type MapMeta } from './maps.ts';
import { shopItems, colourName, periodsText } from './shop.ts';

/** A request as /api/wallet/requests lists them (newest first). */
export interface WalletRequest {
  type: string;
  status: string;
  /** When it was sent, ISO 8601. */
  t: string;
  reason?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

/** Names a tip's player by osu! id. */
export interface PlayerNames {
  get(id: number): { name: string } | undefined;
}

/** The shop's prices by item: they don't depend on the language, so English names do. */
const PRICES = new Map(shopItems({ t: (text: string) => text } as Ctx).map(s => [s.item, s.price]));

/** What a request takes from the wallet if the bot accepts it. */
export function requestCost(r: WalletRequest): number {
  const p = r.payload ?? {};
  switch (r.type) {
    case 'bounty.create': return (p.stake ?? 0) + fee(p.stake ?? 0);
    case 'bounty.fund': case 'tip': return p.amount ?? 0;
    case 'shop.buy': return (PRICES.get(p.item) ?? 0) * (p.periods ?? 1);
    default: return 0;
  }
}

/** The bananas the player's requests still waiting for the bot would take: the wallet to plan with is the rest. */
export const pendingSpend = (requests: readonly WalletRequest[] | null | undefined): number =>
  (requests ?? []).filter(r => r.status === 'pending').reduce((n, r) => n + requestCost(r), 0);

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
const straight = (s: string) => s.replace(/[’‘]/g, '\'');
const REASON_PATTERNS = REASONS.map(template => {
  const names: string[] = [];
  const source = straight(template).replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_, name: string) => { names.push(name); return '(.+?)'; });
  return { template, names, re: new RegExp(`^${source}$`, 'i') };
});

/** A refusal reason from the bot, in the visitor's language when it's one the site knows. */
export function reasonText(ctx: Ctx, reason: string | null | undefined): string {
  if (!reason) return '';
  const text = straight(reason.trim());
  for (const { template, names, re } of REASON_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const vars: Record<string, string> = Object.fromEntries(names.map((name, i) => [name, m[i + 1]]));
    if (vars.item) vars.item = shopItems(ctx).find(s => s.item === vars.item)?.name ?? vars.item;
    return ctx.t(template, vars);
  }
  return reason;
}

const modText = (mods: string | undefined) => (mods ? ` +${mods}` : '');
const goalText = ({ t }: Ctx): Record<string, string> => ({ fc: t('Full combo'), pass: t('First pass'), snipe: t('Snipe') });
const mapRef = (ctx: Ctx, id: number, maps: Record<string, MapMeta> | undefined) =>
  html`<a href="/map/${id}">${maps?.[id] ? mapLabel(ctx, id, maps[id]) : ctx.t('map {id}', { id })}</a>`;

/** What a shop request asked for: the colour's name, the map, or the title. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shopChoice(ctx: Ctx, p: any, maps: Record<string, MapMeta> | undefined): Value {
  if (p.item === 'colour' || p.item === 'role') return colourName(ctx, p.arg);
  if (typeof p.arg === 'number') return mapRef(ctx, p.arg, maps);
  return p.arg ?? '';
}

/** One line saying what a request asks for: "Post a bounty: FC on <map>, stake 500 🍌", "Buy Name colour (Mint) for 1,000 🍌". */
export function requestText(ctx: Ctx, r: WalletRequest, index: PlayerNames | null | undefined, maps?: Record<string, MapMeta>): Value {
  const { t, th } = ctx;
  const p = r.payload;
  switch (r.type) {
    case 'bounty.create': return th('Post a bounty: {goal}{mods} on {map}, stake {stake}', {
      goal: goalText(ctx)[p.goal], mods: modText(p.mods), map: mapRef(ctx, p.map, maps), stake: bananas(ctx, p.stake),
    });
    case 'bounty.fund': return t('Fund bounty #{id} with {amount}', { id: p.bountyId, amount: bananas(ctx, p.amount) });
    case 'tip': return th('Tip {who} {amount}', { who: html`<a href="/player/${p.to}">${index?.get(p.to)?.name ?? `#${p.to}`}</a>`, amount: bananas(ctx, p.amount) });
    case 'shop.buy': {
      const choice = shopChoice(ctx, p, maps);
      const s = shopItems(ctx).find(item => item.item === p.item);
      const item = s?.days ? `${s.name}, ${periodsText(ctx, s, p.periods ?? 1)}` : s?.name ?? p.item;
      const price = bananas(ctx, requestCost(r));
      return choice ? th('Buy {item} ({choice}) for {price}', { item, choice, price }) : t('Buy {item} for {price}', { item, price });
    }
    case 'shield': return p.on ? t('Turn the snipe shield on') : t('Turn the snipe shield off');
    default: return r.type;
  }
}

function status(ctx: Ctx, r: WalletRequest): Safe | '' {
  const { t } = ctx;
  if (r.status === 'pending') return html`<span class="req-status">${t('waiting for the bot')}</span>`;
  if (r.status === 'accepted') return html`<span class="req-status req-ok">✓ ${t('done')}</span>`;
  if (r.status === 'rejected') return html`<span class="req-status req-no">✕ ${r.reason ? t('refused: {reason}', { reason: reasonText(ctx, r.reason) }) : t('refused')}</span>`;
  return '';
}

/** The player's requests as a list with what the bot said; nothing when there are none. `maps` names bounty maps. */
export function requestList(ctx: Ctx, requests: readonly WalletRequest[] | null | undefined, index: PlayerNames | null | undefined,
  { limit = 5, maps }: { limit?: number; maps?: Record<string, MapMeta> } = {}): Safe | '' {
  if (!requests?.length) return '';
  const { fmt } = ctx;
  return html`<ul class="req-list">${requests.slice(0, limit).map(r => html`<li>
    <span>${requestText(ctx, r, index, maps)}</span> ${status(ctx, r)}
    <span class="faint" title="${fmt.dateTime(Date.parse(r.t) / 1000)}">${fmt.ago(Date.parse(r.t) / 1000)}</span>
  </li>`)}</ul>`;
}
