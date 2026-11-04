// The Duels tab of Challenges (/challenges/duels), as assets/js/pages/duels.js draws it from duels.json
// (tools/lib/duels.mjs): the duels being played as of the last update, the ladder (50 to a page), and the latest duels
// (20 to a page), each linking to its own page (views/duel.ts). ?duels=ranked filters the latest duels; ?page= pages
// them. Challenges only shows the tab once the export has duels.json. Players come from the core pack. render() is
// pure; duels.mount.ts handles the pages and the filter.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { chipGroup, empty, emptyFiltered, paged, resultCount } from '../ui/page.ts';
import type { Players } from '../ui/players.ts';
import {
  duelRow, duelistAvatar, duelistClass, duelistLink, duelistName, experimentalNote, formatText, matchUrl, provisionalTag, ratingText,
  recordText, recordWords, streakText, streakWords, type Duel, type DuelsFile, type LadderRow, type LiveDuel,
} from '../ui/duels.ts';

export const LADDER_PAGE = 50;
export const DUELS_PAGE = 20;

export type Kind = 'all' | 'ranked' | 'unranked';

export interface State {
  /** The latest duels' filter. */
  kind: Kind;
  /** The page of the latest duels, from 0. */
  page: number;
}

/** The latest duels' filter: [key, label, keeps]. */
const kinds = ({ t }: Ctx): [Kind, string, (d: Duel) => boolean][] => [
  ['all', t('All|duels'), () => true],
  ['ranked', t('Ranked|duel'), d => d.ranked],
  ['unranked', t('Unranked|duel'), d => !d.ranked],
];

/** The filter and page from the address; anything unknown is the default. */
export const readState = (query: Record<string, string | undefined>): State => ({
  kind: query.duels === 'ranked' || query.duels === 'unranked' ? query.duels : 'all',
  page: Math.max(0, (Number(query.page) || 1) - 1),
});

/** The tab's line under the tab strip. */
export const intro = ({ th }: Ctx): Safe =>
  th('Rated 1v1s on random maps of the right difficulty, played in an osu! lobby. Type {command} on the Discord to challenge someone: the bot follows the lobby and scores every round.', { command: html`<code>/duel</code>` });

/** The latest duels the filter keeps. */
export const shownDuels = (ctx: Ctx, duels: DuelsFile, kind: Kind): Duel[] =>
  duels.recent.filter(kinds(ctx).find(([k]) => k === kind)![2]);

/** A page of the latest duels. */
export const duelRows = (ctx: Ctx, players: Players, slice: readonly Duel[]): Safe =>
  html`<div class="rows">${slice.map(d => duelRow(ctx, d, players))}</div>`;

/** What to say when the filter keeps none, with the way back. */
export const noneOfKind = (ctx: Ctx): Safe => emptyFiltered(ctx, ctx.t('No duels of this kind yet.'));

/** "12 of 100 duels": the latest duels the filter keeps. */
export const countText = (ctx: Ctx, duels: DuelsFile, items: readonly Duel[]): string => resultCount(ctx, items.length, duels.recent.length, 'duel');

/** A duel in progress: both players and the points so far, its format, when it started and its lobby on osu!. */
function liveRow(ctx: Ctx, d: LiveDuel, players: Players): Safe {
  const { t, fmt } = ctx;
  const [a, b] = d.players;
  const side = (s: LiveDuel['players'][number]) =>
    html`<a class="player duel-side" href="/player/${s.u}">${duelistAvatar(ctx, players, s.u, 'avatar-sm')}<span class="duel-name ${duelistClass(ctx, players, s.u)}">${duelistName(players, s)}</span></a>`;
  return html`<div class="row duel-row duel-live">
    <span class="duel-line">${side(a)}<span class="duel-points">${fmt.num(a.pts)}<span class="duel-dash">–</span>${fmt.num(b.pts)}</span>${side(b)}</span>
    <span class="row-meta">
      <span>${formatText(ctx, d)}</span>
      ${d.start ? html`<span class="sep"></span><span class="faint" title="${fmt.dateTime(d.start)}">${t('started {ago}', { ago: fmt.ago(d.start) })}</span>` : ''}
      ${d.mp ? html`<span class="sep"></span><a href="${matchUrl(d.mp)}" target="_blank" rel="noopener">${t('Lobby on osu!')} ↗</a>` : ''}
    </span>
  </div>`;
}

/** The ladder: rated players by rating, then the provisional ones, unranked (on phones: rank, player, rating). */
export function ladderTable(ctx: Ctx, rows: readonly LadderRow[], players: Players): Safe {
  const { t, fmt } = ctx;
  return html`<div class="table-wrap" data-label="${t('Duel ladder')}"><table class="table-compact duel-ladder">
    <thead><tr><th>#</th><th>${t('Player')}</th><th class="num">${t('Rating')}</th><th class="num col-opt">${t('Record|wins and losses')}</th>
      <th class="col-opt">${t('Streak')}</th><th class="num col-opt">${t('Peak')}</th><th class="num col-opt">${t('Last duel')}</th></tr></thead>
    <tbody>${rows.map(r => html`<tr class="${r.u === ctx.me ? 'me' : ''} ${r.prov ? 'duel-prov' : ''}">
      <td class="rank ${r.rank === 1 ? 'king-rank' : ''}">${r.rank ?? html`<span aria-label="${t('provisional')}">–</span>`}</td>
      <td class="cell-player">${duelistLink(ctx, players, r, 'avatar-sm')}${r.prov ? html` ${provisionalTag(ctx)}` : ''}
        <span class="cell-sub">${recordWords(ctx, r.w, r.l)}${r.streak ? ` · ${streakWords(ctx, r.streak)}` : ''}</span></td>
      <td class="num duel-rating">${ratingText(ctx, r.r, r.rd)}</td>
      <td class="num col-opt">${recordText(ctx, r.w, r.l)}</td>
      <td class="col-opt">${streakText(ctx, r.streak)}</td>
      <td class="num col-opt">${fmt.num(r.peak)}</td>
      <td class="num faint col-opt">${r.last ? html`<span title="${fmt.dateTime(r.last)}">${fmt.ago(r.last)}</span>` : '—'}</td>
    </tr>`)}</tbody>
  </table></div>`;
}

/** The ladder's first page. */
export const ladderPage = (ctx: Ctx, duels: DuelsFile, players: Players): Safe =>
  paged(ctx, duels.ladder, slice => ladderTable(ctx, slice, players), { size: LADDER_PAGE });

/** The tab's panel. `generatedAt` is when the data was made, which is as live as the live duels are. */
export function render(ctx: Ctx, duels: DuelsFile, players: Players, generatedAt: number, state: State): Safe {
  const { t, th, fmt } = ctx;
  const { ladder, live, recent, total } = duels;
  const items = shownDuels(ctx, duels, state.kind);
  return html`
    ${experimentalNote(ctx)}
    ${live.length ? html`<section class="section">
      <div class="section-head"><h2>${t('Being played now')}</h2><span class="muted small">${t('As of the last data update, {ago}', { ago: fmt.ago(generatedAt) })}</span></div>
      <div class="rows">${live.map(d => liveRow(ctx, d, players))}</div>
    </section>` : ''}
    <section class="section">
      <div class="section-head"><h2>${t('Ladder')}</h2>${ladder.length ? html`<span class="muted small">${t('Glicko-2 ratings from ranked duels. New players start at 1,500.')}</span>` : ''}</div>
      ${ladder.length ? html`<div id="duel-ladder">${ladderPage(ctx, duels, players)}</div>` : empty(th('No ranked duels yet. Type {command} on the Discord to start one.', { command: html`<code>/duel</code>` }))}
    </section>
    <section class="section">
      <div class="section-head"><h2>${t('Latest duels')}</h2></div>
      ${recent.length ? html`
        <div class="toolbar" id="duel-kinds">${chipGroup(t('Show'), 'duels', kinds(ctx).map(([k, label]) => [k, label]), state.kind)}</div>
        <p class="result-count" id="duel-count">${countText(ctx, duels, items)}</p>
        <div id="duel-list">${paged(ctx, items, slice => duelRows(ctx, players, slice), { size: DUELS_PAGE, page: state.page, empty: () => noneOfKind(ctx) })}</div>
        ${total > recent.length ? html`<p class="small muted">${t('The latest {n} of {total} duels.', { n: fmt.num(recent.length), total: fmt.num(total) })}</p>` : ''}`
      : empty(t('No duels played yet.'))}
    </section>`;
}
