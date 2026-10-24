import { html } from '../core/html.js';
import { mapsIndex, playerIndex } from '../core/data.js';
import { setTitle, paginate, setCover, starsBadge, catChip } from '../core/ui.js';
import * as fmt from '../core/fmt.js';

// maps-index.json rows: [id, setId, artist, title, version, stars, category, players, topPlayerId]
const SORTS = {
  players: ['Most players', (a, b) => b[7] - a[7] || a[0] - b[0]],
  stars: ['Most stars', (a, b) => b[5] - a[5]],
  easy: ['Fewest stars', (a, b) => (a[5] || 99) - (b[5] || 99)],
  new: ['Newest (by id)', (a, b) => b[0] - a[0]],
};
const CATS = [['', 'All'], ['c', 'Converts'], ['u', 'Loved & Unranked'], ['r', 'Ranked']];

const row = (r, index) => {
  const titled = Boolean(r[3]);
  return html`<a class="row card-link" href="#/map/${r[0]}" style="color:inherit">
    <span class="map">
      ${setCover(r[1])}
      <span class="map-text">
        <span class="map-title">${titled ? `${r[2]} - ${r[3]}` : `Map #${r[0]}`}</span>
        <span class="map-sub">${starsBadge(r[5])} ${titled ? `[${r[4]}]` : 'No map details'}</span>
      </span>
    </span>
    <span class="row-meta">
      ${catChip(r[6])}
      <span>${fmt.plural(r[7], 'player')}</span>
      <span class="sep"></span>
      <span><span class="faint">#1</span> ${index.get(r[8])?.name ?? '—'}</span>
    </span>
  </a>`;
};

export default async function maps(root, { query, isCurrent }) {
  const [list, index] = await Promise.all([mapsIndex(), playerIndex()]);
  if (!isCurrent()) return;
  setTitle('Maps');

  root.innerHTML = String(html`
    <header class="page-head">
      <span class="eyebrow">Maps</span>
      <h1>${fmt.num(list.length)} maps with Portuguese plays</h1>
      <p>Search by artist, title, difficulty or map id. Every map has its own Portuguese leaderboard.</p>
    </header>
    <div class="toolbar">
      <input class="input" type="search" id="q" placeholder="Artist, title, difficulty or id…" value="${query.q || ''}" aria-label="Search maps">
      <select class="select" id="sort" aria-label="Sort">${Object.entries(SORTS).map(([k, [label]]) => html`<option value="${k}">${label}</option>`)}</select>
    </div>
    <div class="chips" id="cats" style="margin-bottom:16px">${CATS.map(([k, label]) => html`<button class="chip ${k === '' ? 'active' : ''}" data-cat="${k}">${label}</button>`)}</div>
    <div id="list"></div>
  `);

  const q = root.querySelector('#q');
  const sort = root.querySelector('#sort');
  let cat = '';
  const visible = () => {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = list.filter(r => {
      if (cat && r[6] !== cat) return false;
      if (!words.length) return true;
      const text = `${r[0]} ${r[2]} ${r[3]} ${r[4]}`.toLowerCase();
      return words.every(w => text.includes(w));
    });
    return filtered.sort(SORTS[sort.value][1]);
  };
  const redraw = paginate(root.querySelector('#list'), visible(), slice => html`<div class="rows">${slice.map(r => row(r, index))}</div>`);
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => redraw(visible()), 150); });
  sort.addEventListener('change', () => redraw(visible()));
  root.querySelector('#cats').addEventListener('click', e => {
    if (e.target.dataset.cat === undefined) return;
    cat = e.target.dataset.cat;
    root.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
    redraw(visible());
  });
}
