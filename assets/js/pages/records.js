import { html } from '../core/html.js';
import { records, playerIndex } from '../core/data.js';
import { S, M } from '../core/model.js';
import { barChart } from '../core/charts.js';
import { setTitle, playerLink, mapLink, scoreStats, ppText, catChip, stat, CAT_LABEL, avatar, posBadge } from '../core/ui.js';
import { FIRST_10K } from '../core/lore.js';
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
  // Most #1s across all three categories, from the player list (the records file has them per category only).
  const mostFirsts = [...index.values()].map(p => [p.id, p.firsts.c + p.firsts.u + p.firsts.r]).filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5);
  const jumps = [['legendary', 'Legendary plays'], r.throne && ['throne', 'Dethrone Tris'], r.oneMiss && ['choke', 'Choke d’Or'],
    r.wysi?.length && ['wysi', 'WYSI'], ['first10k', 'First 10k'], ['collectors', 'Collectors'], ['when', 'When we play']].filter(Boolean);

  root.innerHTML = String(html`
    <header class="page-head">
      <h1>Records</h1>
      <p class="page-tag">The Portuguese catch record book</p>
      <p>The biggest marks across every score the bot keeps: each player’s best play on each map.</p>
    </header>

    <nav class="jump-links" aria-label="On this page">${jumps.map(([id, label]) => html`<a class="chip" href="#/records?at=${id}">${label}</a>`)}</nav>

    <div class="stats">
      ${stat('Scores', fmt.num(r.totals.scores))}
      ${stat('Different maps', fmt.num(r.totals.maps))}
      ${stat('SS', fmt.num(r.totals.ss))}
    </div>

    <section class="section" id="legendary">
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

    <section class="section" id="first10k">
      <h2>First past 10,000 pp</h2>
      <p class="muted">The first Portuguese players to break 10k, and the play that took them there.</p>
      <div class="rows">${FIRST_10K.map(([day, name, uid, play], i) => html`<div class="row">
        <div class="score-line">${posBadge(i + 1)} ${uid && index.get(uid) ? playerLink(uid, index, 'avatar-sm') : html`<b>${name}</b>`} <span class="muted">${play}</span></div>
        <div class="row-meta"><span class="faint">${fmt.date(Date.parse(`${day}T12:00:00Z`) / 1000)}</span></div>
      </div>`)}</div>
    </section>

    <section class="section" id="collectors">
      <h2>The collectors</h2>
      <p class="muted">Each category’s own #1 count is on the leaderboards.</p>
      <div class="grid grid-2">
        ${leaders('Most #1s', mostFirsts, index)}
        ${r.wall?.length ? leaders('The biggest walls (#1s standing 2+ years)', r.wall, index) : ''}
        ${leaders('Most SSs', r.mostSS, index)}
        ${leaders('Most full combos', r.mostFC, index)}
      </div>
    </section>

    <section class="section card" id="when">
      <h2 class="card-h">When does Portugal play?</h2>
      ${barChart(hours, { every: 3 })}
      <p class="small muted" style="margin:8px 0 0">Lisbon time when each score was set. Peak time is between ${peak}h and ${peak + 1}h.</p>
    </section>
  `);
  if (query.at) root.querySelector(`#${CSS.escape(query.at)}`)?.scrollIntoView({ block: 'start' });
}
