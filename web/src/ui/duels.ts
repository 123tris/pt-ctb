// Duels' words and pieces, as assets/js/core/duels.js has them, shared by Challenges' Duels tab (views/duels.ts), a
// duel's own page (views/duel.ts), a profile's duel section (views/player.ts) and the Activity feed (ui/events.ts):
// ratings, records, streaks, the format line and a duel as one row. The data is duels.json and duels/<n>.json
// (tools/lib/duels.mjs); a duelist is a row in the core pack, or the name the duel has for someone the site doesn't
// list.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { MapMeta } from './maps.ts';
import { avatar, avatarUrl, nameClass, playerLink, rowOf, tipTag, type Players } from './players.ts';

/** A player in a duel: osu! id, the name the duel has and their points; a ranked duel's ratings before and after. */
export interface DuelSide {
  u: number;
  name: string;
  pts: number;
  before?: number;
  after?: number;
  rd?: number | null;
}

/** A player's score on a round. */
export interface DuelScore {
  u: number;
  score: number;
  acc: number | null;
  combo: number;
  miss: number;
  pass: boolean;
}

/** A round: its map and stars, the winner (null for a tie or a void round), why it didn't count, and both scores. */
export interface DuelRound {
  n: number | null;
  map: number;
  stars: number | null;
  winner: number | null;
  void: string | null;
  scores: DuelScore[];
}

export type DuelStatus = 'finished' | 'forfeit' | 'abandoned';

/** A finished, forfeited or abandoned duel. */
export interface Duel {
  id: number;
  code: string | null;
  ranked: boolean;
  bestOf: number | null;
  status: DuelStatus;
  start: number | null;
  end: number | null;
  /** The lobby on osu!. */
  mp: number | null;
  stars: [number, number] | null;
  wager: number | null;
  winner: number | null;
  players: [DuelSide, DuelSide];
  rounds: DuelRound[];
}

/** A duel being played as of the last update (state.json's `active` list). */
export interface LiveDuel {
  id: number;
  code: string | null;
  ranked: boolean;
  bestOf: number | null;
  start: number | null;
  mp: number | null;
  players: [DuelSide, DuelSide];
}

/** A row of the ladder: rated players by rating with their place, then the provisional ones (`rank` null). */
export interface LadderRow {
  u: number;
  name: string;
  r: number;
  rd: number;
  w: number;
  l: number;
  streak: number;
  peak: number;
  last: number | null;
  prov: boolean;
  rank: number | null;
}

/** duels.json. */
export interface DuelsFile {
  ladder: LadderRow[];
  live: LiveDuel[];
  /** The newest duels, newest first. */
  recent: Duel[];
  /** How many duels there are in all. */
  total: number;
  maps: Record<string, MapMeta>;
}

/** duels/<n>.json: a hundred duels by id, and their maps. */
export interface DuelPage {
  duels: Record<string, Duel>;
  maps: Record<string, MapMeta>;
}

/** meta.json's line on duels: how many are being played now, rated players, duels in all; null before them. */
export interface DuelsBrief {
  live: number;
  players: number;
  total: number;
  leader: number | null;
}

/** A duel from a profile's player's side: won, lost or abandoned, the score, a forfeit, the rating change. */
export interface ProfileDuel {
  id: number;
  t: number;
  opp: number;
  s: [number, number];
  res: 'w' | 'l' | 'x';
  ranked: boolean;
  ff?: number;
  d?: number;
}

/** A profile's slice (players/{id}.json `duels`): `rating` is null until their first ranked duel. */
export interface ProfileDuels {
  rating: { r: number; rd: number; prov: boolean; rank: number | null; w: number; l: number; streak: number; peak: number } | null;
  recent: ProfileDuel[];
  /** [opponent, wins, losses], most played first. */
  h2h: [number, number, number][];
}

/**
 * Duels ship as an experiment: an "Experimental" tag beside their name wherever they appear (the Challenges tab, a
 * duel's page, a profile's section) and a line saying what that means on the tab and the duel page. Remove both once
 * duels are settled.
 */
export const experimentalTag = ({ t }: Ctx): Safe => html`<span class="legend-tag exp-tag">${t('Experimental')}</span>`;
export const experimentalNote = ({ t }: Ctx): Safe => html`<p class="notice exp-note">${t('Duels are new and still being verified; ratings and results may be reset.')}</p>`;

/** A duel's lobby on osu!. */
export const matchUrl = (id: number) => `https://osu.ppy.sh/community/matches/${id}`;

/** "provisional": a rating still settling, with what that means a tap away. */
export const provisionalTag = ({ t }: Ctx, opts: { cls?: string; plain?: boolean } = {}): Safe =>
  tipTag(t('provisional'), t('Fewer than about five ranked duels: the rating moves a lot until it settles.'), opts);

/** A rating as a whole number, with its deviation after it in small print ("1,620 ±80"). */
export const ratingText = ({ t, fmt }: Ctx, r: number, rd?: number | null): Safe =>
  html`${fmt.num(r)}${rd ? html` <small class="faint" title="${t('Rating deviation: how sure the rating is (lower is surer)')}">±${fmt.num(rd)}</small>` : ''}`;

/** "6 wins, 1 loss". */
export const recordWords = ({ t, fmt }: Ctx, w: number, l: number): string =>
  t('{wins}, {losses}', { wins: fmt.plural(w, 'win'), losses: fmt.plural(l, 'loss', 'losses') });

/** "6–1", read out as "6 wins, 1 loss". */
export const recordText = (ctx: Ctx, w: number, l: number): Safe =>
  html`<span title="${recordWords(ctx, w, l)}">${ctx.fmt.num(w)}–${ctx.fmt.num(l)}</span>`;

/** "3 wins in a row" (streak > 0) or "2 losses in a row" (< 0); '' for none. */
export const streakWords = ({ tn }: Ctx, n: number): string =>
  (n > 0 ? tn(n, '{n} win in a row', '{n} wins in a row') : n < 0 ? tn(-n, '{n} loss in a row', '{n} losses in a row') : '');

/** The same, short: "W3" / "L2", with the words for screen readers and on hover. */
export function streakText(ctx: Ctx, n: number): Safe {
  const { t, fmt } = ctx;
  return n
    ? html`<span title="${streakWords(ctx, n)}"><span aria-hidden="true">${n > 0 ? t('W{n}', { n: fmt.num(n) }) : t('L{n}', { n: fmt.num(-n) })}</span><span class="sr-only">${streakWords(ctx, n)}</span></span>`
    : html`<span class="faint">—</span>`;
}

/** A rating change: "+12", "−9" (a real minus), "±0". */
export const deltaText = ({ fmt }: Ctx, d: number): Safe => html`<span class="duel-delta">${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmt.num(Math.abs(d))}</span>`;

/** "Ranked · Best of 5" (an unranked duel is a friendly). */
export const formatText = ({ t }: Ctx, d: { ranked: boolean; bestOf: number | null }): string =>
  [d.ranked ? t('Ranked|duel') : t('Unranked|duel'), d.bestOf ? t('Best of {n}', { n: d.bestOf }) : ''].filter(Boolean).join(' · ');

/** A duel's end in words, for the ones that didn't end on points: '' for a finished duel. */
export const statusText = ({ t }: Ctx, status: DuelStatus): string => ({ finished: '', forfeit: t('Forfeit'), abandoned: t('Abandoned') })[status] ?? '';

/**
 * Why a round didn't count. The bot gives a reason; the ones it gives as codes ("wrong-map", "wrong_map" and "WrongMap"
 * alike) read in the visitor's language, and any other text shows as the bot wrote it.
 */
const VOID_TEXT: Record<string, string> = /* i18n */ {
  wrongmap: 'Wrong map',
  wrongmode: 'Not played in osu!catch',
  notscorev2: 'Not scored with ScoreV2',
  mods: 'Mods other than NF',
  missingplayer: 'A player didn’t play it',
};
export function voidText({ t }: Ctx, reason: string): string {
  const code = String(reason).toLowerCase().replace(/[^a-z0-9]/g, '');
  return Object.hasOwn(VOID_TEXT, code) ? t(VOID_TEXT[code]) : reason;
}

/** Displayed avatar sizes by class (site.css), as ui/players.ts has them. */
const AVATAR_SIZE: Record<string, number> = { 'avatar-lg': 88, 'avatar-md': 44, 'avatar-sm': 22 };

/** A duelist's name: the site's, or the one the duel has for someone the site doesn't list. */
export function duelistName(players: Players, side: { u: number; name: string }): string {
  const row = rowOf(players, side.u);
  return row < 0 ? side.name : players.name.at(row);
}

/** The class for a duelist's name (a bought colour), '' for someone the site doesn't list. */
export function duelistClass(ctx: Ctx, players: Players, id: number): string {
  const row = rowOf(players, id);
  return row < 0 ? '' : nameClass(ctx, players, row);
}

/** A duelist's avatar: the site's thumbnails, or osu!'s own for someone the site doesn't list. */
export function duelistAvatar(ctx: Ctx, players: Players, id: number, cls = ''): Safe {
  const row = rowOf(players, id);
  if (row >= 0) return avatar(ctx, players, row, cls);
  const size = AVATAR_SIZE[cls] ?? 32;
  return html`<img class="avatar ${cls}" src="${avatarUrl(id)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" data-hide-broken>`;
}

/** A duelist's name with avatar, linking to their profile: the site's, or the duel's name for someone it doesn't list. */
export function duelistLink(ctx: Ctx, players: Players, side: { u: number; name: string }, cls = ''): Safe {
  const row = rowOf(players, side.u);
  return row >= 0 ? playerLink(ctx, players, row, cls)
    : html`<a class="player" href="/player/${side.u}">${duelistAvatar(ctx, players, side.u, cls)}<span>${side.name}</span></a>`;
}

/**
 * One side of a duel as it reads in a list: avatar and name (no link: the row is one), the winner's in bold with a
 * hidden "won", and their points.
 */
function sideText(ctx: Ctx, side: DuelSide, players: Players, winner: number | null): Safe {
  const won = winner === side.u;
  return html`<span class="duel-side ${won ? 'duel-winner' : ''}">${duelistAvatar(ctx, players, side.u, 'avatar-sm')}<span class="duel-name ${duelistClass(ctx, players, side.u)}">${duelistName(players, side)}</span>${won ? html`<span class="sr-only"> (${ctx.t('won')})</span>` : ''}</span>`;
}

/** "Alice 3 – 1 Bob": both sides and the points between them. */
export function scoreline(ctx: Ctx, d: Duel, players: Players): Safe {
  const [a, b] = d.players;
  const { fmt } = ctx;
  return html`<span class="duel-line">${sideText(ctx, a, players, d.winner)}<span class="duel-points">${fmt.num(a.pts)}<span class="duel-dash">–</span>${fmt.num(b.pts)}</span>${sideText(ctx, b, players, d.winner)}</span>`;
}

/**
 * A finished duel as one row linking to its page: the scoreline, then its format, how it ended and when. An abandoned
 * duel is muted and says so; the visitor's own is marked.
 */
export function duelRow(ctx: Ctx, d: Duel, players: Players): Safe {
  const { fmt } = ctx;
  const ended = d.end ?? d.start;
  const mine = d.players.some(p => p.u === ctx.me);
  const status = statusText(ctx, d.status);
  return html`<a class="row card-link duel-row ${d.status === 'abandoned' ? 'duel-muted' : ''} ${mine ? 'me' : ''}" href="/duel/${d.id}">
    ${scoreline(ctx, d, players)}
    <span class="row-meta">
      <span>${formatText(ctx, d)}</span>
      ${status ? html`<span class="sep"></span><span>${status}</span>` : ''}
      ${d.stars ? html`<span class="sep"></span><span>${fmt.num(d.stars[0], 1)}–${fmt.num(d.stars[1], 1)}★</span>` : ''}
      ${ended ? html`<span class="sep"></span><span class="faint" title="${fmt.dateTime(ended)}">${fmt.ago(ended)}</span>` : ''}
    </span>
  </a>`;
}
