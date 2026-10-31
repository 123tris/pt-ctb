// The King of the hill tab of Leaderboards (hill.json, tools/lib/hill.mjs): this month's pool and who holds each
// crown, the crown table (all time or one season) and the past months.

import { html, raw } from '../core/html.js';
import { HILL_SLOTS, HILL_TIERS, sharedRanks } from '../core/model.js';
import { playerLink, mapLink, modsBadges, empty, announce, writeQuery, isInactive, statusTag } from '../core/ui.js';
import { SLOT_NAME, TIER_NAME, monthLabel, seasonLabel, titleName, slotTally } from '../core/hill.js';
import * as fmt from '../core/fmt.js';
import { t, th } from '../core/i18n.js';

/** A player in the hill's lists: their site entry, or the name the bot gave for someone the site doesn't list. */
const who = (id, name, index) => index.get(id) ?? { id, name: name || `#${id}` };
const names = (ids, index) => html`${ids.map((id, i) => html`${i ? ', ' : ''}${playerLink(who(id, '', index), null, 'avatar-sm')}`)}`;

/** "5d left" / "7h left" / "ended", as Challenges counts down the week. */
function timeLeft(end) {
  const left = end - Date.now() / 1000;
  if (left <= 0) return t('ended');
  return left >= 86400 ? t('{n}d left', { n: Math.floor(left / 86400) }) : t('{n}h left', { n: Math.max(1, Math.floor(left / 3600)) });
}

/**
 * One slot of a pool as a row: the slot, its map, who holds (or kept) the crown, and the play: mods, accuracy, its hill
 * score (linked to the play on osu! when known) and when it was set. A closed month says "kept" and dates the play.
 */
function slotRow(s, maps, index, closed) {
  const h = s.holder;
  const score = h?.score !== undefined ? html`<span class="pp hill-score">${fmt.num(h.score)}</span>` : '';
  return html`<div class="row row-1col">
    <div class="row-main">
      <span class="hill-slot">${SLOT_NAME[s.slot]}</span>
      ${mapLink(s.map, maps[s.map])}
      <div>${h ? playerLink(who(h.u, h.name, index), null, 'avatar-sm') : html`<span class="muted small">${closed ? t('Nobody kept this crown') : t('Up for grabs')}</span>`}</div>
    </div>
    <div class="row-meta">
      ${score ? (h.url ? html`<a href="${h.url}" target="_blank" rel="noopener" title="${t('This play on osu!')}">${score}</a>` : score) : ''}
      ${h?.acc !== undefined ? html`<span>${fmt.acc(h.acc)}</span>` : ''}
      ${h?.mods ? modsBadges(h.mods) : ''}
      ${h?.time ? html`<span class="faint" title="${fmt.dateTime(h.time)}">${closed ? fmt.date(h.time) : fmt.ago(h.time)}</span>` : ''}
      <span class="faint">${t('{players} · {snipes}', { players: fmt.plural(s.players, 'player'), snipes: fmt.plural(s.snipes, 'snipe') })}</span>
    </div>
  </div>`;
}

/** A pool as two lists side by side, Open and Challenger (one under the other on phones). */
function poolGrid(pool, maps, index, { closed = false, level = 'h3' } = {}) {
  return html`<div class="grid grid-2 hill-pool">${HILL_TIERS.map(tier => {
    const slots = pool.filter(s => s.tier === tier);
    return html`<div>
      ${raw(`<${level} class="hill-tier">`)}${TIER_NAME[tier]}${raw(`</${level}>`)}
      ${slots.length ? html`<div class="rows">${slots.map(s => slotRow(s, maps, index, closed))}</div>` : empty(t('No maps in this tier.'))}
    </div>`;
  })}</div>`;
}

/** This month: its pool and who holds what, or a word on why there's none to show. */
function currentSection(current, maps, index) {
  if (!current) return html`<section class="section"><div class="section-head"><h2>${t('This month')}</h2></div>
    ${empty(t('The next pool appears here when the month starts.'))}</section>`;
  const ended = current.end <= Date.now() / 1000;
  const when = ended
    ? t('Ended {date}. The crowns are settled at the bot’s next update.', { date: fmt.date(current.end - 1) })
    : t('Ends {date} · {left}', { date: fmt.date(current.end - 1), left: timeLeft(current.end) });
  const { leaders } = current;
  return html`<section class="section">
    <div class="section-head"><h2>${monthLabel(current.month)}</h2>${current.status === 'draft' ? '' : html`<span class="muted small">${when}</span>`}</div>
    ${current.status === 'draft' ? empty(t('This month’s pool is being picked. It shows here once a moderator approves it.')) : html`
      ${leaders ? html`<p class="hill-leaders">${th('Holding the most crowns right now: {players} with {crowns}', {
        players: names(leaders.players, index),
        crowns: leaders.players.length > 1 ? t('{crowns} each', { crowns: fmt.plural(leaders.held, 'crown') }) : fmt.plural(leaders.held, 'crown'),
      })}</p>` : ''}
      ${poolGrid(current.pool, maps, index)}`}
  </section>`;
}

/** The crown table's rows for a scope ('all' or a season id): [id, name, crowns, per slot], most first. */
function tableRows(players, scope) {
  if (scope === 'all') return players.map(([id, name, total, slots]) => [id, name, total, slots]);
  return players.filter(p => p[4][scope]).map(([id, name, , , seasons]) => [id, name, seasons[scope].reduce((a, b) => a + b, 0), seasons[scope]])
    .sort((a, b) => b[2] - a[2] || a[0] - b[0]);
}

/** Who holds which title in a season: each slot's king(s) and the All-rounders. */
function seasonTitles(season, index) {
  const items = [
    ...HILL_SLOTS.filter(slot => season.kings[slot]).map(slot => [titleName({ kind: 'slot', slot }), season.kings[slot]]),
    ...(season.allRounders.length ? [[t('All-rounder'), season.allRounders]] : []),
  ];
  return html`<ul class="badge-list hill-titles">${items.map(([name, ids]) => html`<li><b>${name}</b><span>${names(ids, index)}</span></li>`)}</ul>`;
}

/** The crown table: everyone with a crown in the scope, most first, tied counts sharing a rank. A slot's king is gold. */
function crownTable(rows, season, index, me) {
  if (!rows.length) return empty(t('No crowns yet.'));
  const ranks = sharedRanks(rows.map(r => r[2]));
  return html`<div class="table-wrap" data-label="${t('Crown table')}"><table class="hill-table">
    <thead><tr><th>#</th><th>${t('Player')}</th><th class="num">${t('Crowns')}</th>${HILL_SLOTS.map(slot => html`<th class="num col-opt">${slot}</th>`)}</tr></thead>
    <tbody>${rows.map(([id, name, total, slots], i) => {
      const p = index.get(id);
      const tag = p ? statusTag(p) : '';
      return html`<tr class="${id === me ? 'me' : ''} ${p && isInactive(p) ? 'inactive' : ''}">
        <td class="rank ${ranks[i] === 1 ? 'king-rank' : ''}">${ranks[i]}</td>
        <td class="cell-player">${playerLink(who(id, name, index))}${tag ? html` ${tag}` : ''}<span class="cell-sub">${slotTally(slots)}</span></td>
        <td class="num king-count">${fmt.num(total)}</td>
        ${HILL_SLOTS.map((slot, k) => {
          const king = season?.kings[slot]?.includes(id);
          return html`<td class="num col-opt ${king ? 'hill-king' : ''}">${slots[k] ? fmt.num(slots[k]) : html`<span class="faint">—</span>`}${king ? html`<span class="sr-only"> (${titleName({ kind: 'slot', slot })})</span>` : ''}</td>`;
        })}
      </tr>`;
    })}</tbody>
  </table></div>`;
}

/** A closed month, folded: its King of the hill in the summary, the pool with who kept each crown inside. */
const pastMonth = (m, maps, index, open) => html`<details class="card history hill-month" ${open ? raw('open') : ''}>
  <summary><h3 class="card-h">${monthLabel(m.month)}</h3>
    <span class="muted small hill-month-king">${m.kings.length ? th('{title}: {players} · {crowns}', {
      title: t('King of the hill'), players: html`${m.kings.map((id, i) => html`${i ? ', ' : ''}${who(id, '', index).name}`)}`,
      crowns: fmt.plural(m.most, 'crown'),
    }) : t('No crowns given')}</span>
    <span class="history-toggle" aria-hidden="true"></span></summary>
  <div class="history-body">${poolGrid(m.pool, maps, index, { closed: true, level: 'h4' })}</div>
</details>`;

/**
 * The tab, which Leaderboards only shows when the export has hill.json. `head` is the page head and tabs, `intro` the
 * line under them. ?season=2026-Q4 opens the crown table on that season.
 */
export function hillPage(root, { hill, index, me, query, head, intro }) {
  const { current, months, seasons, players, maps } = hill;
  const scopes = [['all', t('All time')], ...seasons.map(s => [s.id, s.final ? seasonLabel(s.id) : t('{season}, so far', { season: seasonLabel(s.id) })])];
  let scope = scopes.some(([id]) => id === query.season) ? query.season : 'all';

  root.innerHTML = String(html`${head}
    <p class="muted hill-intro">${intro}</p>
    ${currentSection(current, maps, index)}
    <section class="section">
      <div class="section-head"><h2>${t('Crown table')}</h2><span class="muted small">${t('A crown is kept by whoever holds the slot when its month ends.')}</span></div>
      ${scopes.length > 1 ? html`<div class="toolbar"><select class="select" id="hill-scope" aria-label="${t('Crowns from')}">
        ${scopes.map(([id, label]) => html`<option value="${id}" ${id === scope ? raw('selected') : ''}>${label}</option>`)}</select></div>` : ''}
      <div id="hill-titles"></div>
      <p class="result-count" id="hill-count"></p>
      <div id="hill-table"></div>
    </section>
    ${months.length ? html`<section class="section">
      <div class="section-head"><h2>${t('Past months')}</h2></div>
      <div class="hill-months">${months.map((m, i) => pastMonth(m, maps, index, i === 0))}</div>
    </section>` : ''}`);

  const titlesEl = root.querySelector('#hill-titles');
  const tableEl = root.querySelector('#hill-table');
  const count = root.querySelector('#hill-count');
  const draw = ({ speak = false } = {}) => {
    const season = seasons.find(s => s.id === scope) ?? null;
    const rows = tableRows(players, scope);
    titlesEl.innerHTML = String(season ? seasonTitles(season, index) : '');
    tableEl.innerHTML = String(crownTable(rows, season, index, me));
    count.textContent = rows.length ? t('{players} with a crown', { players: fmt.plural(rows.length, 'player') }) : '';
    writeQuery({ season: scope }, { season: 'all' });
    if (speak) announce(count.textContent || t('No crowns yet.'));
  };
  draw();
  root.querySelector('#hill-scope')?.addEventListener('change', e => { scope = e.target.value; draw({ speak: true }); });
}
