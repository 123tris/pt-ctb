// Shared bits of markup: players, maps, mods, grades, score rows, tabs, paging.

import { html, raw } from './html.js';
import { S, M, modString } from './model.js';
import { LOADING, pick } from './lore.js';
import * as fmt from './fmt.js';

export const CAT_LABEL = { c: 'Converts', u: 'Loved & Unranked', r: 'Ranked' };
export const CAT_SHORT = { c: 'Converts', u: 'Loved', r: 'Ranked' };
export const CAT_SLUG = { c: 'converts', u: 'loved', r: 'ranked' };
export const SLUG_CAT = { converts: 'c', loved: 'u', ranked: 'r' };

export const osuUser = id => `https://osu.ppy.sh/users/${id}/fruits`;
export const osuMap = id => `https://osu.ppy.sh/beatmaps/${id}?mode=fruits`;
export const avatarUrl = id => `https://a.ppy.sh/${id}`;
export const coverUrl = (set, kind = 'list') => (set ? `https://assets.ppy.sh/beatmaps/${set}/covers/${kind}.jpg` : '');

export function setTitle(title) {
  document.title = title ? `${title} · PT-CTB` : 'PT-CTB · osu!catch in Portugal';
}

// ---- Players ------------------------------------------------------------------------------------------

export const avatar = (id, cls = '') => html`<img class="avatar ${cls}" src="${avatarUrl(id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;

/** A player's name with avatar, linking to their page. `who` is a players.json entry or an id + index. */
export function playerLink(who, index, cls = '') {
  const p = typeof who === 'object' ? who : index?.get(who);
  const id = typeof who === 'object' ? who.id : who;
  return html`<a class="player" href="#/player/${id}">${avatar(id, cls)}<span>${p ? p.name : `#${id}`}</span></a>`;
}

export const playerName = (index, id) => index.get(id)?.name ?? `#${id}`;

// ---- Maps ------------------------------------------------------------------------------------------------

/** { title, sub } for a map; maps the bot only knows by id get a placeholder title. */
export function mapText(id, meta) {
  if (!meta || !meta[M.TITLE] || meta[M.TITLE] === 'Unknown') return { title: `Map #${id}`, sub: 'No map details' };
  return { title: `${meta[M.ARTIST]} - ${meta[M.TITLE]}`, sub: `[${meta[M.VERSION]}] · ${meta[M.CREATOR]}` };
}

export const mapLabel = (id, meta) => {
  const { title } = mapText(id, meta);
  return meta && meta[M.VERSION] ? `${title} [${meta[M.VERSION]}]` : title;
};

const STAR_STOPS = [0.1, 1.25, 2, 2.5, 3.3, 4.2, 4.9, 5.8, 6.7, 7.7, 9];
const STAR_COLORS = ['#4290fb', '#4fc0ff', '#4fffd5', '#7cff4f', '#f6f05c', '#ff8068', '#ff4e6f', '#c645b8', '#6563de', '#18158e', '#000000'];

/** osu!'s star-rating colour spectrum. */
export function starColor(stars) {
  if (stars <= STAR_STOPS[0]) return STAR_COLORS[0];
  if (stars >= STAR_STOPS[STAR_STOPS.length - 1]) return STAR_COLORS[STAR_COLORS.length - 1];
  const i = STAR_STOPS.findIndex(stop => stop > stars) - 1;
  const t = (stars - STAR_STOPS[i]) / (STAR_STOPS[i + 1] - STAR_STOPS[i]);
  const mix = (a, b) => Math.round(a + (b - a) * t);
  const [a, b] = [STAR_COLORS[i], STAR_COLORS[i + 1]].map(c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16)));
  return `rgb(${mix(a[0], b[0])}, ${mix(a[1], b[1])}, ${mix(a[2], b[2])})`;
}

export function starsBadge(stars) {
  if (!stars) return '';
  const color = stars >= 6.5 ? '#ffd966' : 'rgba(0,0,0,.8)';
  return html`<span class="stars" style="background:${starColor(stars)};color:${color}">★ ${fmt.num(stars, 2)}</span>`;
}

/** A beatmapset's cover image (`kind`: list, card, cover, cover@2x), or an empty placeholder of the same size. */
export function setCover(set, kind = 'list', cls = 'map-cover') {
  return set
    ? html`<img class="${cls}" src="${coverUrl(set, kind)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : html`<span class="${cls}"></span>`;
}

export const cover = (meta, kind = 'list', cls = 'map-cover') => setCover(meta?.[M.SET], kind, cls);

/** A map with its cover, title and difficulty, linking to its page. */
export function mapLink(id, meta, { showStars = true } = {}) {
  const { title, sub } = mapText(id, meta);
  return html`<a class="map" href="#/map/${id}">
    ${cover(meta)}
    <span class="map-text">
      <span class="map-title" title="${title}">${title}</span>
      <span class="map-sub">${showStars && meta ? html`${starsBadge(meta[M.STARS])} ` : ''}${sub}</span>
    </span>
  </a>`;
}

// ---- Scores ----------------------------------------------------------------------------------------------

const MOD_KIND = {
  EZ: 'reduce', NF: 'reduce', HT: 'reduce', HD: 'increase', HR: 'increase', DT: 'increase', NC: 'increase',
  FL: 'increase', SD: 'increase', PF: 'increase', RX: 'auto', AU: 'auto', AP: 'auto',
};

export function modsBadges(mask) {
  const text = modString(mask);
  if (text === 'NM') return html`<span class="mods"><span class="mod mod-nm">NM</span></span>`;
  const names = text.match(/.{2}/g);
  return html`<span class="mods">${names.map(n => html`<span class="mod mod-${MOD_KIND[n] || 'other'}">${n}</span>`)}</span>`;
}

const GRADE_TEXT = { X: 'SS', XH: 'SS', S: 'S', SH: 'S' };
export const gradeBadge = g => html`<span class="grade grade-${g}">${GRADE_TEXT[g] ?? g}</span>`;
export const catChip = cat => html`<span class="cat cat-${cat}">${CAT_SHORT[cat]}</span>`;
export const posBadge = n => (n ? html`<span class="pos pos-${n <= 3 ? n : 'n'}" title="Position in Portugal">#${n}</span>` : '');
export const ppText = n => html`<span class="pp">${fmt.pp(n)}<small>pp</small></span>`;

/** The stats of a play: mods, grade, accuracy, combo, misses. */
export function scoreStats(s, { combo = true } = {}) {
  return html`${modsBadges(s[S.MODS])}
    ${gradeBadge(s[S.GRADE])}
    <span class="acc">${fmt.acc(s[S.ACC])}</span>
    ${combo ? html`<span class="combo">${fmt.num(s[S.COMBO])}x</span>` : ''}
    <span class="miss ${s[S.MISS] ? 'miss-n' : 'miss-fc'}" title="Misses">${s[S.MISS] ? html`${fmt.num(s[S.MISS])} ✕` : 'FC'}</span>`;
}

/**
 * One play as a row: the map (or the player, or both), its stats, pp and when. `pos` shows the PT position badge.
 */
export function scoreRow({ s, meta, player, index, pos, showMap = true, cat }) {
  return html`<div class="row">
    <div class="row-main">
      ${showMap ? mapLink(s[S.MAP], meta) : ''}
      ${player !== undefined ? html`<div>${playerLink(player, index, 'avatar-sm')}</div>` : ''}
    </div>
    <div class="row-meta">
      ${cat ? catChip(cat) : ''}
      ${scoreStats(s)}
      <span class="sep"></span>
      ${posBadge(pos)}
      ${ppText(s[S.PP])}
      <span class="faint" title="${fmt.dateTime(s[S.TIME])}">${fmt.ago(s[S.TIME])}</span>
    </div>
  </div>`;
}

// ---- Layout helpers ----------------------------------------------------------------------------------------

export const stat = (label, value, sub = '', cls = '') =>
  html`<div class="stat ${cls}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${sub ? html`<div class="stat-sub">${sub}</div>` : ''}</div>`;

export const tabs = items => html`<nav class="tabs">${items.map(t =>
  html`<a href="${t.href}" class="${t.active ? 'active' : ''}">${t.label}${t.count !== undefined ? html`<span class="count">${fmt.num(t.count)}</span>` : ''}</a>`)}</nav>`;

export const empty = text => html`<div class="empty">${text}</div>`;
export const loading = () => html`<div class="loading"><div class="center"><div class="spinner" style="margin-inline:auto"></div>${pick(LOADING)}</div></div>`;

/** In-joke badges or map tags ({ name, tip }), with the explanation on hover. */
export const funChips = (list, cls = '') => (list.length
  ? html`<div class="fun-chips ${cls}">${list.map(b => html`<span class="fun-chip" title="${b.tip}" tabindex="0">${b.name}</span>`)}</div>`
  : '');

/**
 * Renders `items` a page at a time into `container`, with previous/next buttons. `render(slice, offset)` returns
 * the markup for one page. Returns a function that re-renders from the first page (after a filter changes).
 */
export function paginate(container, items, render, size = 50) {
  let page = 0;
  const pages = () => Math.max(1, Math.ceil(items.length / size));
  const draw = () => {
    const slice = items.slice(page * size, page * size + size);
    container.innerHTML = String(html`${slice.length ? render(slice, page * size) : empty('Nothing to show.')}
      ${pages() > 1 ? html`<div class="pager">
        <button class="btn btn-small" data-page="prev" ${page === 0 ? raw('disabled') : ''}>← Previous</button>
        <span>Page ${page + 1} of ${pages()}</span>
        <button class="btn btn-small" data-page="next" ${page >= pages() - 1 ? raw('disabled') : ''}>Next →</button>
      </div>` : ''}`);
  };
  container.addEventListener('click', e => {
    const button = e.target.closest('[data-page]');
    if (!button) return;
    page += button.dataset.page === 'next' ? 1 : -1;
    draw();
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  draw();
  return newItems => { items = newItems ?? items; page = 0; draw(); };
}

/** A name box with every player as a suggestion; read it back with pickedPlayer(). */
export function playerPicker(id, list, selected, placeholder = 'Player name…') {
  return html`<input class="input" id="${id}" list="${id}-names" placeholder="${placeholder}" autocomplete="off"
      value="${selected ? selected.name : ''}" aria-label="${placeholder}">
    <datalist id="${id}-names">${list.map(p => html`<option value="${p.name}"></option>`)}</datalist>`;
}

export const pickedPlayer = (input, list) => {
  const name = input.value.trim().toLowerCase();
  return list.find(p => p.name.toLowerCase() === name) ?? null;
};

/**
 * Tiny persistent preference (localStorage may be unavailable, so every access is guarded). Setting one fires a
 * `ptctb:pref` event on window with `{ key, value }`, so the header can follow "This is me" as it changes.
 */
export const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`ptctb:${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`ptctb:${key}`, JSON.stringify(value)); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent('ptctb:pref', { detail: { key, value } }));
  },
};
