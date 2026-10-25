// Hash router: #/player/123?tab=x → pages/player.js. GitHub Pages can't rewrite paths, so every page lives
// behind the hash and index.html is the only document.

import { html } from './core/html.js';
import { meta, NotFound } from './core/data.js';
import { loading, setTitle, enhanceTables, openSearch } from './core/ui.js';
import { NOT_FOUND, pick } from './core/lore.js';
import { startFun } from './core/fun.js';
import { initSearch } from './core/search.js';
import { initYou } from './core/you.js';
import { startTracking, trackView } from './core/track.js';
import * as fmt from './core/fmt.js';
import { CONFIG } from './config.js';

const ROUTES = [
  ['', () => import('./pages/home.js')],
  ['rankings/:board?', () => import('./pages/rankings.js')],
  ['players', () => import('./pages/players.js')],
  ['player/:id/:tab?', () => import('./pages/player.js')],
  ['maps', () => import('./pages/maps.js')],
  ['map/:id', () => import('./pages/map.js')],
  ['activity', () => import('./pages/activity.js')],
  ['challenges/:tab?', () => import('./pages/challenges.js')],
  ['games/:game?', () => import('./pages/games.js')],
  ['calculator', () => import('./pages/calculator.js')],
  ['compare/:a?/:b?', () => import('./pages/compare.js')],
  ['records', () => import('./pages/records.js')],
  ['recap/:id/:year?', () => import('./pages/wrapped.js')],
  ['commands', () => import('./pages/commands.js')],
  ['join', () => import('./pages/join.js')],
  ['team', () => import('./pages/team.js')],
  ['glossary', () => import('./pages/glossary.js')],
];

/** Old addresses that moved: the Dan course is now a tab of Challenges (#/dan?stage=3 → #/challenges/dan?stage=3). */
const MOVED = { dan: 'challenges/dan', verify: 'join' };

function match(path) {
  const parts = path.split('/').filter(Boolean);
  for (const [pattern, load] of ROUTES) {
    const keys = pattern.split('/').filter(Boolean);
    const params = {};
    let ok = parts.length <= keys.length;
    for (let i = 0; ok && i < keys.length; i++) {
      const key = keys[i];
      if (key.startsWith(':')) {
        const optional = key.endsWith('?');
        if (parts[i] === undefined && !optional) ok = false;
        else if (parts[i] !== undefined) params[key.slice(1).replace('?', '')] = decodeURIComponent(parts[i]);
      } else if (parts[i] !== key) ok = false;
    }
    if (ok) return { load, params, pattern };
  }
  return null;
}

// Route parts that are ids, left out of the usage key so "which pages get used" doesn't split by player or map.
const ID_PARAMS = new Set(['id', 'a', 'b', 'year']);

/** The page's name for the usage counts: the route without ids, plus a sub-view kept in the query (?view, ?mode). */
function pageKey(found, path, query) {
  const parts = path.split('/').filter(Boolean);
  const keys = found.pattern.split('/').filter(Boolean);
  const name = keys.map((k, i) => (!k.startsWith(':') ? k : ID_PARAMS.has(k.slice(1).replace('?', '')) ? '' : parts[i] ?? ''))
    .filter(Boolean).join('/') || 'home';
  if (found.pattern.startsWith('compare')) return `${name}${found.params.b ? '/pair' : found.params.a ? '/one' : ''}`;
  const extra = query.view || query.mode;
  return extra ? `${name}/${extra}` : name;
}

const root = document.getElementById('content');
let current = 0;

/**
 * Renders the page for the current hash. `newPage` (a different path, not just a new query) moves focus to the new
 * page's heading, so keyboard and screen-reader users land on it and hear it, instead of staying on the old link.
 */
async function route({ newPage = false } = {}) {
  const ticket = ++current;
  let [path, search = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const moved = MOVED[path.split('/')[0]];
  if (moved) {
    path = [moved, ...path.split('/').slice(1)].join('/');
    history.replaceState(history.state, '', `#/${path}${search ? `?${search}` : ''}`);
    lastPath = location.hash.split('?')[0];
  }
  const query = Object.fromEntries(new URLSearchParams(search));
  const section = path.split('/')[0];

  markNav(section);
  closeMenus();

  const found = match(path);
  if (!found) trackView('not-found');
  if (!found) return showError('Page not found', `${pick(NOT_FOUND)} Try the search, or go back to the home page.`, { newPage });

  const spinner = setTimeout(() => { if (ticket === current) root.innerHTML = String(loading()); }, 150);
  root.setAttribute('aria-busy', 'true');
  try {
    const page = (await found.load()).default;
    if (ticket !== current) return;
    await page(root, { params: found.params, query, isCurrent: () => ticket === current });
    if (ticket === current && newPage) focusHeading();
    // One view per page opened (a filter or sort that only changes the query isn't a new view).
    if (ticket === current && (newPage || ticket === 1)) trackView(pageKey(found, path, query));
  } catch (e) {
    if (ticket !== current) return;
    console.error(e);
    if (e instanceof NotFound) {
      if (section === 'player' || section === 'recap') showError('Never heard of them!', 'There’s no Portuguese player with this id. They may not be tracked yet, or the link has a typo.', { newPage, players: true });
      else showError('Not found', 'There’s no data for this. The map may not be tracked yet.', { newPage });
    }
    else showError('Something went wrong', e.message, { newPage });
  } finally {
    clearTimeout(spinner);
    if (ticket === current) root.removeAttribute('aria-busy');
  }
}

function focusHeading() {
  const heading = root.querySelector('h1');
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

function showError(title, text, { newPage = false, players = false } = {}) {
  setTitle(title);
  root.innerHTML = String(html`<div class="empty"><h1>${title}</h1><p>${text}</p>
    <div class="btn-row" style="justify-content:center">
      <button class="btn btn-primary" type="button" data-open-search>Search players</button>
      ${players ? html`<a class="btn" href="#/players">Browse all players</a>` : ''}
      <a class="btn" href="#/">Go to the home page</a>
    </div></div>`);
  root.querySelector('[data-open-search]').addEventListener('click', openSearch);
  if (newPage) focusHeading();
}

/** Marks the current section in the main nav (class and aria-current), and "More" when one of its pages is open. */
function markNav(section) {
  document.querySelectorAll('.nav a').forEach(a => {
    // Strictly true/false: classList.toggle(name, undefined) flips the class instead of removing it, and links
    // without a section (More's "Dan course" shortcut) would otherwise light up every other route.
    const on = Boolean(section && a.dataset.section?.split(' ').includes(section));
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.querySelector('.nav-more-btn')?.classList.toggle('active', Boolean(document.querySelector('.nav-more-menu a.active')));
}

// ---- Navigation menus ------------------------------------------------------------------------------------

const nav = document.getElementById('nav');
const toggle = document.querySelector('.nav-toggle');
const more = document.querySelector('.nav-more');

const moreButton = more.querySelector('button');

// "More" is a disclosure: aria-expanded always matches what's on screen, and Escape, an outside click or tabbing
// away closes it.
function setMore(open) {
  more.classList.toggle('open', open);
  moreButton.setAttribute('aria-expanded', String(open));
}

function closeMenus() {
  nav.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
  setMore(false);
}

toggle.addEventListener('click', () => {
  const open = !nav.classList.contains('open');
  nav.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
});
moreButton.addEventListener('click', e => {
  e.stopPropagation();
  setMore(!more.classList.contains('open'));
});
document.addEventListener('click', e => { if (!more.contains(e.target)) setMore(false); });
more.addEventListener('focusout', e => { if (!more.contains(e.relatedTarget)) setMore(false); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (more.classList.contains('open')) { setMore(false); moreButton.focus(); }
  else if (nav.classList.contains('open') && nav.contains(document.activeElement)) { closeMenus(); toggle.focus(); }
});

// "Skip to content" focuses the page rather than following #content, which the router would treat as a route.
document.querySelector('.skip')?.addEventListener('click', e => { e.preventDefault(); root.focus(); });

// Scroll to the top on a new page, but not when only the query changes (e.g. a filter on the same page).
let lastPath = null;
window.addEventListener('hashchange', () => {
  const path = location.hash.split('?')[0];
  const newPage = path !== lastPath;
  if (newPage) window.scrollTo({ top: 0, behavior: 'instant' });
  lastPath = path;
  route({ newPage });
});
lastPath = location.hash.split('?')[0];
route();
// Tables are rendered by many pages, some after the fact (paging, filters): label each one as it appears.
new MutationObserver(() => enhanceTables(root)).observe(root, { childList: true, subtree: true });
startFun();
initSearch();
initYou();
startTracking();

if (CONFIG.discordInvite) {
  document.getElementById('footer-links')?.insertAdjacentHTML('afterbegin',
    String(html`<a class="btn btn-small btn-discord" href="${CONFIG.discordInvite}" target="_blank" rel="noopener">Join the Discord</a>`));
}

meta().then(m => {
  const footer = document.getElementById('freshness');
  footer.textContent = `Data updated ${fmt.ago(m.generatedAt)}.`;
  footer.title = fmt.dateTime(m.generatedAt);
  if (CONFIG.repository) footer.insertAdjacentHTML('afterend', String(html` <a class="dim-link" href="${CONFIG.repository}">Source on GitHub</a>.`));
}).catch(() => {});
