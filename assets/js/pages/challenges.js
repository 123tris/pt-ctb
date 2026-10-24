import { html } from '../core/html.js';
import { challenges, playerIndex } from '../core/data.js';
import { S, M } from '../core/model.js';
import {
  setTitle, mapLink, playerLink, scoreStats, ppText, posBadge, catChip, coverUrl, mapText, starsBadge, empty, osuMap, prefs,
} from '../core/ui.js';
import * as fmt from '../core/fmt.js';

function countdown(end) {
  const left = Math.max(0, end - Date.now() / 1000);
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), s = Math.floor(left % 60);
  return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function boardTable(rows, index, me) {
  return html`<div class="table-wrap"><table class="table-compact">
    <thead><tr><th>#</th><th>Player</th><th class="num">Score</th><th>Play</th><th class="num">pp</th><th class="num">When</th></tr></thead>
    <tbody>${rows.map(([uid, ...s], i) => html`<tr class="${uid === me ? 'me' : ''}">
      <td>${posBadge(i + 1)}</td><td>${playerLink(uid, index, 'avatar-sm')}</td><td class="num">${fmt.num(s[S.SCORE])}</td>
      <td><span class="score-line">${scoreStats(s)}</span></td><td class="num">${ppText(s[S.PP])}</td>
      <td class="num faint">${fmt.ago(s[S.TIME])}</td>
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
        <h1><a href="#/map/${week.map}">${title}</a></h1>
        <div class="sub">${sub}</div>
        <p style="margin:12px 0 0">Ends in <span class="countdown" id="countdown">${countdown(week.end)}</span></p>
      </div>
    </section>
    <div class="btn-row" style="margin:14px 0 22px">
      <a class="btn btn-primary" href="${osuMap(week.map)}" target="_blank" rel="noopener">Open on osu! ↗</a>
      <a class="btn" href="#/map/${week.map}">Full leaderboard</a>
    </div>
    <div class="section-head"><h2>This week’s plays</h2></div>
    ${week.weekly.length ? boardTable(week.weekly, index, me) : empty('Nobody has played this map this week. Be the first!')}
    <div class="section-head" style="margin-top:28px"><h2>All-time top</h2></div>
    ${boardTable(week.board.slice(0, 10), index, me)}`;
}

/** The supporter challenge, scored the Discord's way: a grade on each pool map is worth points, first to 50 wins. */
function houseSection(house, maps, index, me) {
  const played = row => row[2].filter(Boolean).length;
  return html`<section class="section">
    <div class="section-head"><h2>The supporter challenge</h2><span class="muted small">The map pool Fie tracks for the Discord’s supporter challenges.</span></div>
    <div class="grid grid-2">
      <div class="card">
        <h3>House rules</h3>
        <p>A <b>C</b> on a pool map is worth 1 point, a <b>B</b> 2, an <b>A</b> 3 and an <b>S</b> (or SS) 4. First to ${house.target} wins.</p>
        <p class="muted">B’s and C’s are where it’s at. HD weeks pay more: an S with HD is worth 10, an A with HD 5.</p>
        <p class="small faint" style="margin:0">Prize: a month of supporter (paid by Tris, as tradition demands). The standings here use each player’s best stored play on every pool map.</p>
      </div>
      <div>
        ${house.rows.length ? html`<div class="table-wrap"><table class="table-compact">
          <thead><tr><th>#</th><th>Player</th><th class="num">Points</th><th>To ${house.target}</th><th class="num">Maps</th></tr></thead>
          <tbody>${house.rows.slice(0, 12).map(([uid, points, grades], i) => html`<tr class="${uid === me ? 'me' : ''}">
            <td class="rank">${i + 1}</td><td>${playerLink(uid, index, 'avatar-sm')}</td><td class="num"><b>${points}</b></td>
            <td><span class="progress" title="${points} of ${house.target}"><span style="width:${Math.min(100, (points / house.target) * 100)}%"></span></span></td>
            <td class="num faint">${played([uid, points, grades])}/${house.pool.length}</td>
          </tr>`)}</tbody>
        </table></div>` : empty('Nobody has scored on the pool yet.')}
      </div>
    </div>
    <details class="pool">
      <summary>The ${house.pool.length} pool maps</summary>
      <div class="rows">${house.pool.map(id => html`<div class="row">${mapLink(id, maps[id])}</div>`)}</div>
    </details>
  </section>`;
}

export default async function challengesPage(root, { isCurrent }) {
  const [data, index] = await Promise.all([challenges(), playerIndex()]);
  if (!isCurrent()) return;
  setTitle('Challenges');
  const me = prefs.get('me', null);
  const { maps } = data;

  root.innerHTML = String(html`
    <header class="page-head">
      <span class="eyebrow">Challenges</span>
      <h1>There’s always something to conquer</h1>
      <p>A new map every week, #1s that are begging to be sniped, and maps nobody in Portugal has played yet.</p>
    </header>

    <section>
      <div class="section-head"><h2>Map of the week</h2><span class="muted small">Picked automatically every Monday.</span></div>
      ${weekSection(data.week, maps, index, me)}
    </section>

    <section class="section">
      <div class="section-head"><h2>Vulnerable #1s</h2><span class="muted small">Contested maps where the #1 has misses or under 97% accuracy.</span></div>
      ${data.beatable.length ? html`<div class="rows">${data.beatable.map(([id, cat, n, [uid, ...s]]) => html`<div class="row">
        <div>${mapLink(id, maps[id])}</div>
        <div class="row-meta">${catChip(cat)} <span>${fmt.plural(n, 'player')}</span><span class="sep"></span>
          <span class="faint">#1</span> ${playerLink(uid, index, 'avatar-sm')} ${scoreStats(s, { combo: false })} ${ppText(s[S.PP])}</div>
      </div>`)}</div>` : empty('Every #1 is well defended. For now.')}
    </section>

    ${data.house ? houseSection(data.house, maps, index, me) : ''}

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
    </section>
  `);

  if (data.week) {
    const el = root.querySelector('#countdown');
    const timer = setInterval(() => {
      if (!isCurrent() || !el.isConnected) return clearInterval(timer);
      el.textContent = countdown(data.week.end);
    }, 1000);
  }
}
