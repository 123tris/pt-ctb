// Completion, a tab of Challenges (/challenges/completion), as assets/js/pages/challenges.js draws it: how many ranked
// osu!catch-specific maps Portugal has cleared, the newest first clears, who alone has cleared some, and the rest as a
// to-do list, sorted, filtered by stars and drawn 50 to a page (?sort=, ?stars=, ?page=). From completion.json
// (tools/lib/completion.mjs), with players from the core pack. completion.mount.ts handles the list's choices.
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

/** completion.json. */
export interface Completion {
  total: number;
  cleared: number;
  /** The same count over ranked osu!standard maps, the converts. */
  converts?: { total: number; cleared: number } | null;
  /** How many players have cleared at least one. */
  players?: number;
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

/** Sort, stars and page from the address; anything unknown is the default. */
export function readState(ctx: Ctx, goal: Completion | null, query: Record<string, string | undefined>): State {
  const known = goal ? sortsFor(ctx, goal) : [];
  return {
    stars: parseStars(query),
    sort: known.find(([k]) => k === query.sort)?.[0] ?? 'popular',
    page: Math.max(0, Math.floor(Number(query.page) || 1) - 1),
  };
}

/** The maps left that the range shows, in the sort's order. */
export const visible = (ctx: Ctx, goal: Completion, stars: StarRange, sort: Sort): LeftRow[] =>
  goal.left.filter(r => inStars(r[3], stars)).sort(sorts(ctx)[sort][1]);

const percent = (n: number, total: number) => (total ? (n / total) * 100 : 0);

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

/** What to say when no map left is in the range, with the way back. */
export const noneLeft = (ctx: Ctx, stars: StarRange): Safe =>
  emptyFiltered(ctx, ctx.t('No uncleared maps at {stars}.', { stars: starsLabel(ctx, stars) }));

/** "12 of 2,354 maps": the maps left that the range shows. */
export const countText = (ctx: Ctx, goal: Completion, items: readonly LeftRow[]): string => resultCount(ctx, items.length, goal.left.length, 'map');

/** The tab's panel; data from before completion.json says it's on its way. */
export function render(ctx: Ctx, goal: Completion | null, players: Players, state: State): Safe {
  const { t, th, fmt } = ctx;
  if (!goal) return empty(t('The completion goal arrives with the next data update.'));
  const pct = percent(goal.cleared, goal.total);
  const conv = goal.converts;
  const items = visible(ctx, goal, state.stars, state.sort);
  return html`
    <section class="goal">
      <p class="goal-figure">${fmt.num(pct, 1)}%</p>
      <p class="goal-of">${goal.players
        ? th('{cleared} of {total} ranked osu!catch maps cleared, by {players}', { cleared: html`<b>${fmt.num(goal.cleared)}</b>`, total: html`<b>${fmt.num(goal.total)}</b>`, players: fmt.plural(goal.players, 'player') })
        : th('{cleared} of {total} ranked osu!catch maps cleared', { cleared: html`<b>${fmt.num(goal.cleared)}</b>`, total: html`<b>${fmt.num(goal.total)}</b>` })}</p>
      <div class="goal-bar" role="meter" aria-label="${t('Ranked osu!catch maps cleared')}" aria-valuemin="0" aria-valuemax="${goal.total}"
        aria-valuenow="${goal.cleared}" aria-valuetext="${t('{pct}% cleared', { pct: fmt.num(pct, 1) })}" style="--done:${pct.toFixed(2)}%"><span></span></div>
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
      <div class="section-head"><h2>${t('Not cleared yet')}</h2><span class="muted small">${t('Ranked maps no Portuguese player has passed.')}</span></div>
      ${goal.left.length ? html`
        <div class="toolbar">
          <select class="select" id="left-sort" aria-label="${t('Sort')}">${sortsFor(ctx, goal).map(([k, [label]]) => html`<option value="${k}" ${k === state.sort ? raw('selected') : ''}>${label}</option>`)}</select>
        </div>
        ${starSlider(ctx, state.stars)}
        <p class="result-count" id="left-count">${countText(ctx, goal, items)}</p>
        <div id="left-list">${paged(ctx, items, slice => leftRows(ctx, goal, slice), { size: PAGE, page: state.page, empty: () => noneLeft(ctx, state.stars) })}</div>` : empty(t('Every ranked osu!catch map is cleared. Converts next?'))}
    </section>
  `;
}
