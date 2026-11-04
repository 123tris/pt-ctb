// The Converts, Loved and Ranked leaderboards (/rankings/converts|loved|ranked), from the core pack alone. The same
// page as assets/js/pages/rankings.js draws, which still draws the Mods, Top plays and Star kings tabs.
//
// render() is pure: the whole page, already filtered by the address's ?q= and ?legends=, so the first paint is final
// and the edge can send it as it is. The browser-only part (the filter box, the checkbox) is rankings.mount.ts.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { pageHead, tabs, empty, emptyFiltered, resultCount, dataTable, col } from '../ui/page.ts';
import { playerLink, ppText, officialPp, isInactiveOnOsu, isInactive, isLegend, legendTag, inactiveTag, statusTag, type Players } from '../ui/players.ts';

export type Cat = 'c' | 'u' | 'r';
/** The boards this view draws, by their address. */
export const BOARD_CAT = { converts: 'c', loved: 'u', ranked: 'r' } as const;
export type Slug = keyof typeof BOARD_CAT;
/** Every tab on the page, in order. */
export const SLUGS = ['converts', 'loved', 'ranked', 'mods', 'plays', 'kings'] as const;
export type Tab = typeof SLUGS[number];

export interface State {
  slug: Slug;
  /** The filter box's text. */
  q: string;
  /** Show inactive players (unticked: ?legends=0). */
  legends: boolean;
  /** A player's id from a profile's rank link (?at=): their row is marked and scrolled to. */
  at: number | null;
}

export const readState = (slug: Slug, query: Record<string, string | undefined>): State =>
  ({ slug, q: query.q || '', legends: query.legends !== '0', at: Number(query.at) || null });

const labels = (ctx: Ctx): Record<Tab, { label: string; board: string }> => ({
  converts: { label: ctx.t('Converts'), board: ctx.t('Converts leaderboard') },
  loved: { label: ctx.t('Loved'), board: ctx.t('Loved & Unranked leaderboard') },
  ranked: { label: ctx.t('Ranked'), board: ctx.t('Ranked (official) leaderboard') },
  mods: { label: ctx.t('Mods'), board: ctx.t('By mods leaderboard') },
  plays: { label: ctx.t('Top plays'), board: ctx.t('Top plays') },
  kings: { label: ctx.t('Star kings'), board: ctx.t('Star kings leaderboard') },
});

/** The page's title: the board's name. */
export const title = (ctx: Ctx, slug: Tab) => labels(ctx)[slug].board;

/** The page's heading and its tabs, the same on every board. */
export const head = (ctx: Ctx, slug: Tab): Safe => html`
    ${pageHead({ title: ctx.t('Leaderboards'), extra: html`<p class="page-links"><a href="/players">${ctx.t('All players')}</a><a href="/compare">${ctx.t('Compare two players')}</a></p>` })}
    ${tabs(SLUGS.map(s => ({ href: `/rankings/${s}`, label: labels(ctx)[s].label, active: s === slug })), ctx.t('Leaderboard type'))}`;

/** The board's rows in players, best first. */
export function boardRows(core: CorePack, cat: Cat): Uint16Array {
  return (cat === 'c' ? core.boardC : cat === 'u' ? core.boardU : core.boardR).row;
}

/**
 * How a board marks an inactive player: greyed out, and tagged "legend" or "inactive". On the official board only
 * being inactive on osu! counts.
 */
export function greyed(ctx: Ctx, players: Players, row: number, official: boolean): boolean {
  return official ? isInactiveOnOsu(players, row) : isInactive(ctx, players, row);
}

export function tag(ctx: Ctx, players: Players, row: number, official: boolean): Safe | '' {
  if (!official) return statusTag(ctx, players, row);
  return isLegend(ctx, players, row) ? legendTag(ctx) : isInactiveOnOsu(players, row) ? inactiveTag(ctx, players, row) : '';
}

/** Whether anyone keeps official pp while inactive on osu! (they're on the Ranked board, greyed out). */
function hasInactiveOnOsu(players: Players): boolean {
  for (let row = 0; row < players.rows; row++) if (isInactiveOnOsu(players, row) && players.pp[row] > 0) return true;
  return false;
}

/** Which of the board's rows the filter leaves, as a mask over `rows` (1 shown). */
export function visible(ctx: Ctx, core: CorePack, cat: Cat, q: string, legends: boolean): Uint8Array {
  const rows = boardRows(core, cat);
  const players = core.players;
  const needle = q.trim().toLowerCase();
  const shown = new Uint8Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    shown[i] = (needle && !players.name.at(row).toLowerCase().includes(needle)) || (!legends && greyed(ctx, players, row, cat === 'r')) ? 0 : 1;
  }
  return shown;
}

/** The count line and, when the filter leaves nobody, what to say instead of the table. */
export function filterNote(ctx: Ctx, total: number, shown: number, q: string): { count: string; empty: Safe | '' } {
  const query = q.trim();
  return {
    count: total ? resultCount(ctx, shown, total, 'player') : '',
    empty: total && !shown
      ? emptyFiltered(ctx, query ? ctx.t('No player on this leaderboard matches “{q}”.', { q: query }) : ctx.t('Nobody here is active right now.'))
      : '',
  };
}

/**
 * The board's rows from `from` to before `to`, filtered by `shown`. On phones only rank, player and pp stay; the other
 * numbers move under the name.
 */
export function boardBody(ctx: Ctx, core: CorePack, state: State, shown: Uint8Array, from: number, to: number): Safe[] {
  const { t, fmt } = ctx;
  const cat = BOARD_CAT[state.slug];
  const players = core.players;
  const rows = boardRows(core, cat);
  const official = cat === 'r';
  const rank = cat === 'c' ? players.rankC : players.rankU;
  const pp = cat === 'c' ? players.cv : players.ul;
  const count = cat === 'c' ? players.countC : cat === 'u' ? players.countU : players.countR;
  const firsts = cat === 'c' ? players.firstsC : cat === 'u' ? players.firstsU : players.firstsR;
  const noRank = html`<span class="faint" title="${t('Inactive on osu!, so no global or country rank')}">—</span>`;
  const body: Safe[] = [];
  for (let i = from; i < Math.min(to, rows.length); i++) {
    const row = rows[i];
    const id = players.id[row];
    const offOsu = official && isInactiveOnOsu(players, row);
    const grey = greyed(ctx, players, row, official);
    const mark = tag(ctx, players, row, official);
    const cls = [id === ctx.me ? 'me' : '', id === state.at ? 'target' : '', grey ? 'inactive' : '', shown[i] ? '' : 'hidden'].filter(Boolean).join(' ');
    const seen = players.ppSeen[row];
    const sub = official
      ? (offOsu
        ? `${t('Inactive on osu!')} · ${players.ppSource[row] === 3 ? t('pp estimated from their plays') : seen ? t('pp last seen {date}', { date: fmt.date(seen) }) : t('last known pp')}`
        : `${t('{rank} global', { rank: fmt.rank(players.global[row]) })} · ${fmt.acc(players.acc[row] / 100)}`)
      : `${fmt.plural(count[row], 'score')} · ${fmt.plural(firsts[row], '#1', '#1s')}`;
    const last = players.last[row];
    body.push(html`<tr${cls ? html` class="${cls}"` : ''} data-name="${players.name.at(row).toLowerCase()}">
        <td class="rank">${official ? i + 1 : rank[row]}</td>
        <td class="cell-player">${playerLink(ctx, players, row)}${mark ? html` ${mark}` : ''}
          <span class="cell-sub">${sub}</span></td>
        <td class="num">${official ? officialPp(ctx, players, row) : ppText(ctx, pp[row] / 100)}</td>
        ${official
          ? html`<td class="num col-opt">${offOsu ? noRank : fmt.rank(players.global[row])}</td><td class="num col-opt">${offOsu ? noRank : fmt.rank(players.country[row])}</td><td class="num col-opt">${fmt.acc(players.acc[row] / 100)}</td><td class="num col-opt">${fmt.num(players.level[row] / 100, 0)}</td>`
          : html`<td class="num col-opt">${fmt.num(count[row])}</td><td class="num col-opt">${fmt.num(firsts[row])}</td><td class="num faint col-opt">${last ? fmt.ago(last) : '—'}</td>`}
      </tr>`);
  }
  return body;
}

function boardTable(ctx: Ctx, core: CorePack, state: State, shown: Uint8Array, label: string, upTo: number): Safe {
  const { t } = ctx;
  const head = BOARD_CAT[state.slug] === 'r'
    ? [col('#'), col(t('Player')), col('pp', 'num'), col(t('Global'), 'num col-opt'), col(t('Country'), 'num col-opt'), col(t('Accuracy'), 'num col-opt'), col(t('Level'), 'num col-opt')]
    : [col('#'), col(t('Player')), col('pp', 'num'), col(t('Scores'), 'num col-opt'), col(t('#1s in PT'), 'num col-opt'), col(t('Last played'), 'num col-opt')];
  return dataTable(label, head, boardBody(ctx, core, state, shown, 0, upTo), shown.includes(1) ? '' : 'hidden');
}

/** The checkbox for inactive players: its label, or '' on a Ranked board where nobody is inactive on osu!. */
function legendsLabel(ctx: Ctx, core: CorePack, cat: Cat): string {
  return cat !== 'r' ? ctx.t('Show inactive players') : hasInactiveOnOsu(core.players) ? ctx.t('Show players inactive on osu!') : '';
}

/** Which rows the state's filter leaves (inactive players always shown where there's no checkbox for them). */
export const shownRows = (ctx: Ctx, core: CorePack, state: State): Uint8Array => {
  const cat = BOARD_CAT[state.slug];
  return visible(ctx, core, cat, state.q, state.legends || !legendsLabel(ctx, core, cat));
};

/**
 * How many rows the first paint draws when the page is drawn in the browser: about a screen's worth, so the first frame
 * stays short (a whole board is 1,500 elements, ~50 ms of the browser's work on a desktop, four times that on a phone).
 * rankings.mount.ts adds the rest a frame at a time.
 */
export const FIRST_ROWS = 30;

/** The whole page; `upTo` rows of the board (all, unless the browser adds the rest after the first paint). */
export function render(ctx: Ctx, core: CorePack, state: State, upTo = Infinity): Safe {
  const { t, fmt } = ctx;
  const cat = BOARD_CAT[state.slug];
  const names = labels(ctx);
  const players = core.players;
  const rows = boardRows(core, cat);
  const dump = core.info.dump.at(0);
  const intro = {
    converts: html`${t('osu!standard maps played in catch mode, weighted the way osu! does it.')} <a class="help-link" href="/glossary">${t('What’s pp?')}</a>`,
    loved: t('Loved, pending and graveyarded maps, with pp the bot works out from the current formula.'),
    ranked: html`${t('The official leaderboard, from each player’s osu! profile. Players inactive on osu! keep their last known pp.')}${dump
      ? html` <span class="faint">${t('Players and plays imported from the osu! data dump of {date}.', { date: dump.replaceAll('_', '-') })}</span>`
      : ''}`,
  }[state.slug];
  const footnote = {
    converts: t('Converts or specifics? Pick a side (and brace for the argument).'),
    loved: t('The higher the star rating, the better the #1. NF snipes aren’t real snipes.'),
    ranked: '',
  }[state.slug];
  // The checkbox for inactive players; on the Ranked board only when someone there is inactive on osu!.
  const box = legendsLabel(ctx, core, cat);
  const legendsBox = box ? html`<span class="checks"><label><input type="checkbox" id="legends" ${state.legends ? 'checked' : ''}> ${box}</label></span>` : '';
  const shown = shownRows(ctx, core, state);
  let shownCount = 0;
  for (const s of shown) shownCount += s;
  const note = filterNote(ctx, rows.length, shownCount, state.q);
  const catLabel = { c: t('Converts'), u: t('Loved & Unranked'), r: t('Ranked') }[cat];

  return html`${head(ctx, state.slug)}
    <p class="muted">${intro}</p>
    <div class="toolbar">
      <input class="input" type="search" id="filter" placeholder="${t('Search players…')}" aria-label="${t('Search this leaderboard')}" value="${state.q}">
      ${legendsBox}
    </div>
    <p class="result-count" id="count">${note.count}</p>
    <div id="board">${rows.length ? boardTable(ctx, core, state, shown, names[state.slug].board, upTo) : empty(t('Nobody is on the {board} leaderboard yet.', { board: catLabel }))}</div>
    <div id="board-empty">${note.empty}</div>
    <p class="mt-3 small"><a href="/players">${t('Browse all {n} players', { n: fmt.num(players.rows) })}</a></p>
    ${footnote ? html`<p class="mt-2 small faint">${footnote}</p>` : ''}
  `;
}
