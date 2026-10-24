import { html } from '../core/html.js';
import { records, playerIndex } from '../core/data.js';
import { S, M } from '../core/model.js';
import { barChart } from '../core/charts.js';
import { setTitle, playerLink, mapLink, scoreStats, ppText, catChip, stat, CAT_LABEL, avatar } from '../core/ui.js';
import * as fmt from '../core/fmt.js';

/** A record that is one play: [userId, category, ...score]. */
function playRecord(title, row, maps, index, highlight) {
  if (!row) return '';
  const [uid, cat, ...s] = row;
  return html`<div class="card">
    <h3>${title}</h3>
    <div class="stat-value" style="margin-bottom:8px">${highlight(s, maps[s[S.MAP]])}</div>
    <div style="margin-bottom:10px">${mapLink(s[S.MAP], maps[s[S.MAP]])}</div>
    <div class="score-line">${playerLink(uid, index, 'avatar-sm')} ${catChip(cat)} ${scoreStats(s)} ${ppText(s[S.PP])}</div>
  </div>`;
}

/** A top-5 list: [[userId, value]]. */
function leaders(title, rows, index, unit) {
  return html`<div class="card">
    <h3>${title}</h3>
    <div class="mini-board">${rows.map(([uid, value], i) => html`<a class="line" href="#/player/${uid}">
      <span class="n">${i + 1}</span>
      <span class="player">${avatar(uid, 'avatar-sm')}<span>${index.get(uid)?.name ?? uid}</span></span>
      <span class="pp">${fmt.num(value)}${unit ? html`<small>${unit}</small>` : ''}</span>
    </a>`)}</div>
  </div>`;
}

export default async function recordsPage(root, { isCurrent }) {
  const [r, index] = await Promise.all([records(), playerIndex()]);
  if (!isCurrent()) return;
  setTitle('Records');
  const maps = r.maps;
  const hours = r.byHour.map((value, hour) => ({ label: `${hour}h`, value, title: `${hour}h–${hour + 1}h: ${fmt.num(value)} plays` }));
  const peak = r.byHour.indexOf(Math.max(...r.byHour));
  const totalMods = r.mods.reduce((sum, [, n]) => sum + n, 0);

  root.innerHTML = String(html`
    <header class="page-head">
      <span class="eyebrow">Records</span>
      <h1>The Portuguese catch record book</h1>
      <p>The biggest marks across every score the bot keeps: each player’s best play on each map.</p>
    </header>

    <div class="stats">
      ${stat('Scores', fmt.num(r.totals.scores))}
      ${stat('Different maps', fmt.num(r.totals.maps))}
      ${stat('SS', fmt.num(r.totals.ss))}
      ${stat('Fruits caught', fmt.num(r.totals.fruits))}
    </div>

    <section class="section">
      <h2>Legendary plays</h2>
      <div class="grid grid-3">
        ${['c', 'u', 'r'].map(cat => playRecord(`Most pp in ${CAT_LABEL[cat]}`, r.topPlay[cat], maps, index, s => html`${fmt.pp(s[S.PP])} pp`))}
        ${playRecord('Highest combo', r.topCombo, maps, index, s => `${fmt.num(s[S.COMBO])}x`)}
        ${playRecord('Longest map passed', r.longest, maps, index, (s, meta) => (meta ? fmt.duration(meta[M.LENGTH]) : '—'))}
        ${playRecord('Oldest #1', r.oldestFirst, maps, index, s => `since ${fmt.date(s[S.TIME])}`)}
        ${['c', 'u', 'r'].map(cat => playRecord(`Hardest map (${CAT_LABEL[cat]})`, r.hardest[cat], maps, index, (s, meta) => (meta ? `★ ${fmt.num(meta[M.STARS], 2)}` : '—')))}
      </div>
      <p class="small faint" style="margin-top:10px">Plays with EZ or HT don’t count for the hardest and longest maps.</p>
    </section>

    <section class="section">
      <h2>The collectors</h2>
      <div class="grid grid-3">
        ${leaders('Most #1s in Converts', r.mostFirsts.c, index)}
        ${leaders('Most #1s in Loved', r.mostFirsts.u, index)}
        ${leaders('Most #1s in Ranked', r.mostFirsts.r, index)}
        ${leaders('Most scores', r.mostScores, index)}
        ${leaders('Most SSs', r.mostSS, index)}
        ${leaders('Most full combos', r.mostFC, index)}
        ${leaders('Most fruits caught', r.mostFruits, index)}
      </div>
    </section>

    <section class="section grid grid-2">
      <div class="card">
        <h3>When does Portugal play?</h3>
        ${barChart(hours, { every: 3 })}
        <p class="small muted" style="margin:8px 0 0">Lisbon time when each score was set. Peak time is between ${peak}h and ${peak + 1}h.</p>
      </div>
      <div class="card">
        <h3>Scores per year</h3>
        ${barChart(r.perYear.map(([year, n]) => ({ label: String(year).slice(2), value: n, title: `${year}: ${fmt.num(n)} scores` })), { color: 'var(--cat-c)' })}
        <p class="small muted" style="margin:8px 0 0">The year each stored score was set (better scores replace older ones).</p>
      </div>
    </section>

    <section class="section grid grid-2">
      <div class="card">
        <h3>Most used mods</h3>
        <div class="hbars">${r.mods.map(([mods, n]) => html`<div class="hbar">
          <span>${mods}</span><span class="track"><span class="fill" style="display:block;width:${(n / r.mods[0][1]) * 100}%"></span></span>
          <span class="val">${fmt.num((n / totalMods) * 100, 1)}%</span>
        </div>`)}</div>
      </div>
      <div class="card">
        <h3>Most played maps in Portugal</h3>
        <div class="rows">${r.popularMaps.map(([id, cat, n]) => html`<div class="row">
          <div>${mapLink(id, maps[id])}</div>
          <div class="row-meta">${catChip(cat)} ${fmt.plural(n, 'player')}</div>
        </div>`)}</div>
      </div>
    </section>
  `);
}
