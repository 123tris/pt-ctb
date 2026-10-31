import { html } from '../core/html.js';
import { records, playerIndex } from '../core/data.js';
import { S, M } from '../core/model.js';
import { barChart } from '../core/charts.js';
import { setTitle, playerLink, mapLink, scoreStats, ppText, catChip, stat, CAT_LABEL, avatar, posBadge } from '../core/ui.js';
import { FIRST_10K } from '../core/lore.js';
import * as fmt from '../core/fmt.js';
import { t, tn } from '../core/i18n.js';

/** Tris's #1s that still stand, and who's closest to taking them. */
function throneSection(throne, maps, index) {
  const boss = index.get(throne.u);
  if (!boss) return '';
  return html`<section class="section" id="throne">
    <div class="section-head"><h2>${t('Dethrone {name}', { name: boss.name })}</h2><a href="#/player/${throne.u}">${t('{name}’s profile', { name: boss.name })}</a></div>
    <div class="throne-head card">
      ${avatar(throne.u, 'avatar-lg')}
      <div>
        <div class="stat-value">${t('{n} #1s', { n: fmt.num(throne.held) })}</div>
        <p class="m-0 mt-1 muted">${t('{name} still holds {held} Portuguese #1s, {contested} of them on maps someone else has played too. He keeps asking to be sniped. Go on.', { name: boss.name, held: fmt.num(throne.held), contested: fmt.num(throne.contested) })}</p>
      </div>
    </div>
    <div class="mt-4 grid grid-2">
      <div>
        <h3 class="small muted">${t('His oldest #1s still standing')}</h3>
        <div class="rows">${throne.oldest.map(([cat, runner, ...s]) => html`<div class="row-1col row">
          ${mapLink(s[S.MAP], maps[s[S.MAP]])}
          <div class="justify-start row-meta">${catChip(cat)} <span class="faint">${t('#1 since {date}', { date: fmt.date(s[S.TIME]) })}</span><span class="sep"></span>
            <span class="faint">${t('next in line:')}</span> ${playerLink(runner, index, 'avatar-sm')}</div>
        </div>`)}</div>
      </div>
      <div class="card">
        <h3>${t('Closest challengers')}</h3>
        <p class="small muted">${t('Who sits at #2, right behind {name}, on the most maps.', { name: boss.name })}</p>
        <div class="mini-board">${throne.challengers.map(([uid, n], i) => html`<a class="line" href="#/compare/${uid}/${throne.u}">
          <span class="n">${i + 1}<span class="sr-only">.</span></span>
          <span class="player">${avatar(uid, 'avatar-sm')}<span>${index.get(uid)?.name ?? uid}</span></span>
          <span class="sr-only">, </span><span class="pp">${fmt.num(n)}<small><span class="sr-only"> </span>${t('maps')}</small></span>
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
    <div class="mb-2 stat-value">${highlight(s, maps[s[S.MAP]])}</div>
    <div class="mb-2">${mapLink(s[S.MAP], maps[s[S.MAP]])}</div>
    <div class="score-line">${playerLink(uid, index, 'avatar-sm')} ${catChip(cat)} ${scoreStats(s)} ${ppText(s[S.PP])}</div>
  </div>`;
}

/** A top-5 list: [[userId, value]], with an optional line under the title and a footer. */
function leaders(title, rows, index, unit, { note, foot } = {}) {
  return html`<div class="card">
    <h3>${title}</h3>
    ${note ? html`<p class="small muted">${note}</p>` : ''}
    <div class="mini-board">${rows.map(([uid, value], i) => html`<a class="line" href="#/player/${uid}">
      <span class="n">${i + 1}<span class="sr-only">.</span></span>
      <span class="player">${avatar(uid, 'avatar-sm')}<span>${index.get(uid)?.name ?? uid}</span></span>
      <span class="sr-only">, </span><span class="pp">${fmt.num(value)}${unit ? html`<small><span class="sr-only"> </span>${unit}</small>` : ''}</span>
    </a>`)}</div>
    ${foot || ''}
  </div>`;
}

/** Most #1s with only hard maps counted (records.hard), next to the overall count, and the hardest full combo. */
function hardFirsts(h, maps, index) {
  const [uid, cat, ...s] = h.fc || [];
  const foot = h.fc ? html`<div class="card-foot">
    <div class="mb-2 muted">${t('Hardest full combo')}</div>
    ${mapLink(s[S.MAP], maps[s[S.MAP]])}
    <div class="mt-2 score-line">${playerLink(uid, index, 'avatar-sm')} ${catChip(cat)} ${scoreStats(s)}</div>
  </div>` : '';
  return leaders(t('Most #1s on {stars}★+ maps', { stars: fmt.num(h.stars) }), h.firsts, index, '', {
    note: t('The same count, but only on maps of {stars}★ and up (nomod stars, no EZ or HT).', { stars: fmt.num(h.stars) }), foot,
  });
}

export default async function recordsPage(root, { query, isCurrent }) {
  const [r, index] = await Promise.all([records(), playerIndex()]);
  if (!isCurrent()) return;
  setTitle(t('Records'));
  const maps = r.maps;
  const hours = r.byHour.map((value, hour) => ({ label: `${hour}h`, value, title: t('{from}h–{to}h: {plays}', { from: hour, to: hour + 1, plays: fmt.plural(value, 'play') }) }));
  const peak = r.byHour.indexOf(Math.max(...r.byHour));
  // Most #1s across all three categories, from the player list (the records file has them per category only).
  const mostFirsts = [...index.values()].map(p => [p.id, p.firsts.c + p.firsts.u + p.firsts.r]).filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5);
  const jumps = [['legendary', t('Legendary plays')], r.throne && ['throne', t('Dethrone Tris')], r.oneMiss && ['choke', 'Choke d’Or'],
    r.wysi?.length && ['wysi', 'WYSI'], ['first10k', t('First 10k')], ['collectors', t('Collectors')], ['when', t('When we play')]].filter(Boolean);

  root.innerHTML = String(html`
    <header class="page-head">
      <h1>${t('Records')}</h1>
      <p>${t('The biggest marks across every score the bot keeps: each player’s best play on each map.')}</p>
    </header>

    <nav class="jump-links" aria-label="${t('On this page')}">${jumps.map(([id, label]) => html`<a class="chip" href="#/records?at=${id}">${label}</a>`)}</nav>

    <div class="stats">
      ${stat(t('Scores'), fmt.num(r.totals.scores))}
      ${stat(t('Different maps'), fmt.num(r.totals.maps))}
      ${stat('SS', fmt.num(r.totals.ss))}
    </div>

    <section class="section" id="legendary">
      <h2>${t('Legendary plays')}</h2>
      <div class="grid grid-3">
        ${['c', 'u', 'r'].map(cat => playRecord(t('Most pp in {category}', { category: CAT_LABEL[cat] }), r.topPlay[cat], maps, index, s => html`${fmt.pp(s[S.PP])} pp`))}
        ${playRecord(t('Highest combo'), r.topCombo, maps, index, s => `${fmt.num(s[S.COMBO])}x`)}
        ${playRecord(t('Longest map passed'), r.longest, maps, index, (s, meta) => (meta ? fmt.duration(meta[M.LENGTH]) : '—'))}
        ${playRecord(t('Oldest #1'), r.oldestFirst, maps, index, s => t('since {date}', { date: fmt.date(s[S.TIME]) }))}
        ${['c', 'u', 'r'].map(cat => playRecord(t('Hardest map ({category})', { category: CAT_LABEL[cat] }), r.hardest[cat], maps, index, (s, meta) => (meta ? `★ ${fmt.num(meta[M.STARS], 2)}` : '—')))}
      </div>
      <p class="mt-2 small faint">${t('Plays with EZ or HT don’t count for the hardest and longest maps.')}</p>
    </section>

    ${r.throne ? throneSection(r.throne, maps, index) : ''}

    ${r.oneMiss ? html`<section class="section" id="choke">
      <h2>${t('The Choke d’Or')}</h2>
      <p class="muted">${t('Plays with exactly one miss: the community’s favourite subject. The 1-miss gods bless some players more than others.')}</p>
      <div class="grid grid-2">
        ${leaders(t('Most 1-miss plays'), r.oneMiss, index)}
        ${playRecord(t('The highest choke'), r.highestChoke, maps, index, s => t('{pp} pp, 1 miss', { pp: fmt.pp(s[S.PP]) }))}
      </div>
    </section>` : ''}

    ${r.wysi?.length ? html`<section class="section" id="wysi">
      <h2>${t('WYSI hall')}</h2>
      <p class="muted">${tn(r.wysi.length, '{n} play ended on exactly 727 combo. When you see it…', '{n} plays ended on exactly 727 combo. When you see it…')}</p>
      <div class="rows">${r.wysi.slice(0, 12).map(([uid, cat, ...s]) => html`<div class="row">
        <div class="row-main">${mapLink(s[S.MAP], maps[s[S.MAP]])}<div>${playerLink(uid, index, 'avatar-sm')}</div></div>
        <div class="row-meta">${catChip(cat)} ${scoreStats(s)}</div>
      </div>`)}</div>
    </section>` : ''}

    <section class="section" id="first10k">
      <h2>${t('First past {pp} pp', { pp: fmt.num(10000) })}</h2>
      <p class="muted">${t('The first Portuguese players to break 10k, and the play that took them there.')}</p>
      <div class="rows">${FIRST_10K.map(([day, name, uid, play], i) => html`<div class="row">
        <div class="score-line">${posBadge(i + 1)} ${uid && index.get(uid) ? playerLink(uid, index, 'avatar-sm') : html`<b>${name}</b>`} <span class="muted">${play}</span></div>
        <div class="row-meta"><span class="faint">${fmt.date(Date.parse(`${day}T12:00:00Z`) / 1000)}</span></div>
      </div>`)}</div>
    </section>

    <section class="section" id="collectors">
      <h2>${t('The collectors')}</h2>
      <p class="muted">${t('Each category’s own #1 count is on the leaderboards.')}</p>
      <div class="grid grid-2">
        ${leaders(t('Most #1s'), mostFirsts, index)}
        ${r.hard?.firsts.length ? hardFirsts(r.hard, maps, index) : ''}
        ${r.wall?.length ? leaders(t('The biggest walls (#1s standing 2+ years)'), r.wall, index) : ''}
        ${leaders(t('Most SSs'), r.mostSS, index)}
        ${leaders(t('Most full combos'), r.mostFC, index)}
      </div>
    </section>

    <section class="section card" id="when">
      <h2 class="card-h">${t('When does Portugal play?')}</h2>
      ${barChart(hours, { every: 3 })}
      <p class="m-0 mt-2 small muted">${t('Lisbon time when each score was set. Peak time is between {from}h and {to}h.', { from: peak, to: peak + 1 })}</p>
    </section>
  `);
  if (query.at) root.querySelector(`#${CSS.escape(query.at)}`)?.scrollIntoView({ block: 'start' });
}
