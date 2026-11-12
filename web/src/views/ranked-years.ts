// The Ranked tab's boards by year (/rankings/ranked/:year): each player's pp from their plays on the maps ranked that
// year alone, catch maps and converts alike, from the years pack (engine/…/Export/Build.Years.cs) and the core pack's
// players. The switch between these and the official board is rankings.ts rankedSwitch().
//
// render() is pure, already filtered by the address's ?q=; ranked-years.mount.ts is the browser half.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack, YearsPack } from '../gen/packs.ts';
import { dataTable, col, empty, emptyFiltered, resultCount } from '../ui/page.ts';
import { playerLinkId, ppText, rowOf, isInactive, statusTag } from '../ui/players.ts';
import { head, rankedSwitch } from './rankings.ts';

export interface Data {
  core: CorePack;
  /** null: the data was exported before the yearly boards existed. */
  years: YearsPack | null;
}

export interface State {
  year: number;
  /** The filter box's text. */
  q: string;
  /** A player's id (?at=): their row is marked and scrolled to. */
  at: number | null;
}

/** A year in the address: four digits, else null (the official board). */
export const yearParam = (value: string | undefined): number | null => (/^\d{4}$/.test(value ?? '') ? Number(value) : null);

export const readState = (year: number, query: Record<string, string | undefined>): State =>
  ({ year, q: query.q || '', at: Number(query.at) || null });

export const title = (ctx: Ctx, year: number) => ctx.t('Ranked {year} leaderboard', { year });

/** A year's board: its rows in the pack (from, count) and how many maps it counts plays on, or null for none. */
export function boardOf(years: YearsPack, year: number): { from: number; count: number; maps: number } | null {
  for (let i = 0; i < years.years.rows; i++) {
    if (years.years.year[i] === year) return { from: years.years.from[i], count: years.years.players[i], maps: years.years.maps[i] };
  }
  return null;
}

/** Which of the board's rows the filter leaves (1 shown), by their order on the board. */
export function visible(core: CorePack, years: YearsPack, from: number, count: number, q: string): Uint8Array {
  const needle = q.trim().toLowerCase();
  const shown = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const row = rowOf(core.players, years.rows.id[from + i]);
    shown[i] = !needle || (row >= 0 && core.players.name.at(row).toLowerCase().includes(needle)) ? 1 : 0;
  }
  return shown;
}

/** The count line and, when the filter leaves nobody, what to say instead of the table. */
export function filterNote(ctx: Ctx, total: number, shown: number, q: string): { count: string; empty: Safe | '' } {
  const query = q.trim();
  return {
    count: total ? resultCount(ctx, shown, total, 'player') : '',
    empty: total && !shown && query ? emptyFiltered(ctx, ctx.t('No player on this leaderboard matches “{q}”.', { q: query })) : '',
  };
}

function boardBody(ctx: Ctx, { core, years }: { core: CorePack; years: YearsPack }, state: State, from: number, shown: Uint8Array): Safe[] {
  const { fmt } = ctx;
  const players = core.players;
  const body: Safe[] = [];
  for (let i = 0; i < shown.length; i++) {
    const r = from + i;
    const id = years.rows.id[r];
    const row = rowOf(players, id);
    const grey = row >= 0 && isInactive(ctx, players, row);
    const mark = row >= 0 ? statusTag(ctx, players, row) : '';
    const cls = [id === ctx.me ? 'me' : '', id === state.at ? 'target' : '', grey ? 'inactive' : '', shown[i] ? '' : 'hidden'].filter(Boolean).join(' ');
    const plays = years.rows.plays[r];
    body.push(html`<tr${cls ? html` class="${cls}"` : ''} data-name="${row >= 0 ? players.name.at(row).toLowerCase() : ''}">
        <td class="rank">${i + 1}</td>
        <td class="cell-player">${playerLinkId(ctx, players, id)}${mark ? html` ${mark}` : ''}
          <span class="cell-sub">${fmt.plural(plays, 'play')}</span></td>
        <td class="num">${ppText(ctx, years.rows.pp[r] / 100)}</td>
        <td class="num col-opt">${fmt.num(plays)}</td>
      </tr>`);
  }
  return body;
}

export function render(ctx: Ctx, { core, years }: Data, state: State): Safe {
  const { t, fmt } = ctx;
  const intro = html`<p class="muted">${t('Each player’s pp from maps ranked in {year} alone, catch maps and converts alike: their best play on each map, weighted the way osu! does it.', { year: state.year })} <a class="help-link" href="/glossary">${t('What’s pp?')}</a></p>`;
  if (!years) {
    return html`${head(ctx, 'ranked')}
      ${intro}
      <div class="toolbar">${rankedSwitch(ctx, null, state.year)}</div>
      ${empty(t('The boards by year ranked arrive with the next data update.'))}`;
  }
  const board = boardOf(years, state.year);
  const count = board?.count ?? 0;
  const shown = board ? visible(core, years, board.from, count, state.q) : new Uint8Array(0);
  let shownCount = 0;
  for (const s of shown) shownCount += s;
  const note = filterNote(ctx, count, shownCount, state.q);
  const label = title(ctx, state.year);
  const table = board
    ? dataTable(label, [col('#'), col(t('Player')), col('pp', 'num'), col(t('Plays'), 'num col-opt')],
      boardBody(ctx, { core, years }, state, board.from, shown), shownCount ? '' : 'hidden')
    : empty(t('Nobody has pp from maps ranked in {year} yet.', { year: state.year }));

  return html`${head(ctx, 'ranked')}
    ${intro}
    <div class="toolbar">
      ${rankedSwitch(ctx, years, state.year)}
      ${board ? html`<input class="input" type="search" id="filter" placeholder="${t('Search players…')}" aria-label="${t('Search this leaderboard')}" value="${state.q}">` : ''}
    </div>
    <p class="result-count" id="count">${note.count}</p>
    <div id="board">${table}</div>
    <div id="board-empty">${note.empty}</div>
    ${board ? html`<p class="mt-2 small faint">${t('Counted from {maps} ranked in {year} with a Portuguese play.', { maps: fmt.plural(board.maps, 'map'), year: state.year })}</p>` : ''}
  `;
}
