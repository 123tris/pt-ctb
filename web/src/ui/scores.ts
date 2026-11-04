// Plays in markup, as assets/js/core/ui.js draws them: categories, mods, grades, a play's stats and a play as a row. A
// play is the JSON's score tuple (S in model.ts).

import { html, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { S, modString } from '../kernel/model.ts';
import { mapLink, type MapMeta } from './maps.ts';
import { playerLinkId, ppText, type Players } from './players.ts';

/** A play from the JSON: [map, pp, acc, combo, misses, mods, grade, score, time, hits, pos, score id] (S). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Play = readonly any[];

export type Cat = 'c' | 'u' | 'r';
export const CAT_SLUG = { c: 'converts', u: 'loved', r: 'ranked' } as const;
export const SLUG_CAT = { converts: 'c', loved: 'u', ranked: 'r' } as const;
export const catLabel = (ctx: Ctx, cat: Cat) => ({ c: ctx.t('Converts'), u: ctx.t('Loved & Unranked'), r: ctx.t('Ranked') })[cat];
export const catShort = (ctx: Ctx, cat: Cat) => ({ c: ctx.t('Converts'), u: ctx.t('Loved'), r: ctx.t('Ranked') })[cat];

const MOD_KIND: Record<string, string> = {
  EZ: 'reduce', NF: 'reduce', HT: 'reduce', HD: 'increase', HR: 'increase', DT: 'increase', NC: 'increase',
  FL: 'increase', SD: 'increase', PF: 'increase', RX: 'auto', AU: 'auto', AP: 'auto',
};

export function modsBadges(mask: number): Safe {
  const text = modString(mask);
  if (text === 'NM') return html`<span class="mods"><span class="mod mod-nm">NM</span></span>`;
  const names = text.match(/.{2}/g) ?? [];
  return html`<span class="mods">${names.map(n => html`<span class="mod mod-${MOD_KIND[n] || 'other'}">${n}</span>`)}</span>`;
}

const GRADE_TEXT: Record<string, string> = { X: 'SS', XH: 'SS', S: 'S', SH: 'S' };
export const gradeBadge = (g: string): Safe => html`<span class="grade grade-${g}">${GRADE_TEXT[g] ?? g}</span>`;
export const catChip = (ctx: Ctx, cat: Cat): Safe => html`<span class="cat cat-${cat}">${catShort(ctx, cat)}</span>`;

/** A PT position badge (#1–#3 coloured), or nothing for no position. */
export const posBadge = (ctx: Ctx, n: number | null | undefined, label = ctx.t('Position in Portugal')): Safe | '' =>
  (n ? html`<span class="pos pos-${n <= 3 ? n : 'n'}" title="${label}"><span class="sr-only">${label}: </span>#${n}</span>` : '');

/** A play's page on osu!, or null when its score id isn't known (see S.ID in model.js). */
export const scoreUrl = (s: Play): string | null =>
  (s[S.ID] > 0 ? `https://osu.ppy.sh/scores/${s[S.ID]}` : s[S.ID] < 0 ? `https://osu.ppy.sh/scores/fruits/${-s[S.ID]}` : null);

/** When a play was set (`text`), linked to its page on osu! when that's known. */
export function scoreWhen(ctx: Ctx, s: Play, text: Value): Value {
  const url = scoreUrl(s);
  return url ? html`<a class="dim-link" href="${url}" target="_blank" rel="noopener" title="${ctx.t('{date}: this play on osu!', { date: ctx.fmt.dateTime(s[S.TIME]) })}">${text}</a>` : text;
}

/** The stats of a play: mods (none shown for nomod), grade, accuracy, combo, misses. */
export function scoreStats(ctx: Ctx, s: Play, { combo = true } = {}): Safe {
  const { t, fmt } = ctx;
  return html`${modString(s[S.MODS]) === 'NM' ? '' : modsBadges(s[S.MODS])}
    ${gradeBadge(s[S.GRADE])}
    <span class="acc">${fmt.acc(s[S.ACC])}</span>
    ${combo ? html`<span class="combo">${fmt.num(s[S.COMBO])}x</span>` : ''}
    <span class="miss ${s[S.MISS] ? 'miss-n' : 'miss-fc'}" title="${s[S.MISS] ? t('Misses') : t('Full combo')}">${s[S.MISS] ? html`${fmt.num(s[S.MISS])} ✕<span class="sr-only"> ${t('misses')}</span>` : 'FC'}</span>`;
}

export interface ScoreRowOptions {
  s: Play;
  meta: MapMeta;
  /** Show this player (osu! id), from the core pack's players. */
  player?: number;
  players?: Players;
  pos?: number | null;
  showMap?: boolean;
  cat?: Cat;
}

/** One play as a row: the map (or the player, or both), its stats, pp and when. `pos` shows the PT position badge. */
export function scoreRow(ctx: Ctx, { s, meta, player, players, pos, showMap = true, cat }: ScoreRowOptions): Safe {
  const { fmt } = ctx;
  return html`<div class="row">
    <div class="row-main">
      ${showMap ? mapLink(ctx, s[S.MAP], meta) : ''}
      ${player !== undefined && players ? html`<div>${playerLinkId(ctx, players, player, 'avatar-sm')}</div>` : ''}
    </div>
    <div class="row-meta">
      ${cat ? catChip(ctx, cat) : ''}
      <span class="row-stats">${scoreStats(ctx, s)}</span>
      ${posBadge(ctx, pos)}
      ${ppText(ctx, s[S.PP])}
      <span class="faint" title="${fmt.dateTime(s[S.TIME])}">${scoreWhen(ctx, s, fmt.ago(s[S.TIME]))}</span>
    </div>
  </div>`;
}
