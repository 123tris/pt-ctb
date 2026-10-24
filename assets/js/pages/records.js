import { html } from '../core/html.js';
import { records, playerIndex } from '../core/data.js';
import { S, M } from '../core/model.js';
import { barChart } from '../core/charts.js';
import { setTitle, playerLink, mapLink, scoreStats, ppText, catChip, stat, CAT_LABEL, avatar, posBadge } from '../core/ui.js';
import { FIRST_10K, mapLore } from '../core/lore.js';
import * as fmt from '../core/fmt.js';

/** Tris's #1s that still stand, and who's closest to taking them. */
function throneSection(t, maps, index) {
  const boss = index.get(t.u);
  if (!boss) return '';
  return html`<section class="section" id="throne">
    <div class="section-head"><h2>Dethrone ${boss.name}</h2><a href="#/player/${t.u}">${boss.name}’s profile →</a></div>
    <div class="throne-head card">
      ${avatar(t.u, 'avatar-lg')}
      <div>
        <div class="stat-value">${fmt.num(t.held)} #1s</div>
        <p class="muted" style="margin:4px 0 0">${boss.name} still holds ${fmt.num(t.held)} Portuguese #1s, ${fmt.num(t.contested)} of them on maps someone else has played too. He keeps asking to be sniped. Go on.</p>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div>
        <h3 class="small muted">His oldest #1s still standing</h3>
        <div class="rows">${t.oldest.map(([cat, runner, ...s]) => html`<div class="row" style="grid-template-columns:1fr">
          ${mapLink(s[S.MAP], maps[s[S.MAP]])}
          <div class="row-meta" style="justify-content:flex-start">${catChip(cat)} <span class="faint">#1 since ${fmt.date(s[S.TIME])}</span><span class="sep"></span>
            <span class="faint">next in line:</span> ${playerLink(runner, index, 'avatar-sm')}</div>
        </div>`)}</div>
      </div>
      <div class="card">
        <h3>Closest challengers</h3>
        <p class="small muted">Who sits at #2, right behind ${boss.name}, on the most maps.</p>
        <div class="mini-board">${t.challengers.map(([uid, n], i) => html`<a class="line" href="#/compare/${uid}/${t.u}">
          <span class="n">${i + 1}</span>
          <span class="player">${avatar(uid, 'avatar-sm')}<span>${index.get(uid)?.name ?? uid}</span></span>
          <span class="pp">${fmt.num(n)}<small>maps</small></span>
        </a>`)}</div>
      </div>
    </div>
  </section>`;
}

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

export default async function recordsPage(root, { query, isCurrent }) {
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

    ${r.throne ? throneSection(r.throne, maps, index) : ''}

    ${r.oneMiss ? html`<section class="section" id="choke">
      <h2>The Choke d’Or</h2>
      <p class="muted">Plays with exactly one miss: the community’s favourite subject. The 1-miss gods bless some players more than others.</p>
      <div class="grid grid-2">
        ${leaders('Most 1-miss plays', r.oneMiss, index)}
        ${playRecord('The highest choke', r.highestChoke, maps, index, s => html`${fmt.pp(s[S.PP])} pp, 1 miss`)}
      </div>
    </section>` : ''}

    ${r.wysi?.length ? html`<section class="section" id="wysi">
      <h2>WYSI hall</h2>
      <p class="muted">${fmt.plural(r.wysi.length, 'play')} ended on exactly 727 combo. When you see it…</p>
      <div class="rows">${r.wysi.slice(0, 12).map(([uid, cat, ...s]) => html`<div class="row">
        <div class="row-main">${mapLink(s[S.MAP], maps[s[S.MAP]])}<div>${playerLink(uid, index, 'avatar-sm')}</div></div>
        <div class="row-meta">${catChip(cat)} ${scoreStats(s)}</div>
      </div>`)}</div>
    </section>` : ''}

    <section class="section">
      <h2>First past 10,000 pp</h2>
      <p class="muted">The first Portuguese players to break 10k, and the play that took them there.</p>
      <div class="rows">${FIRST_10K.map(([day, name, uid, play], i) => html`<div class="row">
        <div class="score-line">${posBadge(i + 1)} ${uid && index.get(uid) ? playerLink(uid, index, 'avatar-sm') : html`<b>${name}</b>`} <span class="muted">${play}</span></div>
        <div class="row-meta"><span class="faint">${fmt.date(Date.parse(`${day}T12:00:00Z`) / 1000)}</span></div>
      </div>`)}</div>
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
        ${r.popularMaps[0] && mapLore(maps[r.popularMaps[0][0]]) ? html`<p class="small faint" style="margin:10px 0 0">${mapLore(maps[r.popularMaps[0][0]]).title}: ${fmt.plural(r.popularMaps[0][2], 'player')}, one dream.</p>` : ''}
      </div>
    </section>
  `);
  if (query.at) root.querySelector(`#${CSS.escape(query.at)}`)?.scrollIntoView({ block: 'start' });
}
