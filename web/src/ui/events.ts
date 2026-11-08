// How activity events read, as assets/js/core/events.js has it (the home page and the activity page share this). An
// event is activity.json's record: { t time, k kind, u player, ... }; players come from the core pack.

import { html, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { DAN_STAGES, MOD, S, THRONE_PLAYER } from '../kernel/model.ts';
import { mapLabel, type MapMeta } from './maps.ts';
import { catChip, catLabel, modsBadges, type Cat, type Play } from './scores.ts';
import { nameClass, playerName, ppText, rowOf, type Players } from './players.ts';
import { monthLabel, slotName, tierName } from './hill.ts';
import { bananas } from './bananas.ts';
import { deltaText } from './duels.ts';
import { pick, quips } from './lore.ts';

/** "Zeroth Dan", "7th Dan", "Aleph". */
export const danName = (ctx: Ctx, i: number): string =>
  (i === 0 ? ctx.t('Zeroth Dan') : i <= 10 ? ctx.t('{nth} Dan', { nth: ctx.fmt.ordinal(i) }) : String(DAN_STAGES[i].key));

export const eventKinds = ({ t }: Ctx): Record<string, { tag: string; label: string }> => ({
  snipe: { tag: t('#1 sniped'), label: t('Snipes') },
  crown: { tag: t('Crown'), label: t('Crowns') },
  duel: { tag: t('Duel'), label: t('Duels') },
  bounty: { tag: t('Bounty claimed'), label: t('Bounties') },
  post: { tag: t('Bounty posted'), label: t('New bounties') },
  tip: { tag: t('Tip'), label: t('Tips') },
  top: { tag: t('Top play'), label: t('Top plays') },
  dan: { tag: 'Dan', label: 'Dan' },
  pass: { tag: t('Overtake'), label: t('Overtakes') },
  mile: { tag: t('Milestone'), label: t('Milestones') },
  join: { tag: t('New player'), label: t('New players') },
});

/** An activity event (activity.json): only the fields a kind has are there. */
export interface ActivityEvent {
  t: number;
  k: string;
  u: number;
  v?: number | number[];
  c?: Cat;
  s?: Play;
  m?: number;
  pp?: number;
  /** A climb's new rank, or a duel's rating change. */
  r?: number;
  i?: number;
  /** A Dan pass's stage, or a duel's id. */
  d?: number;
  /** A duel's score, the winner's first. */
  sc?: [number, number];
  /** A duel won by forfeit. */
  ff?: number;
  g?: string;
  a?: number;
  n?: string | number;
  h?: [string, string];
  mo?: string;
}

const who = (ctx: Ctx, players: Players, id: number): Safe => {
  const row = rowOf(players, id);
  return html`<a href="/player/${id}"><b class="${row < 0 ? '' : nameClass(ctx, players, row)}">${playerName(players, id)}</b></a>`;
};

/** A bounty claim, by goal: whole sentences, as Portuguese words them differently. */
const BOUNTY_CLAIMED: Record<string, string> = /* i18n */ {
  fc: '{who} claimed the FC bounty', pass: '{who} claimed the first-pass bounty', snipe: '{who} claimed the snipe bounty',
};
/** A bounty a player posted with Bananas, by goal. */
const BOUNTY_POSTED: Record<string, string> = /* i18n */ {
  fc: '{who} put {stake} on an FC', pass: '{who} put {stake} on a first pass', snipe: '{who} put {stake} on taking the #1',
};

function describe(ctx: Ctx, e: ActivityEvent, players: Players, maps: Record<string, MapMeta>): { what: Value; where: Value } {
  const { t, th, fmt } = ctx;
  // A play's map, or the map a crown or bounty event names.
  const mapId = e.s ? e.s[S.MAP] : e.m;
  const map = mapId ? html`<a class="dim-link" href="/map/${mapId}">${mapLabel(ctx, mapId, maps[mapId])}</a>` : '';
  const one = (id: number | number[] | undefined) => who(ctx, players, Array.isArray(id) ? id[0] : id!);
  const by = who(ctx, players, e.u);
  switch (e.k) {
    case 'crown':
      // A crown taken on King of the hill, or a closed month's King.
      return e.mo
        ? { what: th('{who} is King of the hill for {month}, with {crowns}', { who: by, month: monthLabel(ctx, e.mo), crowns: fmt.plural(e.n as number, 'crown') }), where: '' }
        : { what: th('{who} took the {slot} crown from {other}', { who: by, slot: `${slotName(ctx, e.h![0])} · ${tierName(ctx, e.h![1])}`, other: one(e.v) }), where: map };
    case 'duel': {
      // A ranked duel's result (tools/lib/duels.mjs): the winner, the score and their rating change.
      const vars = { who: by, other: one(e.v), score: `${fmt.num(e.sc![0])}–${fmt.num(e.sc![1])}` };
      return {
        what: e.ff ? th('{who} won a ranked duel against {other}, who forfeited', vars) : th('{who} beat {other} {score} in a ranked duel', vars),
        where: html`<a class="dim-link" href="/duel/${e.d}">${t('See the duel')}</a>${e.r !== undefined ? html` · ${th('{change} rating', { change: deltaText(ctx, e.r) })}` : ''}`,
      };
    }
    case 'bounty':
      return { what: th(BOUNTY_CLAIMED[e.g!], { who: by }), where: e.a ? html`${map} · ${t('{n} from the pot', { n: bananas(ctx, e.a) })}` : map };
    case 'post':
      return { what: th(BOUNTY_POSTED[e.g!], { who: by, stake: bananas(ctx, e.a!) }), where: map };
    case 'tip':
      return { what: th('{who} tipped {other} {n}', { who: by, other: one(e.v), n: bananas(ctx, e.a!) }), where: e.n ? html`<span class="quote">“${e.n}”</span>` : '' };
    case 'snipe':
      return { what: th('{who} took the #1 from {other}', { who: by, other: one(e.v) }), where: map };
    case 'top':
      return {
        what: e.i === 1
          ? th('{who} set a new best play in {cat}', { who: by, cat: catLabel(ctx, e.c!) })
          : th('{who} set a new {nth} best play in {cat}', { who: by, nth: fmt.ordinal(e.i!, { feminine: true }), cat: catLabel(ctx, e.c!) }),
        where: map,
      };
    case 'dan':
      return { what: th('{who} passed the {dan}', { who: by, dan: danName(ctx, e.d!) }), where: html`${fmt.acc(e.s![S.ACC])} · ${map}` };
    case 'pass': {
      const passed = e.v as number[];
      const vars = { who: by, other: who(ctx, players, passed[0]), n: fmt.num(passed.length - 1), cat: catLabel(ctx, e.c!) };
      return {
        what: passed.length > 1 ? th('{who} overtook {other} and {n} more in {cat}', vars) : th('{who} overtook {other} in {cat}', vars),
        where: t('Now {rank} with {pp} pp', { rank: fmt.rank(e.r), pp: fmt.pp(e.pp!) }),
      };
    }
    case 'mile':
      return { what: th('{who} reached {pp} pp in {cat}', { who: by, pp: fmt.num(e.pp), cat: catLabel(ctx, e.c!) }), where: '' };
    case 'join':
      return { what: th('{who} joined the leaderboards', { who: by }), where: '' };
    default:
      return { what: '', where: '' };
  }
}

/**
 * The Discord's reaction to an event, in its own words, only for the few moments that have a real in-joke (a no-fail
 * "snipe", Tris losing a #1, Christmas, a TrisAcc FC). Most events have none (DESIGN.md §12). Stable per event.
 */
function quip(ctx: Ctx, e: ActivityEvent): string | null {
  const lines = quips(ctx);
  const date = new Date(e.t * 1000);
  switch (e.k) {
    case 'snipe':
      if (e.s![S.MODS] & MOD.NF) return lines.noRealSnipe;
      if (e.v === THRONE_PLAYER) return lines.throne;
      if (date.getUTCMonth() === 11 && (date.getUTCDate() === 24 || date.getUTCDate() === 25)) return lines.christmas;
      return null;
    case 'top':
      return e.s![S.MISS] === 0 && e.s![S.GRADE] === 'A' ? pick(lines.trisAcc, `${e.k}:${e.u}:${e.t}`) : null;
    default:
      return null;
  }
}

/**
 * Plays worth a tip (a snipe, top play, Dan, crown, duel won or claim): on the Activity page, for a signed-in player,
 * never their own.
 */
const TIPPABLE = new Set(['snipe', 'top', 'dan', 'crown', 'duel', 'bounty']);
const tipLink = (ctx: Ctx, e: ActivityEvent, players: Players): Safe | '' => (TIPPABLE.has(e.k) && ctx.me !== null && ctx.me !== e.u
  ? html`<a class="event-tip small" href="/player/${e.u}?tip=1" aria-label="${ctx.t('Tip {name}', { name: playerName(players, e.u) })}">${ctx.t('Tip')}</a>`
  : '');

export function eventItem(ctx: Ctx, e: ActivityEvent, players: Players, maps: Record<string, MapMeta>, { tips = false } = {}): Safe {
  const { fmt } = ctx;
  const { what, where } = describe(ctx, e, players, maps);
  const line = quip(ctx, e);
  const play = e.s && (e.k === 'snipe' || e.k === 'top')
    ? html`<div class="event-play">${catChip(ctx, e.c!)} ${modsBadges(e.s[S.MODS])} ${ppText(ctx, e.s[S.PP])}</div>`
    : '';
  return html`<div class="event ev-${e.k}">
    <div class="event-head">
      <span class="event-kind">${eventKinds(ctx)[e.k]?.tag}</span>
      <span title="${fmt.dateTime(e.t)}">${fmt.ago(e.t)}</span>
    </div>
    <div class="what">${what}</div>
    ${where ? html`<div class="where">${where}</div>` : ''}
    ${play}
    ${tips ? tipLink(ctx, e, players) : ''}
    ${line ? html`<div class="quip">${line}</div>` : ''}
  </div>`;
}
