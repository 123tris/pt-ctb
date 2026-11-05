// Completion, a tab of Challenges (/challenges/completion), as assets/js/pages/challenges.js draws it: how many ranked
// osu!catch-specific maps Portugal has cleared, each year ranked's share under it, the newest first clears, who alone
// has cleared some, and the rest as a to-do list, sorted, filtered by stars and by the year ranked, and drawn 50 to a
// page (?sort=, ?year=, ?stars=, ?page=). From completion.json (tools/lib/completion.mjs), with players from the core
// pack. completion.mount.ts handles the year strip and the list's choices.
//
// Rows of `left`: [mapId, setId, version, stars, rankedDay, osu! plays, length]; `sets`: { setId: [artist, title] }.
// Length (drain seconds) is newer than the rest: data from before it has none, and then the length sorts hide.

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { empty, emptyFiltered, paged, resultCount } from '../ui/page.ts';
import { playerLinkId, type Players } from '../ui/players.ts';
import { mapLink, setCover, starsBadge, type MapMeta } from '../ui/maps.ts';
import { inStars, parseStars, starSlider, starsLabel, type StarRange } from '../ui/star-range.ts';

/** A map not cleared yet: [mapId, setId, version, stars, rankedDay, osu! plays, length]. */
export type LeftRow = readonly [number, number, string, number, number | null, number, (number | null)?];

/** A year ranked: [year, maps, cleared]. */
export type Year = readonly [number, number, number];

/** completion.json. */
export interface Completion {
  total: number;
  cleared: number;
  /** The same count over ranked osu!standard maps, the converts. */
  converts?: { total: number; cleared: number } | null;
  /** How many players have cleared at least one. */
  players?: number;
  /** The same per year the maps were ranked (UTC), oldest first; data from before it has none. */
  years?: Year[];
  /** The newest first clears: [mapId, player, time]. */
  recent: [number, number, number][];
  /** Who alone has cleared some: [player, maps]. */
  sole: [number, number][];
  maps: Record<string, MapMeta>;
  sets: Record<string, [string, string]>;
  left: LeftRow[];
}

export type Sort = 'popular' | 'easy' | 'hard' | 'new' | 'short' | 'long';

export interface State {
  stars: StarRange;
  sort: Sort;
  /** The year ranked the list shows, or null for every year. */
  year: number | null;
  /** The page of the list, from 0. */
  page: number;
}

export const PAGE = 50;

/** The tab's line under the tab strip. */
export const intro = ({ t }: Ctx): string =>
  t('A map counts once any Portuguese player passes it without NF. The goal is every ranked osu!catch-specific difficulty; converts are a separate count.');

type Compare = (a: LeftRow, b: LeftRow) => number;
const byPlays: Compare = (a, b) => b[5] - a[5] || a[0] - b[0];
/** Shortest (1) or longest (-1) first; maps without a length go last either way, ties keep the default order. */
const byLength = (dir: number): Compare => (a, b) => Number(!a[6]) - Number(!b[6]) || dir * ((a[6] ?? 0) - (b[6] ?? 0)) || byPlays(a, b);

/** The list's sorts: [label, compare, needs lengths]. */
const sorts = ({ t }: Ctx): Record<Sort, [string, Compare, boolean?]> => ({
  popular: [t('Most played on osu!'), byPlays],
  easy: [t('Fewest stars'), (a, b) => a[3] - b[3] || a[0] - b[0]],
  hard: [t('Most stars'), (a, b) => b[3] - a[3] || a[0] - b[0]],
  new: [t('Newest ranked'), (a, b) => (b[4] ?? 0) - (a[4] ?? 0) || b[0] - a[0]],
  short: [t('Shortest first'), byLength(1), true],
  long: [t('Longest first'), byLength(-1), true],
});

/** The sorts the data allows: the length ones only once some map has a length. */
const sortsFor = (ctx: Ctx, goal: Completion): [Sort, [string, Compare, boolean?]][] => {
  const timed = goal.left.some(r => r[6]);
  return (Object.entries(sorts(ctx)) as [Sort, [string, Compare, boolean?]][]).filter(([, [, , needsLength]]) => timed || !needsLength);
};

/** The UTC year a `left` row's map was ranked (as completion.json's `years` counts it), or null when unknown. */
const rankedYear = (day: number | null | undefined) => (day == null ? null : new Date(day * 86400000).getUTCFullYear());

/** How many maps are left of each year ranked, by year. */
export function leftByYear(goal: Completion): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of goal.left) {
    const y = rankedYear(r[4]);
    if (y !== null) out.set(y, (out.get(y) ?? 0) + 1);
  }
  return out;
}

/** Sort, year, stars and page from the address; anything unknown is the default. */
export function readState(ctx: Ctx, goal: Completion | null, query: Record<string, string | undefined>): State {
  const known = goal ? sortsFor(ctx, goal) : [];
  const year = Number(query.year);
  return {
    stars: parseStars(query),
    sort: known.find(([k]) => k === query.sort)?.[0] ?? 'popular',
    year: goal && leftByYear(goal).has(year) ? year : null,
    page: Math.max(0, Math.floor(Number(query.page) || 1) - 1),
  };
}

/** The maps left that the range and the year show, in the sort's order. */
export const visible = (ctx: Ctx, goal: Completion, stars: StarRange, sort: Sort, year: number | null = null): LeftRow[] =>
  goal.left.filter(r => inStars(r[3], stars) && (year === null || rankedYear(r[4]) === year)).sort(sorts(ctx)[sort][1]);

const percent = (n: number, total: number) => (total ? (n / total) * 100 : 0);

// ---- The year strip ---------------------------------------------------------------------------------------------------

/**
 * A year's share as the strip's words say it: a whole year cleared is 100%, and anything short of it stops at 99.9%
 * (99.96% would round up), so the words agree with the column's colour.
 */
function yearPct({ fmt }: Ctx, cleared: number, total: number, digits = 1): string {
  if (cleared === total) return fmt.num(100, 0);
  const step = 10 ** -digits;
  return fmt.num(Math.min(100 - step, Math.round(percent(cleared, total) / step) * step), digits);
}
const yearFigures = (ctx: Ctx, [year, total, cleared]: Year) =>
  ({ year, cleared: ctx.fmt.num(cleared), total: ctx.fmt.num(total), pct: yearPct(ctx, cleared, total) });
const isFull = ([, total, cleared]: Year) => total > 0 && cleared === total;

/** A year's line under the strip: "2014: all 149 cleared", "2018: 696 of 709 cleared (98.1%)". */
export const yearText = (ctx: Ctx, y: Year): string => (!y[1] ? ctx.t('{year}: no ranked maps', { year: y[0] })
  : isFull(y) ? ctx.t('{year}: all {total} cleared', yearFigures(ctx, y)) : ctx.t('{year}: {cleared} of {total} cleared ({pct}%)', yearFigures(ctx, y)));

/** The unfinished year furthest behind (the lowest share, then the most maps left), for the strip's line at rest. */
const furthestBehind = (years: readonly Year[]): Year | null => years.filter(y => y[1] && !isFull(y)).reduce<Year | null>((a, b) => (!a
  || percent(b[2], b[1]) < percent(a[2], a[1]) || (percent(b[2], b[1]) === percent(a[2], a[1]) && b[1] - b[2] > a[1] - a[2]) ? b : a), null);

/** completion.json's years with the years between them that ranked nothing as [year, 0, 0], so the strip spaces evenly. */
export function everyYear(years: readonly Year[] | undefined): readonly Year[] | undefined {
  if (!years?.length) return years;
  const by = new Map(years.map(y => [y[0], y]));
  const out: Year[] = [];
  for (let year = years[0][0]; year <= years[years.length - 1][0]; year++) out.push(by.get(year) ?? [year, 0, 0]);
  return out;
}

/**
 * How far each year's ranked maps are cleared, as a strip of thin columns under the goal's bar: kept short and
 * unlabelled but for a few years, with one line that names the year furthest behind and, on hover or tap, the year
 * under the pointer (completion.mount.ts). A year cleared to the last map is gold (an honour, as everywhere on the site),
 * and a year short of it always keeps a visible gap at the top, so 99% never passes for done and colour isn't the only
 * signal. The line's small gold square is the legend. With maps left to list (`listable`), a year that isn't fully
 * cleared lists its maps left, and the one listed (`chosen`) is outlined. Data from before `years` shows nothing.
 */
function yearStrip(ctx: Ctx, years: readonly Year[] | undefined, listable: boolean, chosen: number | null): Safe | '' {
  if (!years || years.length < 2) return '';
  const { t, tn } = ctx;
  const n = years.length, last = n - 1;
  const labelled = years.map(([year], i) => i === 0 || i === last || (year % 5 === 0 && i > 2 && i < last - 2));
  const full = years.filter(isFull).length;
  const behind = furthestBehind(years);
  const parts = [
    full ? html`<span class="goal-years-full"><span class="goal-years-key"></span>${tn(full, '{n} year fully cleared', '{n} years fully cleared')}</span>` : '',
    behind ? t('furthest behind is {year}, with {cleared} of {total} cleared ({pct}%)', yearFigures(ctx, behind)) : t('every year fully cleared'),
  ].filter(Boolean);
  return html`<div class="goal-years">
    <div class="goal-years-cols${listable ? ' is-listable' : ''}" role="img" aria-label="${t('Share cleared by year ranked: {years}', { years: years.filter(y => y[1]).map(([y, total, cleared]) => `${y} ${yearPct(ctx, cleared, total, 0)}%`).join(', ') })}">
      ${years.map((y, i) => html`<span class="goal-year${!y[1] ? ' is-none' : isFull(y) ? ' is-full' : ' is-open'}${y[0] === chosen ? ' is-chosen' : ''}" data-i="${i}" style="--done:${percent(y[2], y[1]).toFixed(1)}%"></span>`)}
    </div>
    <div class="goal-years-axis" aria-hidden="true">${years.map(([year], i) => (labelled[i] ? html`<span style="left:${(((i + 0.5) / n) * 100).toFixed(2)}%">${year}</span>` : ''))}</div>
    <p class="goal-years-note" aria-hidden="true"><span class="faint">${t('By year ranked:')}</span>
      <span id="year-rest">${parts.map((part, i) => html`${i ? ' · ' : ''}${part}`)}</span><span id="year-pick" hidden></span></p>
  </div>`;
}

/** One map left: cover, title and difficulty, then its length, when it was ranked and how much it's played on osu!. */
function leftRow(ctx: Ctx, [id, set, version, stars, rankedDay, plays, length]: LeftRow, sets: Completion['sets']): Safe {
  const { t, fmt } = ctx;
  const named = sets[set];
  const title = named ? `${named[0]} - ${named[1]}` : t('Map #{id}', { id });
  return html`<a class="row card-link" href="/map/${id}">
    <span class="map">
      ${setCover(set)}
      <span class="map-text">
        <span class="map-title" title="${title}">${title}</span>
        <span class="map-sub">${starsBadge(ctx, stars)} [${version}]</span>
      </span>
    </span>
    <span class="row-meta">
      ${length ? html`<span>${fmt.duration(length)}</span><span class="sep"></span>` : ''}
      ${rankedDay ? html`<span>${t('Ranked {date}', { date: fmt.monthYear(rankedDay * 86400) })}</span><span class="sep"></span>` : ''}
      <span>${t('{plays} on osu!', { plays: fmt.plural(plays, 'play') })}</span>
    </span>
  </a>`;
}

/** A page of the maps left. */
export const leftRows = (ctx: Ctx, goal: Completion, slice: readonly LeftRow[]): Safe =>
  html`<div class="rows">${slice.map(r => leftRow(ctx, r, goal.sets))}</div>`;

/** What to say when no map left is in the range and the year, with the way back. */
export const noneLeft = (ctx: Ctx, stars: StarRange, year: number | null = null): Safe =>
  emptyFiltered(ctx, year === null ? ctx.t('No uncleared maps at {stars}.', { stars: starsLabel(ctx, stars) })
    : ctx.t('No uncleared maps ranked in {year} at {stars}.', { year, stars: starsLabel(ctx, stars) }));

/** "12 of 2,354 maps": the maps left that the range shows. */
export const countText = (ctx: Ctx, goal: Completion, items: readonly LeftRow[]): string => resultCount(ctx, items.length, goal.left.length, 'map');

/** The tab's panel; data from before completion.json says it's on its way. */
export function render(ctx: Ctx, goal: Completion | null, players: Players, state: State): Safe {
  const { t, th, fmt } = ctx;
  if (!goal) return empty(t('The completion goal arrives with the next data update.'));
  const years = everyYear(goal.years);
  const pct = percent(goal.cleared, goal.total);
  const conv = goal.converts;
  const items = visible(ctx, goal, state.stars, state.sort, state.year);
  const byYear = leftByYear(goal);
  return html`
    <section class="goal">
      <p class="goal-figure">${fmt.num(pct, 1)}%</p>
      <p class="goal-of">${goal.players
        ? th('{cleared} of {total} ranked osu!catch maps cleared, by {players}', { cleared: html`<b>${fmt.num(goal.cleared)}</b>`, total: html`<b>${fmt.num(goal.total)}</b>`, players: fmt.plural(goal.players, 'player') })
        : th('{cleared} of {total} ranked osu!catch maps cleared', { cleared: html`<b>${fmt.num(goal.cleared)}</b>`, total: html`<b>${fmt.num(goal.total)}</b>` })}</p>
      <div class="goal-bar" role="meter" aria-label="${t('Ranked osu!catch maps cleared')}" aria-valuemin="0" aria-valuemax="${goal.total}"
        aria-valuenow="${goal.cleared}" aria-valuetext="${t('{pct}% cleared', { pct: fmt.num(pct, 1) })}" style="--done:${pct.toFixed(2)}%"><span></span></div>
      ${yearStrip(ctx, years, goal.left.length > 0, state.year)}
      ${conv?.total ? html`<p class="goal-aside">${t('Converts, the long road: {cleared} of {total} ranked osu!standard maps ({pct}%).', { cleared: fmt.num(conv.cleared), total: fmt.num(conv.total), pct: fmt.num(percent(conv.cleared, conv.total), 1) })}</p>` : ''}
    </section>

    ${goal.recent.length || goal.sole.length ? html`<section class="section grid grid-2">
      <div>
        <div class="section-head"><h2>${t('Recently cleared')}</h2></div>
        <p class="muted small">${t('The newest first clears: the earliest pass on record for each map.')}</p>
        ${goal.recent.length ? html`<div class="rows">${goal.recent.map(([id, uid, at]) => html`<div class="row">
          ${mapLink(ctx, id, goal.maps[id])}
          <div class="row-meta">${playerLinkId(ctx, players, uid, 'avatar-sm')} <span class="faint">${fmt.ago(at)}</span></div>
        </div>`)}</div>` : empty(t('No dated clears yet.'))}
      </div>
      <div>
        <div class="section-head"><h2>${t('Only they have cleared')}</h2></div>
        <p class="muted small">${t('Ranked maps no other Portuguese player has passed.')}</p>
        ${goal.sole.length ? html`<div class="rows">${goal.sole.map(([uid, n], i) => html`<div class="row">
          <span class="goal-who"><span class="faint">${i + 1}</span> ${playerLinkId(ctx, players, uid, 'avatar-sm')}</span>
          <span class="row-meta">${fmt.plural(n, 'map')}</span>
        </div>`)}</div>` : empty(t('Every cleared map has at least two players on it.'))}
      </div>
    </section>` : ''}

    <section class="section">
      <div class="section-head" id="left-head"><h2>${t('Not cleared yet')}</h2><span class="muted small">${t('Ranked maps no Portuguese player has passed.')}</span></div>
      ${goal.left.length ? html`
        <div class="toolbar">
          <select class="select" id="left-sort" aria-label="${t('Sort')}">${sortsFor(ctx, goal).map(([k, [label]]) => html`<option value="${k}" ${k === state.sort ? raw('selected') : ''}>${label}</option>`)}</select>
          ${byYear.size ? html`<select class="select" id="left-year" aria-label="${t('Year ranked')}">
            <option value="">${t('Every year')}</option>
            ${[...byYear].sort((a, b) => a[0] - b[0]).map(([y, n]) => html`<option value="${y}" ${y === state.year ? raw('selected') : ''}>${t('Ranked in {year} ({n} left)', { year: y, n: fmt.num(n) })}</option>`)}
          </select>` : ''}
        </div>
        ${starSlider(ctx, state.stars)}
        <p class="result-count" id="left-count">${countText(ctx, goal, items)}</p>
        <div id="left-list">${paged(ctx, items, slice => leftRows(ctx, goal, slice), { size: PAGE, page: state.page, empty: () => noneLeft(ctx, state.stars, state.year) })}</div>` : empty(t('Every ranked osu!catch map is cleared. Converts next?'))}
    </section>
  `;
}
