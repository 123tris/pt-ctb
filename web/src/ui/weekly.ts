// The week's pass race as the bot runs it, as assets/js/core/weekly.js draws it: the week so far (home) and the whole
// recap (Activity's "This week"). challenges.json (or home.json) carries `weekly`: { current: { start, end, passes,
// players, complete, top, most }, mapVote, past }.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { S } from '../kernel/model.ts';
import { mapLabel, mapLink, type MapMeta } from './maps.ts';
import { playerLinkId, ppText, type Players } from './players.ts';
import { catChip, scoreStats, scoreUrl, scoreWhen, type Cat, type Play } from './scores.ts';
import { empty } from './page.ts';

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

/** A past week: its map (and whether it was voted), its top play and who played most. */
export interface PastWeek {
  start: number;
  end: number;
  complete: boolean;
  map?: number | null;
  voted?: boolean;
  top?: [number, string, ...unknown[]] | null;
  most?: [number, number] | null;
}

export interface Weekly {
  current?: Week | null;
  mapVote?: { start: number; end: number; url: string; candidates?: [number, number][] } | null;
  past?: PastWeek[];
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
    ${mapVote ? html`<div class="week-top"><span class="faint small">${t('Next map')}</span> ${t('Pick the map of the week for {week}.', { week: weekRange(ctx, mapVote) })} <a href="${mapVote.url}" target="_blank" rel="noopener">${t('Vote on Discord')}</a></div>` : ''}
  </section>`;
}

/** A highlighted play ([user, category, ...play]) as a row, with what it's highlighted for. */
function highlightRow(ctx: Ctx, label: string, [uid, cat, ...rest]: [number, string, ...unknown[]], maps: Record<string, MapMeta>, players: Players): Safe {
  const { fmt } = ctx;
  const s = rest as Play;
  return html`<div class="row">
  <div class="row-main"><span class="muted small">${label}</span>${mapLink(ctx, s[S.MAP], maps[s[S.MAP]])}<div>${playerLinkId(ctx, players, uid, 'avatar-sm')}</div></div>
  <div class="row-meta">${catChip(ctx, cat as Cat)} ${scoreStats(ctx, s)}<span class="sep"></span>${ppText(ctx, s[S.PP])}
    <span class="faint" title="${fmt.dateTime(s[S.TIME])}">${scoreWhen(ctx, s, fmt.ago(s[S.TIME]))}</span></div>
</div>`;
}

/** A play in one table cell, on two lines: who and the pp (linked to the play on osu! when known), then the map. */
function playCell(ctx: Ctx, [uid, , ...rest]: [number, string, ...unknown[]], maps: Record<string, MapMeta>, players: Players): Safe {
  const s = rest as Play;
  const url = scoreUrl(s);
  const pp = url ? html`<a href="${url}" target="_blank" rel="noopener" title="${ctx.t('This play on osu!')}">${ppText(ctx, s[S.PP])}</a>` : ppText(ctx, s[S.PP]);
  const label = mapLabel(ctx, s[S.MAP], maps[s[S.MAP]]);
  return html`<span class="cell-line">${playerLinkId(ctx, players, uid, 'avatar-sm')} ${pp}</span>
    <a class="cell-line dim-link small" href="/map/${s[S.MAP]}" title="${label}">${label}</a>`;
}

/**
 * Past weeks as a table that always fits the page: every cell is one or two lines, and long names end in "…". On
 * phones only the map column stays, with the week and the top play folded under it.
 */
function pastWeeks(ctx: Ctx, past: PastWeek[], maps: Record<string, MapMeta>, players: Players): Safe {
  const { t, fmt } = ctx;
  const weeks = past.slice(0, 26);
  const picked = (voted: boolean) => (voted ? t('Voted') : t('Automatic pick'));
  // "19–25 Oct", with a * when the bot missed part of the week (the footnote under the table says so).
  const week = (p: PastWeek) => html`${weekRange(ctx, p)}${p.complete ? '' : html`<span aria-hidden="true">*</span><span class="sr-only"> (${t('some plays missing')})</span>`}`;
  return html`<div class="table-wrap" data-label="${t('Past weeks')}"><table class="table-compact table-weeks">
    <thead><tr><th class="col-opt col-week">${t('Week')}</th><th>${t('Map of the week')}</th><th class="col-opt col-top">${t('Top pp play')}</th><th class="col-opt col-most">${t('Most plays')}</th></tr></thead>
    <tbody>${weeks.map(p => html`<tr>
      <td class="col-opt"><span class="cell-line">${week(p)}</span>
        ${p.map && p.voted !== undefined ? html`<span class="cell-line faint small">${picked(p.voted)}</span>` : ''}</td>
      <td>${p.map ? mapLink(ctx, p.map, maps[p.map]) : '—'}
        <span class="cell-sub"><span>${week(p)}${p.map && p.voted !== undefined ? ` · ${picked(p.voted)}` : ''}</span></span>
        ${p.top ? html`<span class="cell-sub">${t('Top play')} ${playerLinkId(ctx, players, p.top[0], 'avatar-sm')} ${ppText(ctx, (p.top.slice(2) as Play)[S.PP])}</span>` : ''}</td>
      <td class="col-opt">${p.top ? playCell(ctx, p.top, maps, players) : '—'}</td>
      <td class="col-opt">${p.most ? html`<span class="cell-line">${playerLinkId(ctx, players, p.most[0], 'avatar-sm')}</span>
        <span class="cell-line faint small">${fmt.plural(p.most[1], 'play')}</span>` : '—'}</td>
    </tr>`)}</tbody>
  </table></div>
  ${weeks.some(p => !p.complete) ? html`<p class="faint small mt-2">* ${t('The bot was offline for part of this week, so some plays may be missing.')}</p>` : ''}`;
}

/** The whole recap (Activity's "This week" tab). Each part only appears once the bot has written it. */
export function weeklyRecap(ctx: Ctx, weekly: Weekly | null | undefined, maps: Record<string, MapMeta>, players: Players): Safe {
  const { t, fmt } = ctx;
  if (!weekly || !hasWeekly(weekly)) return empty(t('The first weekly recap arrives with the bot’s Monday post.'));
  const { current, mapVote, past = [] } = weekly;
  return html`
    ${current ? html`<section>
      <div class="section-head"><h2>${t('This week so far')}</h2><span class="muted small">${weekLine(ctx, current)}</span></div>
      ${current.top || current.most.length ? html`<div class="rows">
        ${current.top ? highlightRow(ctx, t('Top pp play'), current.top, maps, players) : ''}
        ${current.most.length ? html`<div class="row"><div class="row-main"><span class="muted small">${t('Most plays')}</span></div>
          <div class="row-meta">${current.most.map(([uid, n]) => html`${playerLinkId(ctx, players, uid, 'avatar-sm')} <span>${fmt.plural(n, 'play')}</span>`)}</div></div>` : ''}
      </div>` : empty(t('Nothing yet this week. Go set something.'))}
    </section>` : ''}

    ${mapVote ? html`<section class="section">
      <div class="section-head"><h2>${t('Vote: next map of the week')}</h2><span class="muted small">${t('For {week}. Vote with the reactions on Discord; it closes with Monday’s recap, and with no votes the first map wins.', { week: weekRange(ctx, mapVote) })}</span></div>
      <div class="rows">${(mapVote.candidates ?? []).map(([id, n], i) => html`<div class="row">
        <div class="row-main"><span class="muted small">${i + 1}.</span>${mapLink(ctx, id, maps[id])}</div>
        <div class="row-meta"><span>${t('{players} from Portugal', { players: fmt.plural(n, 'player') })}</span></div>
      </div>`)}</div>
      <div class="mt-3 btn-row"><a class="btn btn-primary" href="${mapVote.url}" target="_blank" rel="noopener">${t('Vote on Discord')}</a></div>
    </section>` : ''}

    ${past.length ? html`<section class="section">
      <div class="section-head"><h2>${t('Past weeks')}</h2><span class="muted small">${t('The map of the week is voted on Discord; a week nobody voted for gets an automatic pick.')}</span></div>
      ${pastWeeks(ctx, past, maps, players)}
    </section>` : ''}`;
}
