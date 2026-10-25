import { html, raw } from '../core/html.js';
import { challenges, playerIndex, dan } from '../core/data.js';
import { S, M } from '../core/model.js';
import {
  setTitle, mapLink, playerLink, scoreStats, ppText, posBadge, catChip, coverUrl, mapText, starsBadge, empty, osuMap, prefs,
  pageHead, scoreWhen, mapLabel, scoreUrl,
} from '../core/ui.js';
import { renderDan, DAN_INTRO } from './dan.js';
import * as fmt from '../core/fmt.js';

// Three sub-pages with their own URLs (#/challenges/week, /dan, /targets). "Dan" keeps the community's own word, and
// the three are shown as big cards under the heading so the Dan course can't be missed.
const TABS = [
  { slug: 'week', label: 'This week', blurb: 'The map of the week', intro: 'A new map every week, picked automatically on Mondays: this week’s plays and the all-time top.' },
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
      <div class="section-head"><h2>Map of the week</h2><span class="muted small">Picked automatically every Monday.</span></div>
      ${weekSection(data.week, maps, index, me)}
    </section>
    ${highlights(data.weekly, maps, index)}`;
}

// ---- Weekly highlights: Score of the week, top pp play, most plays (the bot's Monday recap on Discord) ---------------

const LENS = { topPp: 'Top pp', snipe: 'Biggest snipe', hardestFc: 'Hardest FC', fill: 'Next best pp' };
const dayMonth = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', day: 'numeric', month: 'short' });

/** "13–19 Jul" (Lisbon dates, Monday to Sunday). */
function weekRange({ start, end }) {
  const [from, to] = [start, end - 86400].map(t => dayMonth.formatToParts(new Date(t * 1000)));
  const part = (parts, type) => parts.find(p => p.type === type).value;
  return part(from, 'month') === part(to, 'month')
    ? `${part(from, 'day')}–${part(to, 'day')} ${part(to, 'month')}`
    : `${part(from, 'day')} ${part(from, 'month')}–${part(to, 'day')} ${part(to, 'month')}`;
}

/** A highlighted play ([user, category, ...tuple]) as a row, with what it's highlighted for. */
const highlightRow = (label, [uid, cat, ...s], maps, index) => html`<div class="row">
  <div class="row-main"><span class="muted small">${label}</span>${mapLink(s[S.MAP], maps[s[S.MAP]])}<div>${playerLink(uid, index, 'avatar-sm')}</div></div>
  <div class="row-meta">${catChip(cat)} ${scoreStats(s)}<span class="sep"></span>${ppText(s[S.PP])}
    <span class="faint" title="${fmt.dateTime(s[S.TIME])}">${scoreWhen(s, fmt.ago(s[S.TIME]))}</span></div>
</div>`;

/** A play in one table cell: who, pp (linked to the play on osu! when known) and the map. */
function playCell([uid, , ...s], maps, index) {
  const url = scoreUrl(s);
  const pp = url ? html`<a href="${url}" target="_blank" rel="noopener" title="This play on osu!">${ppText(s[S.PP])}</a>` : ppText(s[S.PP]);
  return html`${playerLink(uid, index, 'avatar-sm')} ${pp} <a class="dim-link small" href="#/map/${s[S.MAP]}">${mapLabel(s[S.MAP], maps[s[S.MAP]])}</a>`;
}

/** Nothing at all until the bot has closed a week or written the week so far. */
function highlights(weekly, maps, index) {
  if (!weekly) return '';
  const { current, vote, past } = weekly;
  return html`
    ${current ? html`<section class="section">
      <div class="section-head"><h2>This week so far</h2><span class="muted small">${weekRange(current)} · ${fmt.plural(current.passes, 'pass', 'passes')} by ${fmt.plural(current.players, 'player')}${current.complete ? '' : ' · some plays may be missing'}</span></div>
      ${current.top || current.most.length ? html`<div class="rows">
        ${current.top ? highlightRow('Top pp play', current.top, maps, index) : ''}
        ${current.most.length ? html`<div class="row"><div class="row-main"><span class="muted small">Most plays</span></div>
          <div class="row-meta">${current.most.map(([uid, n]) => html`${playerLink(uid, index, 'avatar-sm')} <span>${fmt.plural(n, 'play')}</span>`)}</div></div>` : ''}
      </div>` : empty('Nothing yet this week. Go set something.')}
    </section>` : ''}

    ${vote ? html`<section class="section">
      <div class="section-head"><h2>Vote: Score of the week</h2><span class="muted small">The candidates from ${weekRange(past.find(p => p.week === vote.week) ?? past[0])}. Vote with the reactions on Discord; it closes with Monday's recap.</span></div>
      <div class="rows">${vote.candidates.map(([lens, row, n], i) => highlightRow(`${n ?? i + 1}. ${LENS[lens] ?? LENS.fill}`, row, maps, index))}</div>
      <div class="btn-row" style="margin-top:12px"><a class="btn btn-primary" href="${vote.url}" target="_blank" rel="noopener">Vote on Discord ↗</a></div>
    </section>` : ''}

    ${past.length ? html`<section class="section">
      <div class="section-head"><h2>Past weeks</h2><span class="muted small">Score of the week is voted on Discord; with no votes, the top pick wins.</span></div>
      <div class="table-wrap" data-label="Past weeks"><table class="table-compact">
        <thead><tr><th>Week</th><th>Score of the week</th><th class="col-opt">Top pp play</th><th class="col-opt">Most plays</th></tr></thead>
        <tbody>${past.slice(0, 26).map(p => html`<tr>
          <td title="${p.complete ? '' : 'The bot was offline for part of this week'}">${weekRange(p)}${p.complete ? '' : '*'}</td>
          <td>${p.sotw ? playCell(p.sotw, maps, index) : html`<span class="faint">${p.week === vote?.week ? 'voting' : '—'}</span>`}</td>
          <td class="col-opt">${p.top ? playCell(p.top, maps, index) : '—'}</td>
          <td class="col-opt">${p.most ? html`${playerLink(p.most[0], index, 'avatar-sm')} ${fmt.num(p.most[1])}` : '—'}</td>
        </tr>`)}</tbody>
      </table></div>
    </section>` : ''}`;
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
