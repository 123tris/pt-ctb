// The Leaderboards' Star kings tab (/rankings/kings), as assets/js/pages/star-kings.js draws it: every star range's
// king, on catch maps and on converts, or one range's full board (?stars=6&src=converts). From records.json's kings,
// with players from the core pack. kings.mount.ts handles the range and source choices and the moves between views.

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { sharedRanks } from '../kernel/model.ts';
import { chipGroup, empty, dataTable, col } from '../ui/page.ts';
import { playerLinkId, rowOf, isInactive, statusTag } from '../ui/players.ts';
import { head } from './rankings.ts';

export type Source = 'catch' | 'converts';

/** records.json `kings`: per source, each range's title holders, their #1s each, and (newer data) its full board. */
export type Kings = Record<Source, { stars: number; count: number; players: number[]; board?: [number, number][] }[]>;

export interface Data {
  core: CorePack;
  kings: Kings | null;
}

export interface State {
  /** One range's board (0–10), or null for every range's king. */
  stars: number | null;
  /** The range asked for in the address, even when the data has no boards to show it. */
  asked: number | null;
  source: Source;
}

const SOURCE_KEYS: Source[] = ['catch', 'converts'];
export const sourceNames = (ctx: Ctx): [Source, string][] => [['catch', ctx.t('Catch maps')], ['converts', ctx.t('Converts')]];
const mapsName = (ctx: Ctx, source: Source) => (source === 'catch' ? ctx.t('catch maps') : ctx.t('converts'));
export const starLabel = (ctx: Ctx, stars: number) => `${ctx.fmt.num(stars)}${stars === 10 ? '+' : ''}★`;
export const rangeText = (ctx: Ctx, stars: number) => (stars === 10 ? ctx.t('from {from}★ up', { from: ctx.fmt.num(10, 2) })
  : ctx.t('from {from}★ to below {to}★', { from: ctx.fmt.num(stars, 2), to: ctx.fmt.num(stars + 1, 2) }));
/** A range's board link; catch is the default source, so it stays out of the address (as writeQuery leaves it). */
export const boardHref = (stars: number | string, source: string) => `/rankings/kings?stars=${stars}${source === 'catch' ? '' : `&src=${source}`}`;

/** What a kings view shows, kept on its element so the next render can tell an in-page move from a new visit. */
export const viewKey = (stars: number | null, source: Source) => (stars === null ? 'all' : `${stars}:${source}`);

const hasBoards = (kings: Kings | null) => Boolean(kings && Object.values(kings).some(rows => rows.some(r => r.board)));

export function readState(kings: Kings | null, query: Record<string, string | undefined>): State {
  const asked = /^(?:[0-9]|10)$/.test(query.stars ?? '') ? Number(query.stars) : null;
  return { stars: hasBoards(kings) ? asked : null, asked, source: SOURCE_KEYS.includes(query.src as Source) ? query.src as Source : 'catch' };
}

/** Two comparable boards; only the holders of each title appear, including joint kings. */
function kingsBoards(ctx: Ctx, core: CorePack, kings: Kings | null): Safe {
  const { t, fmt } = ctx;
  if (!kings) return empty(t('The star kings arrive with the next data update.'));
  return html`
    <p class="muted kings-note">${t('Ranges use nomod catch stars: 6★ means 6.00★ to below 7.00★; 10+★ includes everything from 10.00★ up. Ranked, loved and unranked maps count. Tied totals share the title.')}</p>
    <div class="grid grid-2 kings-boards">${sourceNames(ctx).map(([source, title]) => html`
      <section aria-labelledby="kings-${source}">
        <div class="section-head"><h2 id="kings-${source}">${title}</h2></div>
        ${kings[source].length ? html`<div class="table-wrap" data-label="${t('{title}: kings by star rating', { title })}"><table class="kings-table">
          <thead><tr><th scope="col">${t('Title')}</th><th scope="col">${t('Player')}</th><th scope="col" class="num">${t('#1s in PT')}</th></tr></thead>
          <tbody>${kings[source].map(({ stars, count, players, board }) => html`<tr class="${ctx.me !== null && players.includes(ctx.me) ? 'me' : ''}">
            <th scope="row"><span class="king-title">${t('King of {stars}', { stars: starLabel(ctx, stars) })}</span>
              ${players.length > 1 ? html`<span class="king-tie">${t('Shared title')}</span>` : ''}
              ${board ? html`<a class="king-link" href="${boardHref(stars, source)}">${t('Full board')}<span class="sr-only"> ${t('of {stars} {maps}', { stars: starLabel(ctx, stars), maps: mapsName(ctx, source) })}</span></a>` : ''}</th>
            <td><div class="king-players">${players.map(id => playerLinkId(ctx, core.players, id, 'avatar-sm'))}</div></td>
            <td class="num king-count">${fmt.num(count)}${players.length > 1 ? html`<span class="king-tie">${t('each')}</span>` : ''}</td>
          </tr>`)}</tbody>
        </table></div>` : empty(t('No {maps} with a known catch star rating have a PT #1 yet.', { maps: mapsName(ctx, source) }))}
      </section>`)}</div>
  `;
}

/** One range's board as listed: everyone with a #1 there, most first. */
export const boardOf = (kings: Kings, stars: number, source: Source) => kings[source].find(r => r.stars === stars)?.board ?? [];

/** One range's full board, with tied counts sharing a rank. */
export function boardTable(ctx: Ctx, core: CorePack, kings: Kings, stars: number, source: Source): Safe {
  const { t, fmt } = ctx;
  const board = boardOf(kings, stars, source);
  if (!board.length) return empty(t('Nobody in PT holds a #1 on {maps} {range} yet.', { maps: mapsName(ctx, source), range: rangeText(ctx, stars) }));
  const ranks = sharedRanks(board.map(([, n]) => n));
  const label = t('{stars} {maps}: #1s in PT', { stars: starLabel(ctx, stars), maps: mapsName(ctx, source) });
  return dataTable(label, [col('#'), col(t('Player')), col(t('#1s in PT'), 'num')], board.map(([id, n], i) => {
    const row = rowOf(core.players, id);
    const label = row < 0 ? '' : statusTag(ctx, core.players, row);
    const cls = [id === ctx.me ? 'me' : '', row >= 0 && isInactive(ctx, core.players, row) ? 'inactive' : ''].filter(Boolean).join(' ');
    return html`<tr${cls ? html` class="${cls}"` : ''}>
        <td class="rank ${ranks[i] === 1 ? 'king-rank' : ''}">${ranks[i]}</td>
        <td class="cell-player">${playerLinkId(ctx, core.players, id)}${label ? html` ${label}` : ''}</td>
        <td class="num king-count">${fmt.num(n)}</td>
      </tr>`;
  }));
}

/** The count line over a range's board. */
export function boardCount(ctx: Ctx, kings: Kings, stars: number, source: Source): string {
  const board = boardOf(kings, stars, source);
  return board.length
    ? ctx.t('{players} with a #1 on {maps} {range}', { players: ctx.fmt.plural(board.length, 'player'), maps: mapsName(ctx, source), range: rangeText(ctx, stars) })
    : '';
}

/** The tab's title: one range's board names it. */
export const title = (ctx: Ctx, state: State) => (state.stars === null ? ctx.t('Star kings leaderboard')
  : ctx.t('{stars} {maps} · Star kings', { stars: starLabel(ctx, state.stars), maps: mapsName(ctx, state.source) }));

export function render(ctx: Ctx, { core, kings }: Data, state: State): Safe {
  const { t } = ctx;
  if (state.stars === null || !kings) {
    return html`${head(ctx, 'kings')}
      <p class="muted">${t('The players holding the most #1s in PT in each star range.')}</p>
      ${state.asked !== null ? html`<p class="muted small">${t('The full board for each star range arrives with the next data update.')}</p>` : ''}
      <div data-kings="all">${kingsBoards(ctx, core, kings)}</div>`;
  }
  // The ranges with a board in either source (and the one asked for), so switching source keeps the range.
  const ranges = [...new Set([...Object.values(kings).flatMap(rows => rows.map(r => r.stars)), state.stars])].sort((a, b) => a - b);
  return html`${head(ctx, 'kings')}
    <p class="muted">${t('Everyone holding a #1 in PT in one star range, most first. Ties share a rank.')}</p>
    <div class="toolbar kings-toolbar" data-kings="${viewKey(state.stars, state.source)}">
      <select class="select" id="kings-stars" aria-label="${t('Star range')}">${ranges.map(s => html`<option value="${s}" ${s === state.stars ? raw('selected') : ''}>${starLabel(ctx, s)}</option>`)}</select>
      ${chipGroup(t('Maps'), 'src', sourceNames(ctx), state.source)}
    </div>
    <p class="result-count" id="kings-count">${boardCount(ctx, kings, state.stars, state.source)}</p>
    <div id="kings-board">${boardTable(ctx, core, kings, state.stars, state.source)}</div>
    <p class="mt-3 small"><a href="/rankings/kings">${t('All star kings')}</a></p>`;
}
