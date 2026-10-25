import { html, raw } from '../core/html.js';
import { mapsIndex, mapsTop, playerIndex } from '../core/data.js';
import {
  setTitle, paginate, setCover, starsBadge, starColor, catChip, pageHead, chipGroup, setPressed, writeQuery, announce,
  resultCount, emptyFiltered,
} from '../core/ui.js';
import { STAR_MAX, STAR_STEP, ANY_STARS, parseStars, formatStars, starsLabel, inStars, isAnyStars } from '../core/star-range.js';
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
// The selected stretch of the star slider wears osu!'s star colours, so the range reads like the badges it filters.
const STAR_GRADIENT = `linear-gradient(90deg, ${Array.from({ length: 2 * STAR_MAX + 1 }, (_, i) => `${starColor(i / 2)} ${i * 50 / STAR_MAX}%`).join(', ')})`;
const snapStar = v => Math.round(Math.min(STAR_MAX, Math.max(0, v)) / STAR_STEP) / (1 / STAR_STEP);

/**
 * Two native range inputs over one track: each keeps its keyboard steps and accessible name, while a press anywhere on
 * the track (not just on a thumb) moves the nearer thumb, which keeps it easy to hit on a phone.
 */
const starSlider = ([lo, hi]) => html`<div class="star-filter" role="group" aria-labelledby="stars-label">
  <span class="chips-label" id="stars-label">Stars</span>
  <div class="range" id="stars-range">
    <div class="range-track"><div class="range-fill" style="background:${STAR_GRADIENT}"></div></div>
    <input type="range" id="stars-min" min="0" max="${STAR_MAX}" step="${STAR_STEP}" value="${lo}" aria-label="Minimum stars">
    <input type="range" id="stars-max" min="0" max="${STAR_MAX}" step="${STAR_STEP}" value="${hi}" aria-label="Maximum stars">
  </div>
  <span class="range-out" id="stars-out"></span>
  <button class="range-reset" type="button" id="stars-reset">Reset</button>
</div>`;

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

  // The star slider: the track and readout follow every step at once; the list catches up once the thumbs rest.
  const range = root.querySelector('#stars-range');
  const [min, max] = [root.querySelector('#stars-min'), root.querySelector('#stars-max')];
  const out = root.querySelector('#stars-out');
  const reset = root.querySelector('#stars-reset');
  const showStars = () => {
    const [lo, hi] = stars;
    min.value = lo;
    max.value = hi;
    range.style.setProperty('--lo', `${lo / STAR_MAX * 100}%`);
    range.style.setProperty('--hi', `${hi / STAR_MAX * 100}%`);
    min.setAttribute('aria-valuetext', lo > 0 ? `${lo} stars` : 'No minimum');
    max.setAttribute('aria-valuetext', hi < STAR_MAX ? `${hi} stars` : 'No maximum');
    out.textContent = starsLabel(stars);
    out.classList.toggle('on', !isAnyStars(stars));
    reset.hidden = isAnyStars(stars);
  };
  let starTimer;
  // Moves one thumb, stopping a step short of the other so the two never cross.
  const setStar = (input, value) => {
    const [lo, hi] = stars;
    const v = snapStar(value);
    stars = input === min ? [snapStar(Math.min(v, hi - STAR_STEP)), hi] : [lo, snapStar(Math.max(v, lo + STAR_STEP))];
    showStars();
    if (stars[0] === lo && stars[1] === hi) return;
    clearTimeout(starTimer);
    starTimer = setTimeout(refilter, 150);
  };
  for (const input of [min, max]) input.addEventListener('input', () => setStar(input, Number(input.value)));
  const starAt = x => {
    const track = range.querySelector('.range-track').getBoundingClientRect();
    return (x - track.left) / track.width * STAR_MAX;
  };
  range.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const v = starAt(e.clientX);
    const [lo, hi] = stars;
    // The nearer thumb; when the two sit together, whichever can still move towards the press.
    let input = Math.abs(v - lo) < Math.abs(v - hi) ? min : max;
    if (hi - lo < 0.3 && v > hi) input = hi < STAR_MAX ? max : min;
    else if (hi - lo < 0.3 && v < lo) input = lo > 0 ? min : max;
    input.focus({ preventScroll: true });
    setStar(input, v);
    range.setPointerCapture(e.pointerId);
    const move = ev => setStar(input, starAt(ev.clientX));
    const end = () => {
      range.removeEventListener('pointermove', move);
      range.removeEventListener('pointerup', end);
      range.removeEventListener('pointercancel', end);
    };
    range.addEventListener('pointermove', move);
    range.addEventListener('pointerup', end);
    range.addEventListener('pointercancel', end);
  });
  reset.addEventListener('click', () => {
    stars = [...ANY_STARS];
    showStars();
    refilter();
    min.focus();
  });
  showStars();
  // An old ?diff= link is rewritten to the star range it now means.
  if ('diff' in query) save();

  root.querySelector('#list').addEventListener('click', e => {
    if (!e.target.closest('[data-clear]')) return;
    q.value = '';
    cat = '';
    stars = [...ANY_STARS];
    setPressed(root, 'cat', cat);
    showStars();
    refilter();
    q.focus();
  });
}
