// Every player the bot tracks (/players), from the core pack alone (players.json by column), as
// assets/js/pages/players.js draws them: a card each, searched by name, sorted, 48 to a page.
//
// render() is pure: the whole page, already searched, sorted and paged by the address's ?q=, ?sort= and ?page=, so the
// first paint is final and the edge can send it as it is. The browser-only part (the search box, the sort, the pager)
// is players.mount.ts.

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { danRole } from '../kernel/model.ts';
import { pageHead, emptyFiltered, resultCount } from '../ui/page.ts';
import { avatar, type Players } from '../ui/players.ts';

/** Cards to a page. */
export const PAGE_SIZE = 48;

const SORT_KEYS = ['cv', 'ul', 'pp', 'firsts', 'last', 'name'] as const;
export type Sort = typeof SORT_KEYS[number];

export interface State {
  /** The search box's text. */
  q: string;
  sort: Sort;
  /** The page, from 0 (?page= counts from 1). */
  page: number;
}

const isSort = (key: string | undefined): key is Sort => (SORT_KEYS as readonly (string | undefined)[]).includes(key);

export const readState = (query: Record<string, string | undefined>): State =>
  ({ q: query.q || '', sort: isSort(query.sort) ? query.sort : 'cv', page: Math.max(0, (Number(query.page) || 1) - 1) });

const sortLabels = ({ t }: Ctx): Record<Sort, string> => ({
  cv: t('Converts pp'),
  ul: t('Loved pp'),
  pp: t('Official pp'),
  firsts: t('Number of #1s'),
  last: t('Played most recently'),
  name: t('Name'),
});

const names = new Intl.Collator('en');
const firsts = (players: Players, row: number) => players.firstsC[row] + players.firstsU[row] + players.firstsR[row];

/** Each sort as a comparison of two rows in players (pp in hundredths compare as the JSON's pp do). */
const ORDER: Record<Sort, (players: Players, a: number, b: number) => number> = {
  cv: (p, a, b) => p.cv[b] - p.cv[a],
  ul: (p, a, b) => p.ul[b] - p.ul[a],
  pp: (p, a, b) => p.pp[b] - p.pp[a],
  firsts: (p, a, b) => firsts(p, b) - firsts(p, a),
  last: (p, a, b) => p.last[b] - p.last[a],
  name: (p, a, b) => names.compare(p.name.at(a), p.name.at(b)),
};

/**
 * The rows in players the search leaves, in the sort's order. The pack's rows are players.json's order, and the sort
 * is stable, so ties keep the order the old page gave them.
 */
export function visibleRows(core: CorePack, q: string, sort: Sort): number[] {
  const players = core.players;
  const needle = q.trim().toLowerCase();
  const rows: number[] = [];
  for (let row = 0; row < players.rows; row++) {
    if (!needle || players.name.at(row).toLowerCase().includes(needle)) rows.push(row);
  }
  return rows.sort((a, b) => ORDER[sort](players, a, b));
}

/** The count line: "110 players", or "3 of 110 players" while searching. */
export const countText = (ctx: Ctx, core: CorePack, shown: number) => resultCount(ctx, shown, core.players.rows, 'player');

/** What shows instead of the cards when the search matches nobody, with the way back. */
export const noMatch = (ctx: Ctx, q: string) =>
  emptyFiltered(ctx, ctx.t('No player’s name contains “{q}”.', { q: q.trim() }));

function card(ctx: Ctx, players: Players, row: number): Safe {
  const { t, fmt } = ctx;
  const role = danRole(players.danScore[row]);
  const last = players.last[row];
  return html`<a class="card card-link" href="/player/${players.id[row]}">
    <div class="mb-3 player">${avatar(ctx, players, row, 'avatar-md')}<span class="text-lg fw-600">${players.name.at(row)}</span></div>
    <dl class="kv kv-3">
      <div><dt>${t('Converts')}</dt><dd>${fmt.num(players.cv[row] / 100)}</dd></div>
      <div><dt>${t('Loved')}</dt><dd>${fmt.num(players.ul[row] / 100)}</dd></div>
      <div><dt>${t('Official')}</dt><dd>${fmt.num(players.pp[row] / 100)}</dd></div>
    </dl>
    <p class="m-0 mt-2 small faint">${role ? html`<span class="badge badge-gold">${role}</span> ` : ''}${last ? t('Last played {ago}', { ago: fmt.ago(last) }) : t('No plays recorded')}</p>
  </a>`;
}

/** One page of cards. */
export const cards = (ctx: Ctx, core: CorePack, slice: readonly number[]): Safe =>
  html`<div class="grid grid-auto">${slice.map(row => card(ctx, core.players, row))}</div>`;

/** The previous/next buttons, as client/dom.ts paginate() draws them (it takes over the list once the page is up). */
function pager(ctx: Ctx, page: number, pages: number): Safe {
  const { t, fmt } = ctx;
  return html`<nav class="pager" aria-label="${t('Pages')}">
        <button class="btn btn-small" type="button" data-page="prev" ${page === 0 ? raw('disabled') : ''}>← ${t('Previous')}</button>
        <span>${t('Page {page} of {pages}', { page: fmt.num(page + 1), pages: fmt.num(pages) })}</span>
        <button class="btn btn-small" type="button" data-page="next" ${page >= pages - 1 ? raw('disabled') : ''}>${t('Next')}</button>
      </nav>`;
}

/** The list as paginate() draws it: a page of cards (a page past the end shows the last), or the empty state. */
function list(ctx: Ctx, core: CorePack, rows: number[], state: State): Safe {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(state.page, pages - 1);
  const slice = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  return html`${slice.length ? cards(ctx, core, slice) : noMatch(ctx, state.q)}
      ${pages > 1 ? pager(ctx, page, pages) : ''}`;
}

export const title = ({ t }: Ctx) => t('Players');

export function render(ctx: Ctx, core: CorePack, state: State): Safe {
  const { t, fmt } = ctx;
  const labels = sortLabels(ctx);
  const rows = visibleRows(core, state.q, state.sort);
  return html`
    ${pageHead({ title: t('Players'), intro: t('All {n} Portuguese players the bot tracks. Open a profile to see their plays, Dan course progress and pp history.', { n: fmt.num(core.players.rows) }) })}
    <div class="toolbar">
      <input class="input" type="search" id="q" placeholder="${t('Search players…')}" value="${state.q}" aria-label="${t('Search players')}">
      <select class="select" id="sort" aria-label="${t('Sort')}">${SORT_KEYS.map(key => html`<option value="${key}" ${key === state.sort ? raw('selected') : ''}>${labels[key]}</option>`)}</select>
    </div>
    <p class="result-count" id="count">${countText(ctx, core, rows.length)}</p>
    <div id="list">${list(ctx, core, rows, state)}</div>
  `;
}
