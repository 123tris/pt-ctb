// The Maps page (/maps): every map with Portuguese plays, searched, filtered by category and stars, sorted and drawn
// 50 to a page, from the search pack, with the #1s' names from the core pack. The same page as
// assets/js/pages/maps.js drew from maps-top.json and maps-search.json.
//
// render() is pure: the whole page for the address's ?q=, ?cat=, ?stars= (or an old ?diff=), ?sort= and ?page=, with
// that page of results, so the first paint is final and the edge can send it as it is. Only the page shown is drawn.
// The search is ui/map-search.ts; the browser half (the box, the chips, the slider, the pages) is maps.mount.ts.

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { pageHead, chipGroup, emptyFiltered, resultCount, paged } from '../ui/page.ts';
import { setCover, starsBadge } from '../ui/maps.ts';
import { catChip, type Cat } from '../ui/scores.ts';
import { rowOf } from '../ui/players.ts';
import { parseStars, isAnyStars, starsLabel, starSlider } from '../ui/star-range.ts';
import { findMaps, CAT_OF, type MapIndex, type MapQuery, type MapSort, type MapCat } from '../ui/map-search.ts';

export interface Data {
  core: CorePack;
  /** The search pack's index (ui/map-search.ts mapIndex), made once per pack. */
  index: MapIndex;
}

export interface State extends MapQuery {
  /** The page of results, from 0. */
  page: number;
}

export const PAGE = 50;
const SORTS: readonly MapSort[] = ['players', 'stars', 'easy', 'new'];
const CATS: readonly MapCat[] = ['', 'c', 'u', 'r'];

const sortLabels = (ctx: Ctx): Record<MapSort, string> =>
  ({ players: ctx.t('Most players'), stars: ctx.t('Most stars'), easy: ctx.t('Fewest stars'), new: ctx.t('Newest (by id)') });
const catLabels = (ctx: Ctx): Record<MapCat, string> =>
  ({ '': ctx.t('All|categories'), c: ctx.t('Converts'), u: ctx.t('Loved & Unranked'), r: ctx.t('Ranked') });

/** Search, sort, filters and page from the address, as the old page read them: anything unknown is the default. */
export function readState(query: Record<string, string | undefined>): State {
  return {
    q: query.q || '',
    cat: CATS.find(k => k === query.cat) ?? '',
    // Old links filtered by difficulty name (?diff=platter); parseStars reads those as that name's star band.
    stars: parseStars(query),
    sort: SORTS.find(k => k === query.sort) ?? 'players',
    page: Math.max(0, Math.floor(Number(query.page) || 1) - 1),
  };
}

/** "12 of 54,908 maps", or "54,908 maps" for every map. */
export const countText = (ctx: Ctx, data: Data, results: readonly number[]) =>
  resultCount(ctx, results.length, data.index.pack.maps.rows, 'map');

/** What the search and filters are, for the empty state: “cookie” · Ranked · 4★+. */
function describe(ctx: Ctx, query: MapQuery): string {
  const q = query.q.trim();
  return [q && `“${q}”`, query.cat && catLabels(ctx)[query.cat], !isAnyStars(query.stars) && starsLabel(ctx, query.stars)]
    .filter(Boolean).join(' · ');
}

/** One map: cover, title and difficulty, then its category, how many players have played it and who holds the #1. */
function mapRow(ctx: Ctx, { core, index }: Data, i: number): Safe {
  const { t, fmt } = ctx;
  const { sets, maps, tops } = index.pack;
  const id = maps.id[i];
  const set = maps.set[i];
  const title = sets.title.at(set);
  const top = rowOf(core.players, tops.id[maps.top[i]]);
  return html`<a class="plain-link row card-link" href="/map/${id}">
    <span class="map">
      ${setCover(sets.set[set])}
      <span class="map-text">
        <span class="map-title">${title ? `${sets.artist.at(set)} - ${title}` : t('Map #{id}', { id })}</span>
        <span class="map-sub">${starsBadge(ctx, index.stars[i])} ${title ? `[${maps.version.at(i)}]` : t('No map details')}</span>
      </span>
    </span>
    <span class="row-meta">
      ${catChip(ctx, CAT_OF[maps.cat[i]] as Cat)}
      <span>${fmt.plural(maps.players[i], 'player')}</span>
      <span class="sep"></span>
      <span><span class="faint">#1</span> ${top < 0 ? '—' : core.players.name.at(top)}</span>
    </span>
  </a>`;
}

/** A page of maps (rows in the search pack). */
export const mapRows = (ctx: Ctx, data: Data, slice: readonly number[]): Safe =>
  html`<div class="rows">${slice.map(i => mapRow(ctx, data, i))}</div>`;

/** What to say when nothing matches, with the way back. */
export function noMaps(ctx: Ctx, query: MapQuery): Safe {
  const filters = describe(ctx, query);
  return emptyFiltered(ctx, filters ? ctx.t('No maps match {filters}.', { filters }) : ctx.t('No maps match these filters.'));
}

export function render(ctx: Ctx, data: Data, state: State): Safe {
  const { t, fmt } = ctx;
  const results = findMaps(data.index, state);
  const labels = sortLabels(ctx);
  const cats = catLabels(ctx);
  const intro = t('{n} maps with Portuguese plays. Search by artist, title, difficulty or map id; every map has its own Portuguese leaderboard.',
    { n: fmt.num(data.index.pack.maps.rows) });
  return html`
    ${pageHead({ title: t('Maps'), intro })}
    <div class="toolbar">
      <input class="input" type="search" id="q" placeholder="${t('Artist, title, difficulty or id…')}" value="${state.q}" aria-label="${t('Search maps')}">
      <select class="select" id="sort" aria-label="${t('Sort')}">${SORTS.map(k => html`<option value="${k}" ${k === state.sort ? raw('selected') : ''}>${labels[k]}</option>`)}</select>
    </div>
    <div id="cats" class="mb-2">${chipGroup(t('Category'), 'cat', CATS.map(k => [k, cats[k]]), state.cat)}</div>
    ${starSlider(ctx, state.stars)}
    <p class="result-count" id="count">${countText(ctx, data, results)}</p>
    <div id="list">${paged(ctx, results, slice => mapRows(ctx, data, slice), { size: PAGE, page: state.page, empty: () => noMaps(ctx, state) })}</div>
  `;
}
