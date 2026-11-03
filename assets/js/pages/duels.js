// The Duels tab of Challenges (duels.json, tools/lib/duels.mjs): the duels being played as of the last update, the
// ladder, and the latest duels, each linking to its own page (pages/duel.js).

import { html } from '../core/html.js';
import { playerLink, empty, emptyFiltered, paginate, writeQuery, announce, resultCount, chipGroup, setPressed, avatar, nameClass } from '../core/ui.js';
import { matchUrl, provisionalTag, ratingText, recordText, streakText, streakWords, formatText, duelRow, duelist } from '../core/duels.js';
import * as fmt from '../core/fmt.js';
import { t, th } from '../core/i18n.js';

const LADDER_PAGE = 50;
const DUELS_PAGE = 20;
/** The recent duels' filter: [key, label, keeps]. */
const KINDS = [
  ['all', t('All|duels'), () => true],
  ['ranked', t('Ranked|duel'), d => d.ranked],
  ['unranked', t('Unranked|duel'), d => !d.ranked],
];

/** A duel in progress: both players and the points so far, its format, when it started and its lobby on osu!. */
function liveRow(d, index) {
  const [a, b] = d.players;
  const side = s => {
    const p = duelist(s, index);
    return html`<a class="player duel-side" href="/player/${s.u}">${avatar(s.u, 'avatar-sm')}<span class="duel-name ${nameClass(p)}">${p.name}</span></a>`;
  };
  return html`<div class="row duel-row duel-live">
    <span class="duel-line">${side(a)}<span class="duel-points">${fmt.num(a.pts)}<span class="duel-dash">–</span>${fmt.num(b.pts)}</span>${side(b)}</span>
    <span class="row-meta">
      <span>${formatText(d)}</span>
      ${d.start ? html`<span class="sep"></span><span class="faint" title="${fmt.dateTime(d.start)}">${t('started {ago}', { ago: fmt.ago(d.start) })}</span>` : ''}
      ${d.mp ? html`<span class="sep"></span><a href="${matchUrl(d.mp)}" target="_blank" rel="noopener">${t('Lobby on osu!')} ↗</a>` : ''}
    </span>
  </div>`;
}

/** The ladder: rated players by rating, then the provisional ones, unranked (on phones: rank, player, rating). */
function ladderTable(rows, index, me) {
  return html`<div class="table-wrap" data-label="${t('Duel ladder')}"><table class="table-compact duel-ladder">
    <thead><tr><th>#</th><th>${t('Player')}</th><th class="num">${t('Rating')}</th><th class="num col-opt">${t('Record|wins and losses')}</th>
      <th class="col-opt">${t('Streak')}</th><th class="num col-opt">${t('Peak')}</th><th class="num col-opt">${t('Last duel')}</th></tr></thead>
    <tbody>${rows.map(r => html`<tr class="${r.u === me ? 'me' : ''} ${r.prov ? 'duel-prov' : ''}">
      <td class="rank ${r.rank === 1 ? 'king-rank' : ''}">${r.rank ?? html`<span aria-label="${t('provisional')}">–</span>`}</td>
      <td class="cell-player">${playerLink(duelist(r, index), null, 'avatar-sm')}${r.prov ? html` ${provisionalTag()}` : ''}
        <span class="cell-sub">${t('{wins}, {losses}', { wins: fmt.plural(r.w, 'win'), losses: fmt.plural(r.l, 'loss', 'losses') })}${r.streak ? ` · ${streakWords(r.streak)}` : ''}</span></td>
      <td class="num duel-rating">${ratingText(r.r, r.rd)}</td>
      <td class="num col-opt">${recordText(r.w, r.l)}</td>
      <td class="col-opt">${streakText(r.streak)}</td>
      <td class="num col-opt">${fmt.num(r.peak)}</td>
      <td class="num faint col-opt">${r.last ? html`<span title="${fmt.dateTime(r.last)}">${fmt.ago(r.last)}</span>` : '—'}</td>
    </tr>`)}</tbody>
  </table></div>`;
}

/**
 * The tab's panel, which Challenges only shows once the export has duels.json. `generatedAt` is when the data was
 * made, which is as live as the live duels are. ?duels=ranked filters the latest duels; ?page= pages them.
 */
export function renderDuels(root, { duels, index, me, query, generatedAt }) {
  const { ladder, live, recent, total } = duels;
  let kind = KINDS.some(([k]) => k === query.duels) ? query.duels : 'all';
  let page = Math.max(0, (Number(query.page) || 1) - 1);
  const save = () => writeQuery({ duels: kind, page: page + 1 }, { duels: 'all', page: 1 });

  root.innerHTML = String(html`
    ${live.length ? html`<section class="section">
      <div class="section-head"><h2>${t('Being played now')}</h2><span class="muted small">${t('As of the last data update, {ago}', { ago: fmt.ago(generatedAt) })}</span></div>
      <div class="rows">${live.map(d => liveRow(d, index))}</div>
    </section>` : ''}
    <section class="section">
      <div class="section-head"><h2>${t('Ladder')}</h2>${ladder.length ? html`<span class="muted small">${t('Glicko-2 ratings from ranked duels. New players start at 1,500.')}</span>` : ''}</div>
      ${ladder.length ? html`<div id="duel-ladder"></div>` : empty(th('No ranked duels yet. Type {command} on the Discord to start one.', { command: html`<code>/duel</code>` }))}
    </section>
    <section class="section">
      <div class="section-head"><h2>${t('Latest duels')}</h2></div>
      ${recent.length ? html`
        <div class="toolbar" id="duel-kinds">${chipGroup(t('Show'), 'duels', KINDS.map(([k, label]) => [k, label]), kind)}</div>
        <p class="result-count" id="duel-count"></p>
        <div id="duel-list"></div>
        ${total > recent.length ? html`<p class="small muted">${t('The latest {n} of {total} duels.', { n: fmt.num(recent.length), total: fmt.num(total) })}</p>` : ''}`
      : empty(t('No duels played yet.'))}
    </section>`);

  if (ladder.length) paginate(root.querySelector('#duel-ladder'), ladder, slice => ladderTable(slice, index, me), LADDER_PAGE);
  if (!recent.length) return;

  const count = root.querySelector('#duel-count');
  const shown = () => recent.filter(KINDS.find(([k]) => k === kind)[2]);
  let items = shown();
  const redraw = paginate(root.querySelector('#duel-list'), items, slice => html`<div class="rows">${slice.map(d => duelRow(d, index, me))}</div>`, DUELS_PAGE, {
    page,
    onPage: p => { page = p; save(); },
    empty: () => emptyFiltered(t('No duels of this kind yet.')),
  });
  const showCount = speak => {
    count.textContent = resultCount(items.length, recent.length, 'duel');
    if (speak) announce(count.textContent);
  };
  showCount(false);
  const refilter = () => {
    items = shown();
    setPressed(root.querySelector('#duel-kinds'), 'duels', kind);
    redraw(items);
    showCount(true);
  };
  root.querySelector('#duel-kinds').addEventListener('click', e => {
    const chip = e.target.closest('[data-duels]');
    if (chip) { kind = chip.dataset.duels; refilter(); }
  });
  root.querySelector('#duel-list').addEventListener('click', e => {
    if (e.target.closest('[data-clear]')) { kind = 'all'; refilter(); }
  });
}
