import { html } from '../core/html.js';
import { mapsIndex, mapsTop, playerIndex } from '../core/data.js';
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
// osu!catch's difficulty-name archetypes, plus every "-dose" pun (nekodose, himedose…) that isn't an Overdose.
const DIFFS = [
  ['', 'Any diff', null], ['cup', 'Cup', /\bcup\b/i], ['salad', 'Salad', /\bsalad\b/i], ['platter', 'Platter', /\bplatter\b/i],
  ['rain', 'Rain', /\brain\b/i], ['overdose', 'Overdose', /\boverdose\b/i], ['dose', 'Other -doses', /\w+dose\b/i],
];

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
  // The first pages come from the small maps-top.json; the full index (several hundred KB) is only fetched once the
  // visitor searches, sorts, filters or pages on.
  const [top, index] = await Promise.all([mapsTop(), playerIndex()]);
  if (!isCurrent()) return;
  setTitle('Maps');
  let list = top.rows;

  root.innerHTML = String(html`
    <header class="page-head">
      <span class="eyebrow">Maps</span>
      <h1>${fmt.num(top.total)} maps with Portuguese plays</h1>
      <p>Search by artist, title, difficulty or map id. Every map has its own Portuguese leaderboard.</p>
    </header>
    <div class="toolbar">
      <input class="input" type="search" id="q" placeholder="Artist, title, difficulty or id…" value="${query.q || ''}" aria-label="Search maps">
      <select class="select" id="sort" aria-label="Sort">${Object.entries(SORTS).map(([k, [label]]) => html`<option value="${k}">${label}</option>`)}</select>
    </div>
    <div class="chips" id="cats" style="margin-bottom:8px">${CATS.map(([k, label]) => html`<button class="chip ${k === '' ? 'active' : ''}" data-cat="${k}">${label}</button>`)}</div>
    <div class="chips" id="diffs" style="margin-bottom:16px" title="Filter by the difficulty's name">${DIFFS.map(([k, label]) => html`<button class="chip ${k === '' ? 'active' : ''}" data-diff="${k}">${label}</button>`)}</div>
    <div id="list"></div>
  `);

  const q = root.querySelector('#q');
  const sort = root.querySelector('#sort');
  let cat = '';
  let diff = null;
  const visible = () => {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = list.filter(r => {
      if (cat && r[6] !== cat) return false;
      if (diff && (!diff.test(r[4]) || (diff === DIFFS[6][2] && /overdose/i.test(r[4])))) return false;
      if (!words.length) return true;
      const text = `${r[0]} ${r[2]} ${r[3]} ${r[4]}`.toLowerCase();
      return words.every(w => text.includes(w));
    });
    return filtered.sort(SORTS[sort.value][1]);
  };
  const redraw = paginate(root.querySelector('#list'), visible(), slice => html`<div class="rows">${slice.map(r => row(r, index))}</div>`);

  // Every change waits for the full index; the first interaction starts fetching it. When it lands on the untouched
  // default view (most players, no filter), the pages just grow and the visitor stays on the page they're on.
  let all = null;
  const loadAll = () => (all ??= mapsIndex().then(rows => {
    list = rows;
    const untouched = !q.value.trim() && !cat && !diff && sort.value === 'players';
    if (isCurrent() && untouched) redraw(visible(), true);
  }));
  const update = () => loadAll().then(() => isCurrent() && redraw(visible()));
  for (const type of ['pointerdown', 'focusin', 'keydown']) root.addEventListener(type, loadAll, { once: true });
  if (query.q) update();

  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 150); });
  sort.addEventListener('change', update);
  root.querySelector('#cats').addEventListener('click', e => {
    if (e.target.dataset.cat === undefined) return;
    cat = e.target.dataset.cat;
    root.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
    update();
  });
  root.querySelector('#diffs').addEventListener('click', e => {
    if (e.target.dataset.diff === undefined) return;
    diff = DIFFS.find(([k]) => k === e.target.dataset.diff)[2];
    root.querySelectorAll('[data-diff]').forEach(b => b.classList.toggle('active', b.dataset.diff === e.target.dataset.diff));
    update();
  });
}
