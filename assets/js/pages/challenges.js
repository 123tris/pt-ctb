import { html, raw } from '../core/html.js';
import { challenges, playerIndex, dan } from '../core/data.js';
import { S, M } from '../core/model.js';
import {
  setTitle, mapLink, playerLink, scoreStats, ppText, posBadge, catChip, coverUrl, mapText, starsBadge, empty, osuMap, prefs,
  pageHead, scoreWhen,
} from '../core/ui.js';
import { renderDan, DAN_INTRO } from './dan.js';
import * as fmt from '../core/fmt.js';

// Three sub-pages with their own URLs (#/challenges/week, /dan, /targets). "Dan" keeps the community's own word, and
// the three are shown as big cards under the heading so the Dan course can't be missed.
const TABS = [
  { slug: 'week', label: 'This week', blurb: 'The map of the week', intro: html`A new map every Monday. The week’s best plays and the Score of the week vote are on <a href="#/activity?view=week">Activity</a>.` },
  { slug: 'dan', label: 'Dan course', blurb: '19 stages, Zeroth Dan to Shin', intro: DAN_INTRO },
  { slug: 'targets', label: 'Snipe targets', blurb: '#1s up for grabs', intro: '#1s that are begging to be sniped, boss maps nobody has FC’d, and maps nobody in Portugal has played yet.' },
];

/** The sub-page switcher: three labelled cards, a real nav with aria-current (the pages have their own URLs). */
const subnav = current => html`<nav class="subnav" aria-label="Challenges">${TABS.map(t => html`<a href="#/challenges/${t.slug}" class="${t === current ? 'active' : ''}" ${t === current ? raw('aria-current="page"') : ''}>
  <b>${t.label}</b><span>${t.blurb}</span>
</a>`)}</nav>`;

function countdown(end) {
  const left = Math.max(0, end - Date.now() / 1000);
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), s = Math.floor(left % 60);
  return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

/** On phones: rank, player (with the play under the name) and pp; score, play and time are desktop columns. */
function boardTable(rows, index, me, label) {
  return html`<div class="table-wrap" data-label="${label}"><table class="table-compact">
    <thead><tr><th>#</th><th>Player</th><th class="num col-opt">Score</th><th class="col-opt">Play</th><th class="num">pp</th><th class="num col-opt">When</th></tr></thead>
    <tbody>${rows.map(([uid, ...s], i) => html`<tr class="${uid === me ? 'me' : ''}">
      <td>${posBadge(i + 1)}</td>
      <td class="cell-player">${playerLink(uid, index, 'avatar-sm')}<span class="cell-sub"><span class="score-line">${scoreStats(s)}</span></span></td>
      <td class="num col-opt">${fmt.num(s[S.SCORE])}</td>
      <td class="col-opt"><span class="score-line">${scoreStats(s)}</span></td><td class="num">${ppText(s[S.PP])}</td>
      <td class="num faint col-opt">${scoreWhen(s, fmt.ago(s[S.TIME]))}</td>
    </tr>`)}</tbody>
  </table></div>`;
}

function weekSection(week, maps, index, me) {
  if (!week) return empty('No map of the week yet.');
  const meta = maps[week.map];
  const { title, sub } = mapText(week.map, meta);
  return html`
    <section class="banner">
      <div class="banner-art" style="${meta?.[M.SET] ? `background-image:url('${coverUrl(meta[M.SET], 'cover@2x')}')` : ''}"></div>
      <div class="banner-body">
        <div class="links">
          <span class="badge badge-accent">Week ${week.id.split('-W')[1]}</span>
          ${catChip(week.cat)} ${meta ? starsBadge(meta[M.STARS]) : ''}
        </div>
        <h3 class="banner-title"><a href="#/map/${week.map}">${title}</a></h3>
        <div class="sub">${sub}</div>
        <p style="margin:12px 0 0">Ends in <span class="countdown" id="countdown">${countdown(week.end)}</span></p>
      </div>
    </section>
    <div class="btn-row" style="margin:14px 0 22px">
      <a class="btn btn-primary" href="${osuMap(week.map)}" target="_blank" rel="noopener">Open on osu! ↗</a>
      <a class="btn" href="#/map/${week.map}">Full leaderboard</a>
    </div>
    <div class="section-head"><h2>This week’s plays</h2></div>
    ${week.weekly.length ? boardTable(week.weekly, index, me, 'This week’s plays on the map of the week') : empty('Nobody has played this map this week. Be the first!')}
    <div class="section-head" style="margin-top:28px"><h2>All-time top</h2></div>
    ${boardTable(week.board.slice(0, 10), index, me, 'All-time top 10 on the map of the week')}`;
}

export default async function challengesPage(root, { params, query, isCurrent }) {
  const tab = TABS.find(t => t.slug === params.tab) ?? TABS[0];
  const [data, index, danData] = await Promise.all([challenges(), playerIndex(), tab.slug === 'dan' ? dan() : null]);
  if (!isCurrent()) return;
  setTitle(tab.slug === 'week' ? 'Challenges' : `${tab.label} · Challenges`);
  const me = prefs.get('me', null);
  const { maps } = data;

  root.innerHTML = String(html`
    ${pageHead({ title: 'Challenges' })}
    ${subnav(tab)}
    <p class="muted subnav-intro">${tab.intro}</p>
    <div id="panel">${tab.slug === 'week' ? weekPanel(data, maps, index, me) : tab.slug === 'targets' ? targetsPanel(data, maps, index) : ''}</div>
  `);

  if (tab.slug === 'dan') renderDan(root.querySelector('#panel'), danData, index, query);
  if (tab.slug === 'week' && data.week) {
    const el = root.querySelector('#countdown');
    const timer = setInterval(() => {
      if (!isCurrent() || !el.isConnected) return clearInterval(timer);
      el.textContent = countdown(data.week.end);
    }, 1000);
  }
}

function weekPanel(data, maps, index, me) {
  return html`
    <section>
      <div class="section-head"><h2>Map of the week</h2></div>
      ${weekSection(data.week, maps, index, me)}
    </section>`;
}

function targetsPanel(data, maps, index) {
  return html`
    <section>
      <div class="section-head"><h2>Vulnerable #1s</h2><span class="muted small">Contested maps where the #1 has misses or under 97% accuracy.</span></div>
      ${data.beatable.length ? html`<div class="rows">${data.beatable.map(([id, cat, n, [uid, ...s]]) => html`<div class="row">
        <div>${mapLink(id, maps[id])}</div>
        <div class="row-meta">${catChip(cat)} <span>${fmt.plural(n, 'player')}</span><span class="sep"></span>
          <span class="faint">#1</span> ${playerLink(uid, index, 'avatar-sm')} ${scoreStats(s, { combo: false })} ${ppText(s[S.PP])}</div>
      </div>`)}</div>` : empty('Every #1 is well defended. For now.')}
    </section>

    ${data.bounties?.length ? html`<section class="section">
      <div class="section-head"><h2>Bounty board</h2><span class="muted small">Boss maps (6.5★ and up) that several Portuguese players have passed but nobody has FC’d.</span></div>
      <div class="rows">${data.bounties.map(([id, cat, n, fewest]) => html`<div class="row">
        <div>${mapLink(id, maps[id])}</div>
        <div class="row-meta">${catChip(cat)} <span>${fmt.plural(n, 'player')}</span><span class="sep"></span>
          <span>closest: ${fmt.plural(fewest, 'miss', 'misses')}</span><span class="bounty-tag">Nobody’s FC’d this. Yet.</span></div>
      </div>`)}</div>
    </section>` : ''}

    <section class="section grid grid-2">
      <div>
        <div class="section-head"><h2>One-player maps</h2></div>
        <p class="muted small">Hard maps (5★ and up; loved and unranked ones under 10★) with a single Portuguese player. Just pass to take #2, or beat them for #1.</p>
        ${data.lonely.length ? html`<div class="rows">${data.lonely.map(([id, cat, [uid, ...s]]) => html`<div class="row" style="grid-template-columns:1fr">
          ${mapLink(id, maps[id])}
          <div class="row-meta" style="justify-content:flex-start">${catChip(cat)} ${playerLink(uid, index, 'avatar-sm')} ${ppText(s[S.PP])}</div>
        </div>`)}</div>` : empty('No one-player maps.')}
      </div>
      <div>
        <div class="section-head"><h2>Unclaimed</h2></div>
        <p class="muted small">Popular ranked osu!catch maps with no Portuguese score recorded.</p>
        ${data.unclaimed.length ? html`<div class="rows">${data.unclaimed.map(([id, plays, favs]) => html`<div class="row" style="grid-template-columns:1fr">
          ${mapLink(id, maps[id])}
          <div class="row-meta" style="justify-content:flex-start">${fmt.num(plays)} plays on osu! · ${fmt.num(favs)} favourites</div>
        </div>`)}</div>` : empty('Nothing left to claim. Impressive.')}
      </div>
    </section>`;
}
