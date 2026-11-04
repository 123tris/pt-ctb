// The week's pass race as the bot runs it, as assets/js/core/weekly.js draws it: the week so far (home). challenges.json
// (or home.json) carries `weekly`: { current: { start, end, passes, players, complete, top, most }, mapVote, past }.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { S } from '../kernel/model.ts';
import { mapLabel, type MapMeta } from './maps.ts';
import { playerLinkId, ppText, type Players } from './players.ts';
import type { Play } from './scores.ts';

export interface Week {
  start: number;
  end: number;
  passes: number;
  players: number;
  complete: boolean;
  /** The week's best play: [player, category, ...play]. */
  top?: [number, string, ...unknown[]] | null;
  /** Who played most: [[player, plays]]. */
  most: [number, number][];
}

export interface Weekly {
  current?: Week | null;
  mapVote?: { start: number; end: number; url: string } | null;
  past?: unknown[];
}

export const hasWeekly = (weekly: Weekly | null | undefined) => Boolean(weekly && (weekly.current || weekly.mapVote || weekly.past?.length));

const lisbon = new Map<string, { day: Intl.DateTimeFormat; month: Intl.DateTimeFormat }>();

/** "13–19 Jul" (Lisbon dates, Monday to Sunday). */
export function weekRange(ctx: Ctx, { start, end }: { start: number; end: number }): string {
  let f = lisbon.get(ctx.locale);
  if (!f) {
    f = { day: new Intl.DateTimeFormat(ctx.locale, { timeZone: 'Europe/Lisbon', day: 'numeric' }), month: new Intl.DateTimeFormat(ctx.locale, { timeZone: 'Europe/Lisbon', month: 'short' }) };
    lisbon.set(ctx.locale, f);
  }
  const [from, to] = [start, end - 86400].map(t => ({ day: f.day.format(new Date(t * 1000)), month: f.month.format(new Date(t * 1000)) }));
  return from.month === to.month ? `${from.day}–${to.day} ${to.month}` : `${from.day} ${from.month}–${to.day} ${to.month}`;
}

/** "19–25 Oct · 77 passes by 11 players", noting when the bot missed part of the week. */
export const weekLine = (ctx: Ctx, current: Week): string =>
  `${weekRange(ctx, current)} · ${ctx.t('{passes} by {players}', { passes: ctx.fmt.plural(current.passes, 'pass', 'passes'), players: ctx.fmt.plural(current.players, 'player') })}${current.complete ? '' : ` · ${ctx.t('some plays may be missing')}`}`;

/** The week so far (home page): the counts, its top play and who's played most, and the vote for next week's map. */
export function weeklySummary(ctx: Ctx, weekly: Weekly | null | undefined, maps: Record<string, MapMeta>, players: Players): Safe | '' {
  const { t, fmt } = ctx;
  const { current, mapVote } = weekly ?? {};
  if (!current && !mapVote) return '';
  const top = current?.top;
  const play = top ? (top.slice(2) as Play) : null;
  return html`<section class="week-summary">
    <div class="section-head"><h2>${t('This week so far')}</h2><a href="/activity?view=week">${t('The week’s recap')}</a></div>
    ${current ? html`<p class="muted small">${weekLine(ctx, current)}</p>` : ''}
    ${top && play ? html`<div class="week-top"><span class="faint small">${t('Top play')}</span> ${playerLinkId(ctx, players, top[0], 'avatar-sm')}
      <span>${ppText(ctx, play[S.PP])}</span> <a class="dim-link" href="/map/${play[S.MAP]}">${mapLabel(ctx, play[S.MAP], maps[play[S.MAP]])}</a></div>` : ''}
    ${current?.most.length ? html`<div class="week-top"><span class="faint small">${t('Most plays')}</span> ${playerLinkId(ctx, players, current.most[0][0], 'avatar-sm')} <span class="muted">${fmt.plural(current.most[0][1], 'play')}</span></div>` : ''}
    ${mapVote ? html`<div class="week-top"><span class="faint small">${t('Next map')}</span> ${t('Pick the map of the week for {week}.', { week: weekRange(ctx, mapVote) })} <a href="${mapVote.url}" target="_blank" rel="noopener">${t('Vote on Discord')} ↗</a></div>` : ''}
  </section>`;
}
