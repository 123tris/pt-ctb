import { html } from '../core/html.js';
import { players, modRankings, meta } from '../core/data.js';
import { S } from '../core/model.js';
import { setTitle, tabs, playerLink, mapLink, modsBadges, ppText, empty, prefs, SLUG_CAT, CAT_LABEL } from '../core/ui.js';
import * as fmt from '../core/fmt.js';

const BOARDS = [
  { slug: 'converts', label: 'Converts' },
  { slug: 'loved', label: 'Loved & Unranked' },
  { slug: 'ranked', label: 'Ranked (official)' },
  { slug: 'mods', label: 'By mods' },
];

const INTRO = {
  converts: 'osu!standard maps played in catch mode. Each player’s best plays add up the way osu! does it: every play is worth 95% of the one before.',
  loved: 'Loved, pending and graveyarded maps. osu! gives no pp for these, so the bot works them out with the current osu!catch formula.',
  ranked: 'The official osu!catch leaderboard. The pp and global rank come from each player’s osu! profile.',
  mods: 'osupepe style: each player is ranked by the weighted pp of their plays that include the chosen mod. An HDDT play counts for HD, DT and HDDT; NM counts plays without EZ, HD, HR, DT, HT or FL.',
};

const SOURCES = [['r', 'Ranked'], ['c', 'Converts'], ['u', 'Loved & Unranked']];
const KEY = { c: 'cv', u: 'ul', r: 'pp' };

function updateQuery(params) {
  const [path] = location.hash.split('?');
  history.replaceState(null, '', `${path}?${new URLSearchParams(params)}`);
}

function boardTable(list, cat, me) {
  const key = KEY[cat];
  const ranked = cat === 'r';
  return html`<div class="table-wrap"><table>
    <thead><tr>
      <th>#</th><th>Player</th><th class="num">pp</th>
      ${ranked
        ? html`<th class="num">Global</th><th class="num">Country</th><th class="num">Accuracy</th><th class="num">Level</th>`
        : html`<th class="num">Scores</th><th class="num">#1s in PT</th><th class="num">Last played</th>`}
    </tr></thead>
    <tbody>${list.map(p => html`<tr class="${p.id === me ? 'me' : ''}" data-name="${p.name.toLowerCase()}">
      <td class="rank">${p.rank[cat]}</td>
      <td>${playerLink(p)}</td>
      <td class="num">${ppText(p[key])}</td>
      ${ranked
        ? html`<td class="num">${fmt.rank(p.global)}</td><td class="num">${fmt.rank(p.country)}</td><td class="num">${fmt.acc(p.acc)}</td><td class="num">${fmt.num(p.level, 0)}</td>`
        : html`<td class="num">${fmt.num(p.count[cat])}</td><td class="num">${fmt.num(p.firsts[cat])}</td><td class="num faint">${p.last ? fmt.ago(p.last) : '—'}</td>`}
    </tr>`)}</tbody>
  </table></div>`;
}

function modsTable(rows, maps, index, me) {
  if (!rows.length) return empty('Nobody has plays with this mod combination.');
  return html`<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>Player</th><th class="num">Weighted pp</th><th class="num">Plays</th><th>Best play</th><th class="num">pp</th></tr></thead>
    <tbody>${rows.map(([id, pp, count, top], i) => html`<tr class="${id === me ? 'me' : ''}" data-name="${(index.get(id)?.name || '').toLowerCase()}">
      <td class="rank">${i + 1}</td>
      <td>${playerLink(id, index)}</td>
      <td class="num">${ppText(pp)}</td>
      <td class="num">${fmt.num(count)}</td>
      <td class="wide">${mapLink(top[S.MAP], maps[top[S.MAP]])}</td>
      <td class="num">${modsBadges(top[S.MODS])} ${ppText(top[S.PP])}</td>
    </tr>`)}</tbody>
  </table></div>`;
}

export default async function rankings(root, { params, query, isCurrent }) {
  const slug = BOARDS.some(b => b.slug === params.board) ? params.board : 'converts';
  const [list, m, mods] = await Promise.all([players(), meta(), slug === 'mods' ? modRankings() : null]);
  if (!isCurrent()) return;
  setTitle(`${BOARDS.find(b => b.slug === slug).label} leaderboard`);
  const index = new Map(list.map(p => [p.id, p]));
  const me = prefs.get('me', null);

  root.innerHTML = String(html`
    <header class="page-head">
      <span class="eyebrow">Leaderboards</span>
      <h1>Who rules Portuguese catch</h1>
    </header>
    ${tabs(BOARDS.map(b => ({ href: `#/rankings/${b.slug}`, label: b.label, active: b.slug === slug })))}
    <p class="muted">${INTRO[slug]}${slug === 'ranked' && m.dump ? html` <span class="faint">Players and plays imported from the osu! data dump of ${m.dump.replaceAll('_', '-')}.</span>` : ''}</p>
    <div class="toolbar">
      <input class="input" type="search" id="filter" placeholder="Search players…" aria-label="Search players">
      ${slug === 'mods' ? html`<div class="chips" id="sources">${SOURCES.map(([key, label]) => html`<button class="chip" data-src="${key}">${label}</button>`)}</div>` : ''}
    </div>
    ${slug === 'mods' ? html`<div class="chips" id="modchips" style="margin-bottom:16px">${mods.filters.map(f => html`<button class="chip" data-mod="${f}">${f}</button>`)}</div>` : ''}
    <div id="board"></div>
  `);

  const board = root.querySelector('#board');
  const filter = root.querySelector('#filter');
  const applyFilter = () => {
    const q = filter.value.trim().toLowerCase();
    board.querySelectorAll('tbody tr').forEach(tr => tr.classList.toggle('hidden', q && !tr.dataset.name.includes(q)));
  };
  filter.addEventListener('input', applyFilter);

  if (slug !== 'mods') {
    const cat = SLUG_CAT[slug];
    const rows = list.filter(p => p.rank[cat]).sort((a, b) => a.rank[cat] - b.rank[cat]);
    board.innerHTML = String(rows.length ? boardTable(rows, cat, me) : empty(`Nobody is on the ${CAT_LABEL[cat]} leaderboard yet.`));
    return;
  }

  let source = SOURCES.some(([k]) => k === query.src) ? query.src : 'r';
  let mod = mods.filters.includes(query.mod) ? query.mod : 'HD';
  const draw = () => {
    root.querySelectorAll('[data-src]').forEach(b => b.classList.toggle('active', b.dataset.src === source));
    root.querySelectorAll('[data-mod]').forEach(b => b.classList.toggle('active', b.dataset.mod === mod));
    board.innerHTML = String(modsTable(mods.sources[source][mod], mods.maps, index, me));
    applyFilter();
    updateQuery({ src: source, mod });
  };
  root.querySelector('#sources').addEventListener('click', e => { if (e.target.dataset.src) { source = e.target.dataset.src; draw(); } });
  root.querySelector('#modchips').addEventListener('click', e => { if (e.target.dataset.mod) { mod = e.target.dataset.mod; draw(); } });
  draw();
}
