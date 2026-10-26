import { html, raw } from '../core/html.js';
import { mapsIndex, mapsTop, playerIndex } from '../core/data.js';
import {
  setTitle, paginate, setCover, starsBadge, catChip, pageHead, chipGroup, setPressed, writeQuery, announce,
  resultCount, emptyFiltered,
} from '../core/ui.js';
import { ANY_STARS, parseStars, formatStars, starsLabel, inStars, isAnyStars } from '../core/star-range.js';
import { starSlider, bindStarSlider } from '../core/star-slider.js';
import * as fmt from '../core/fmt.js';

// Map rows (core/data.js mapsIndex/mapsTop): [id, setId, artist, title, version, stars, category, players, topPlayerId]
const SORTS = {
  players: ['Most players', (a, b) => b[7] - a[7] || a[0] - b[0]],
  stars: ['Most stars', (a, b) => b[5] - a[5]],
  easy: ['Fewest stars', (a, b) => (a[5] || 99) - (b[5] || 99)],
  new: ['Newest (by id)', (a, b) => b[0] - a[0]],
};
const CATS = [['', 'All'], ['c', 'Converts'], ['u', 'Loved & Unranked'], ['r', 'Ranked']];
const PAGE = 50;

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
  // Search, sort, filters and page live in the URL, so Back from a map returns to the same results.
  let cat = CATS.some(([k]) => k === query.cat) ? query.cat : '';
  // Old links filtered by difficulty name (?diff=platter); parseStars reads those as that name's star band.
  let stars = parseStars(query);
  const sortKey = SORTS[query.sort] ? query.sort : 'players';
  let page = Math.max(0, (Number(query.page) || 1) - 1);

  // The first pages come from the small maps-top.json; the full index is fetched once the visitor searches, sorts,
  // filters or pages on. A URL that already asks for any of that (a shared link, or Back from a map) loads it first.
  const [top, index] = await Promise.all([mapsTop(), playerIndex()]);
  const needsAll = query.q || cat || !isAnyStars(stars) || sortKey !== 'players' || (page + 1) * PAGE > top.rows.length;
  let list = needsAll ? await mapsIndex() : top.rows;
  let full = needsAll || list.length >= top.total;
  if (!isCurrent()) return;
  setTitle('Maps');

  root.innerHTML = String(html`
    ${pageHead({ title: 'Maps', intro: `${fmt.num(top.total)} maps with Portuguese plays. Search by artist, title, difficulty or map id; every map has its own Portuguese leaderboard.` })}
    <div class="toolbar">
      <input class="input" type="search" id="q" placeholder="Artist, title, difficulty or id…" value="${query.q || ''}" aria-label="Search maps">
      <select class="select" id="sort" aria-label="Sort">${Object.entries(SORTS).map(([k, [label]]) => html`<option value="${k}" ${k === sortKey ? raw('selected') : ''}>${label}</option>`)}</select>
    </div>
    <div id="cats" style="margin-bottom:8px">${chipGroup('Category', 'cat', CATS, cat)}</div>
    ${starSlider(stars)}
    <p class="result-count" id="count"></p>
    <div id="list"></div>
  `);

  const q = root.querySelector('#q');
  const sort = root.querySelector('#sort');
  const count = root.querySelector('#count');
  const describe = () => [
    q.value.trim() && `“${q.value.trim()}”`, cat && CATS.find(([k]) => k === cat)[1], !isAnyStars(stars) && starsLabel(stars),
  ].filter(Boolean).join(' · ');
  const visible = () => {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = list.filter(r => {
      if (cat && r[6] !== cat) return false;
      if (!inStars(r[5], stars)) return false;
      if (!words.length) return true;
      const text = `${r[0]} ${r[2]} ${r[3]} ${r[4]}`.toLowerCase();
      return words.every(w => text.includes(w));
    });
    return filtered.sort(SORTS[sort.value][1]);
  };

  const save = () => writeQuery({ q: q.value.trim(), sort: sort.value, cat, stars: formatStars(stars), page: page + 1 }, { sort: 'players', page: 1 });
  let items = visible();
  // Until the full index is in, the list is the top slice of the unfiltered view, so the count is simply the total.
  const showCount = speak => {
    count.textContent = full ? resultCount(items.length, top.total, 'map') : fmt.plural(top.total, 'map');
    if (speak) announce(count.textContent);
  };
  const redraw = paginate(root.querySelector('#list'), items, slice => html`<div class="rows">${slice.map(r => row(r, index))}</div>`, PAGE, {
    page,
    onPage: p => { page = p; save(); },
    empty: () => emptyFiltered(`No maps match ${describe() || 'these filters'}.`),
  });
  showCount(false);

  // The first interaction starts fetching the full index. When it lands on the untouched default view (most players,
  // no filter), the pages just grow and the visitor stays on the page they're on.
  let all = full ? Promise.resolve() : null;
  const loadAll = () => (all ??= mapsIndex().then(rows => {
    list = rows;
    full = true;
    const untouched = !q.value.trim() && !cat && isAnyStars(stars) && sort.value === 'players';
    if (isCurrent() && untouched) { items = visible(); redraw(items, true); showCount(false); }
  }));
  const refilter = () => loadAll().then(() => {
    if (!isCurrent()) return;
    items = visible();
    redraw(items);
    showCount(true);
  });
  if (!full) for (const type of ['pointerdown', 'focusin', 'keydown']) root.addEventListener(type, loadAll, { once: true });

  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refilter, 200); });
  sort.addEventListener('change', refilter);
  root.querySelector('#cats').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat;
    setPressed(root, 'cat', cat);
    refilter();
  });

  // The star slider (core/star-slider.js): the list catches up once the thumbs rest.
  const slider = bindStarSlider(root, stars, next => { stars = next; refilter(); });
  // An old ?diff= link is rewritten to the star range it now means.
  if ('diff' in query) save();

  root.querySelector('#list').addEventListener('click', e => {
    if (!e.target.closest('[data-clear]')) return;
    q.value = '';
    cat = '';
    stars = [...ANY_STARS];
    setPressed(root, 'cat', cat);
    slider.set(stars);
    refilter();
    q.focus();
  });
}
