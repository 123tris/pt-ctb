// Shared bits of markup: players, maps, mods, grades, score rows, tabs, paging.

import { html, raw } from './html.js';
import { S, M, modString, DAN_STAGES } from './model.js';
import { LOADING, LEGENDS, pick } from './lore.js';
import * as fmt from './fmt.js';

export const CAT_LABEL = { c: 'Converts', u: 'Loved & Unranked', r: 'Ranked' };
export const CAT_SHORT = { c: 'Converts', u: 'Loved', r: 'Ranked' };
export const CAT_SLUG = { c: 'converts', u: 'loved', r: 'ranked' };
export const SLUG_CAT = { converts: 'c', loved: 'u', ranked: 'r' };

export const osuUser = id => `https://osu.ppy.sh/users/${id}/fruits`;
export const osuMap = id => `https://osu.ppy.sh/beatmaps/${id}?mode=fruits`;
// Opens the difficulty in the osu! game: the link osu!'s own osu!direct button uses. Stable jumps to it, or offers it
// in osu!direct (supporters only) when it isn't downloaded; lazer opens it too. A custom scheme, so never a new tab.
export const osuGame = id => `osu://b/${id}`;
/** A play's page on osu!, or null when its score id isn't known (see S.ID in model.js). */
export const scoreUrl = s => (s[S.ID] > 0 ? `https://osu.ppy.sh/scores/${s[S.ID]}` : s[S.ID] < 0 ? `https://osu.ppy.sh/scores/fruits/${-s[S.ID]}` : null);
/** When a play was set (`text`), linked to its page on osu! when that's known. */
export const scoreWhen = (s, text) => {
  const url = scoreUrl(s);
  return url ? html`<a class="dim-link" href="${url}" target="_blank" rel="noopener" title="${fmt.dateTime(s[S.TIME])}: this play on osu!">${text}</a>` : text;
};
export const avatarUrl = id => `https://a.ppy.sh/${id}`;
export const coverUrl = (set, kind = 'list') => (set ? `https://assets.ppy.sh/beatmaps/${set}/covers/${kind}.jpg` : '');

export function setTitle(title) {
  document.title = title ? `${title} · PT Catch` : 'PT Catch · osu!catch in Portugal';
}

// ---- Players ------------------------------------------------------------------------------------------

/** Displayed avatar sizes by class (site.css), as width/height so the layout doesn't move when they load. */
const AVATAR_SIZE = { 'avatar-lg': 88, 'avatar-md': 44, 'avatar-sm': 22 };

export const avatar = (id, cls = '') => {
  const size = AVATAR_SIZE[cls] ?? 32;
  return html`<img class="avatar ${cls}" src="${avatarUrl(id)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">`;
};

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

/** WCAG relative luminance of an `rgb(r, g, b)` or `#rrggbb` colour. */
function luminance(color) {
  const rgb = color.startsWith('#') ? [1, 3, 5].map(k => parseInt(color.slice(k, k + 2), 16)) : color.match(/\d+/g).map(Number);
  const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Black or white, whichever reads better on `background` (osu!'s spectrum spans both). Pure black and white keep
 * even the worst mid-tone (about 18% luminance) at 4.58:1; any softer pair dips under 4.5:1 on the purples.
 */
function textOn(background) {
  const l = luminance(background);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

export function starsBadge(stars) {
  if (!stars) return '';
  const bg = starColor(stars);
  return html`<span class="stars" style="background:${bg};color:${textOn(bg)}">★ ${fmt.num(stars, 2)}</span>`;
}

/** osu!'s cover sizes: list 150×104 (shown at 60×42), card 400×140, cover 900×250 (18:5). */
const COVER_SIZE = { list: [60, 42], card: [400, 140], cover: [900, 250], 'cover@2x': [900, 250] };

/** A beatmapset's cover image (`kind`: list, card, cover, cover@2x), or an empty placeholder of the same size. */
export function setCover(set, kind = 'list', cls = 'map-cover') {
  // width/height give the box its size (or, where CSS sets the width, its shape) before the image arrives.
  const [w, h] = COVER_SIZE[kind] ?? COVER_SIZE.list;
  return set
    ? html`<img class="${cls}" src="${coverUrl(set, kind)}" alt="" width="${w}" height="${h}" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">`
    : html`<span class="${cls}"></span>`;
}

export const cover = (meta, kind = 'list', cls = 'map-cover') => setCover(meta?.[M.SET], kind, cls);

/**
 * The wide art at the top of a map or challenge banner. Both sizes go in as CSS variables and site.css picks one:
 * the 1800px cover@2x on wide screens, the 900px cover on phones, where the banner is under 640px wide and the big one
 * was 100–250 KB of picture nobody could see the difference in.
 */
export const bannerArt = set => html`<div class="banner-art"${set ? html` style="--art:url('${coverUrl(set, 'cover')}');--art-2x:url('${coverUrl(set, 'cover@2x')}')"` : ''}></div>`;

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
export const posBadge = (n, label = 'Position in Portugal') => (n ? html`<span class="pos pos-${n <= 3 ? n : 'n'}" title="${label}"><span class="sr-only">${label}: </span>#${n}</span>` : '');
export const ppText = n => html`<span class="pp">${fmt.pp(n)}<small>pp</small></span>`;

// Players inactive on osu! (players.json `inactive`, only on them): osu! shows them at 0 pp, the site keeps their
// official pp. `ppSource` says where it came from: 'last-known' (the value last seen on osu!; `ppSeen` dates it when the
// exporter saw it itself) or 'estimated' (worked out from their stored plays, so usually on the low side). A null source
// means 0 pp and no place on the board. Older data has none of these fields.
export const isInactiveOnOsu = p => Boolean(p?.inactive);
const isEstimated = p => isInactiveOnOsu(p) && p.ppSource === 'estimated';
const ESTIMATE_TIP = 'Estimated from their stored plays, so probably a little low';

/** A quiet "inactive" tag for players inactive on osu!. */
export const inactiveTag = () => html`<span class="legend-tag" title="Inactive on osu!, which shows them at 0 pp">inactive<span class="sr-only"> on osu!</span></span>`;

/** Inactive: inactive on osu!, or no play stored in over a year. They stay on the leaderboards, greyed out. */
const INACTIVE_AFTER = 365 * 86400;
export const isInactive = p => isInactiveOnOsu(p) || !p.last || p.last < Date.now() / 1000 - INACTIVE_AFTER;

/** A legend is a former Portuguese top-5 player (lore.js LEGENDS) who is now inactive. */
export const isLegend = p => LEGENDS.has(p?.id) && isInactive(p);
export const legendTag = () => html`<span class="legend-tag" title="Former Portuguese top 5, now inactive">legend<span class="sr-only">: former Portuguese top 5, now inactive</span></span>`;

/** The tag after an inactive player's name: "legend" for legends, otherwise a quiet "inactive" saying why. */
export function statusTag(p) {
  if (isLegend(p)) return legendTag();
  if (isInactiveOnOsu(p)) return inactiveTag();
  if (isInactive(p)) return html`<span class="legend-tag" title="No new plays stored in over a year">inactive<span class="sr-only">: no new plays stored in over a year</span></span>`;
  return '';
}

/**
 * Official pp. An estimate reads "≈ 8,224pp (estimated)" (`compact`: just "≈ 8,224pp", with the rest in the tooltip);
 * a last-known value with a date says when it was seen in its tooltip.
 */
export function officialPp(p, { compact = false } = {}) {
  if (isEstimated(p)) {
    return html`<span class="pp" title="${ESTIMATE_TIP}"><span aria-hidden="true">≈ </span>${fmt.pp(p.pp)}<small>pp</small></span>${compact
      ? html`<span class="sr-only"> (estimated)</span>`
      : html`<span class="est" title="${ESTIMATE_TIP}">(estimated)</span>`}`;
  }
  const seen = isInactiveOnOsu(p) && p.ppSeen ? `Last seen on osu! ${fmt.date(p.ppSeen)}` : '';
  return seen ? html`<span class="pp" title="${seen}">${fmt.pp(p.pp)}<small>pp</small></span>` : ppText(p.pp);
}

/** Where an inactive player's official pp comes from: "estimated from their plays", "last seen 3 Mar 2026", "last known". */
export function officialPpNote(p) {
  if (isEstimated(p)) return 'estimated from their plays';
  return p.ppSeen ? `last seen on osu! ${fmt.date(p.ppSeen)}` : 'last known';
}

/** The stats of a play: mods (none shown for nomod), grade, accuracy, combo, misses. */
export function scoreStats(s, { combo = true } = {}) {
  return html`${modString(s[S.MODS]) === 'NM' ? '' : modsBadges(s[S.MODS])}
    ${gradeBadge(s[S.GRADE])}
    <span class="acc">${fmt.acc(s[S.ACC])}</span>
    ${combo ? html`<span class="combo">${fmt.num(s[S.COMBO])}x</span>` : ''}
    <span class="miss ${s[S.MISS] ? 'miss-n' : 'miss-fc'}" title="${s[S.MISS] ? 'Misses' : 'Full combo'}">${s[S.MISS] ? html`${fmt.num(s[S.MISS])} ✕<span class="sr-only"> misses</span>` : 'FC'}</span>`;
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
      <span class="row-stats">${scoreStats(s)}</span>
      ${posBadge(pos)}
      ${ppText(s[S.PP])}
      <span class="faint" title="${fmt.dateTime(s[S.TIME])}">${scoreWhen(s, fmt.ago(s[S.TIME]))}</span>
    </div>
  </div>`;
}

// ---- Layout helpers ----------------------------------------------------------------------------------------

/**
 * A page heading: a plain H1 that says what the page is, then (optionally) an intro.
 */
export const pageHead = ({ title, intro, extra }) => html`<header class="page-head">
  <h1>${title}</h1>
  ${intro ? html`<p>${intro}</p>` : ''}
  ${extra ?? ''}
</header>`;

export const stat = (label, value, sub = '', cls = '') =>
  html`<div class="stat ${cls}"><div class="stat-label">${label}</div><div class="stat-value"><span class="stat-fit">${value}</span></div>${sub ? html`<div class="stat-sub">${sub}</div>` : ''}</div>`;

/** A strip of links between sibling pages (real URLs, so not an ARIA tablist). `label` names the landmark. */
export const tabs = (items, label = 'Sections') => html`<nav class="tabs" aria-label="${label}">${items.map(t =>
  html`<a href="${t.href}" class="${t.active ? 'active' : ''}" ${t.active ? raw('aria-current="page"') : ''}>${t.label}${t.count !== undefined ? html`<span class="count">${fmt.num(t.count)}</span>` : ''}</a>`)}</nav>`;

/**
 * A labelled row of toggle chips: `items` = [[value, label]]. Each chip is a button with aria-pressed, and the
 * visible label names the group. Update the state with setPressed().
 */
export const chipGroup = (label, attr, items, current) => html`<div class="chips" role="group" aria-label="${label}">
  <span class="chips-label" aria-hidden="true">${label}</span>
  ${items.map(([value, text]) => html`<button class="chip ${value === current ? 'active' : ''}" type="button" data-${raw(attr)}="${value}" aria-pressed="${String(value === current)}">${text}</button>`)}
</div>`;

/** Marks the chip (or other toggle) whose data-`attr` equals `value` as pressed, the rest as not. */
export function setPressed(scope, attr, value) {
  scope.querySelectorAll(`[data-${attr}]`).forEach(b => {
    const on = b.dataset[attr.replace(/-(\w)/g, (_, c) => c.toUpperCase())] === String(value);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

export const empty = text => html`<div class="empty">${text}</div>`;

/** An empty result after filtering, with a way back. Pages handle clicks on [data-clear]. */
export const emptyFiltered = text => html`<div class="empty"><p>${text}</p><button class="btn btn-small" type="button" data-clear>Clear filters</button></div>`;

/** "12 of 53,734 maps", or "53,734 maps" when nothing is filtered out. */
export const resultCount = (shown, total, one, many = `${one}s`) =>
  (shown === total ? fmt.plural(total, one, many) : `${fmt.num(shown)} of ${fmt.plural(total, one, many)}`);

/** Says `text` through the page's polite live region (#status in index.html), e.g. a new result count. */
export function announce(text) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 50);
}

/** The hash's query (#/maps?q=x&page=2) as an object. */
export const readQuery = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] ?? ''));

/**
 * Rewrites the hash's query in place, so filters, sort and page survive Back and can be shared. No history entry
 * and no re-render. Empty, false and default values (`defaults[key]`) are left out.
 */
export function writeQuery(params, defaults = {}) {
  const [path] = location.hash.split('?');
  const kept = Object.entries(params).filter(([k, v]) => v !== '' && v !== null && v !== undefined && v !== false && String(v) !== String(defaults[k] ?? ''));
  const q = String(new URLSearchParams(kept.map(([k, v]) => [k, v === true ? '1' : v])));
  history.replaceState(history.state, '', `${path || '#/'}${q ? `?${q}` : ''}`);
}

/** Opens and focuses the header player search, the same as pressing "/". */
export const openSearch = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const scrollBehavior = () => (reducedMotion() ? 'auto' : 'smooth');
/** Grey rows the height of score rows, held in place of a list that's still loading so the page doesn't jump. */
export const placeholderRows = (n = 6) => html`<div class="rows rows-placeholder" aria-hidden="true">${Array.from({ length: Math.min(n, 50) }, () => html`<div class="row row-placeholder"></div>`)}</div>`;

/** The loader: the Dan glyphs, 0 to Shin, climbing one window (site.css .climb). */
export const climber = () => html`<span class="climb" aria-hidden="true"><span class="climb-strip">${DAN_STAGES.map(s => html`<span>${s.glyph}</span>`)}</span></span>`;

export const loading = () => html`<div class="loading"><div class="center">${climber()}<div>${pick(LOADING)}</div></div>${placeholderRows()}</div>`;

/**
 * In-joke badges or map tags ({ name, tip }). Each is a toggle button: tapping it shows its explanation in the line
 * under the row (a "toggletip"), so it works on touch and is read out, unlike a title tooltip.
 * `show` keeps the row short: only the first `show` chips are visible, and a "+N more" button reveals the rest.
 */
export const funChips = (list, cls = '', { show = Infinity } = {}) => (list.length
  ? html`<div class="fun-chips-wrap ${cls}">
      <div class="fun-chips">${list.map((b, i) => html`<button class="fun-chip" type="button" aria-pressed="false" data-tip="${b.tip}" ${i >= show ? 'hidden' : ''}>${b.name}</button>`)}${list.length > show
        ? html`<button class="fun-chip fun-more" type="button" data-track="more badges">+${list.length - show} more</button>` : ''}</div>
      <p class="fun-tip" role="status" hidden></p>
    </div>`
  : '');

// One listener for every badge row on the site.
document.addEventListener('click', e => {
  const more = e.target.closest('.fun-more');
  if (more) {
    const row = more.parentElement;
    row.querySelectorAll('.fun-chip[hidden]').forEach(b => { b.hidden = false; });
    more.remove();
    row.querySelector('.fun-chip')?.focus();
    return;
  }
  const chip = e.target.closest('.fun-chip');
  const wraps = document.querySelectorAll('.fun-chips-wrap');
  wraps.forEach(wrap => {
    if (chip && wrap.contains(chip)) return;
    wrap.querySelectorAll('.fun-chip[aria-pressed="true"]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    wrap.querySelector('.fun-tip').hidden = true;
  });
  if (!chip) return;
  const wrap = chip.closest('.fun-chips-wrap');
  const tip = wrap.querySelector('.fun-tip');
  const open = chip.getAttribute('aria-pressed') !== 'true';
  wrap.querySelectorAll('.fun-chip').forEach(b => b.setAttribute('aria-pressed', String(b === chip && open)));
  tip.hidden = !open;
  tip.innerHTML = open ? String(html`<b>${chip.textContent}</b> ${chip.dataset.tip}`) : '';
});

/**
 * Renders `items` a page at a time into `container`, with previous/next buttons. `render(slice, offset)` returns
 * the markup for one page. Returns a function that re-renders from the first page (after a filter changes).
 * Options: `page` to start on (0-based, e.g. from the URL), `onPage(page)` when it changes, and `empty()` for the
 * markup when nothing matches. After paging, focus moves to the list and the new page is announced.
 */
export function paginate(container, items, render, size = 50, { page: start = 0, onPage, empty: emptyView } = {}) {
  let page = Math.max(0, start);
  const pages = () => Math.max(1, Math.ceil(items.length / size));
  const draw = () => {
    page = Math.min(page, pages() - 1);
    const slice = items.slice(page * size, page * size + size);
    container.innerHTML = String(html`${slice.length ? render(slice, page * size) : emptyView?.() ?? empty('Nothing to show.')}
      ${pages() > 1 ? html`<nav class="pager" aria-label="Pages">
        <button class="btn btn-small" type="button" data-page="prev" ${page === 0 ? raw('disabled') : ''}>← Previous</button>
        <span>Page ${page + 1} of ${pages()}</span>
        <button class="btn btn-small" type="button" data-page="next" ${page >= pages() - 1 ? raw('disabled') : ''}>Next →</button>
      </nav>` : ''}`);
  };
  container.addEventListener('click', e => {
    const button = e.target.closest('[data-page]');
    if (!button) return;
    page += button.dataset.page === 'next' ? 1 : -1;
    draw();
    onPage?.(page);
    // The clicked button is gone; put focus at the top of the new page instead of dropping it to <body>.
    container.tabIndex = -1;
    container.focus({ preventScroll: true });
    container.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    announce(`Page ${page + 1} of ${pages()}`);
  });
  draw();
  // keepPage: the same list in the same order, only longer (e.g. the full set arriving after a first slice).
  return (newItems, keepPage = false) => {
    items = newItems ?? items;
    page = keepPage ? Math.min(page, pages() - 1) : 0;
    draw();
    onPage?.(page);
  };
}

/**
 * Makes data tables usable by keyboard and screen readers: the scroll box becomes a labelled, focusable region,
 * tables get a caption and header cells a scope. Runs on whatever is in `scope`, so call it after rendering.
 */
export function enhanceTables(scope) {
  scope.querySelectorAll('.table-wrap:not([data-ok])').forEach(wrap => {
    wrap.dataset.ok = '';
    const table = wrap.querySelector('table');
    const label = wrap.dataset.label || headingBefore(wrap) || 'Table';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', label);
    wrap.tabIndex = 0;
    if (table && !table.caption) {
      const caption = table.createCaption();
      caption.className = 'sr-only';
      caption.textContent = label;
    }
    table?.querySelectorAll('thead th').forEach(th => th.setAttribute('scope', 'col'));
  });
}

/** The text of the nearest heading before `el` (siblings first, then up the tree). */
function headingBefore(el) {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
      const h = prev.matches('h1, h2, h3') ? prev : prev.querySelector('h1, h2, h3');
      if (h) return h.textContent.trim();
    }
  }
  return '';
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
