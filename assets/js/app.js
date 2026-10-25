// Hash router: #/player/123?tab=x → pages/player.js. GitHub Pages can't rewrite paths, so every page lives
// behind the hash and index.html is the only document.

import { html } from './core/html.js';
import { meta, NotFound } from './core/data.js';
import { loading, setTitle } from './core/ui.js';
import { NOT_FOUND, pick } from './core/lore.js';
import { startFun } from './core/fun.js';
import { initSearch } from './core/search.js';
import { initYou } from './core/you.js';
import * as fmt from './core/fmt.js';
import { CONFIG } from './config.js';

const ROUTES = [
  ['', () => import('./pages/home.js')],
  ['rankings/:board?', () => import('./pages/rankings.js')],
  ['players', () => import('./pages/players.js')],
  ['player/:id/:tab?', () => import('./pages/player.js')],
  ['maps', () => import('./pages/maps.js')],
  ['map/:id', () => import('./pages/map.js')],
  ['dan', () => import('./pages/dan.js')],
  ['activity', () => import('./pages/activity.js')],
  ['challenges', () => import('./pages/challenges.js')],
  ['games/:game?', () => import('./pages/games.js')],
  ['calculator', () => import('./pages/calculator.js')],
  ['compare/:a?/:b?', () => import('./pages/compare.js')],
  ['records', () => import('./pages/records.js')],
  ['recap/:id/:year?', () => import('./pages/wrapped.js')],
  ['commands', () => import('./pages/commands.js')],
  ['verify', () => import('./pages/verify.js')],
  ['team', () => import('./pages/team.js')],
];

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
    if (ok) return { load, params };
  }
  return null;
}

const root = document.getElementById('content');
let current = 0;

async function route() {
  const ticket = ++current;
  const [path, search = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const query = Object.fromEntries(new URLSearchParams(search));
  const section = path.split('/')[0];

  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.section?.split(' ').includes(section)));
  closeMenus();

  const found = match(path);
  if (!found) return showError('Page not found', `${pick(NOT_FOUND)} Try going back to the home page.`);

  const spinner = setTimeout(() => { if (ticket === current) root.innerHTML = String(loading()); }, 150);
  try {
    const page = (await found.load()).default;
    if (ticket !== current) return;
    await page(root, { params: found.params, query, isCurrent: () => ticket === current });
  } catch (e) {
    if (ticket !== current) return;
    console.error(e);
    if (e instanceof NotFound) {
      if (section === 'player' || section === 'recap') showError('Never heard of him!', 'There’s no Portuguese player with this id. They may not be tracked yet.');
      else showError('Not found', 'There’s no data for this. The map may not be tracked yet.');
    }
    else showError('Something went wrong', e.message);
  } finally {
    clearTimeout(spinner);
  }
}

function showError(title, text) {
  setTitle(title);
  root.innerHTML = String(html`<div class="empty"><h2>${title}</h2><p>${text}</p><a class="btn" href="#/">Go to the home page</a></div>`);
}

// ---- Navigation menus ------------------------------------------------------------------------------------

const nav = document.getElementById('nav');
const toggle = document.querySelector('.nav-toggle');
const more = document.querySelector('.nav-more');

function closeMenus() {
  nav.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
  more.classList.remove('open');
  more.querySelector('button').setAttribute('aria-expanded', 'false');
}

toggle.addEventListener('click', () => {
  const open = !nav.classList.contains('open');
  nav.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
});
more.querySelector('button').addEventListener('click', e => {
  e.stopPropagation();
  const open = !more.classList.contains('open');
  more.classList.toggle('open', open);
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', e => { if (!more.contains(e.target)) more.classList.remove('open'); });

// "Skip to content" focuses the page rather than following #content, which the router would treat as a route.
document.querySelector('.skip')?.addEventListener('click', e => { e.preventDefault(); root.focus(); });

// Scroll to the top on a new page, but not when only the query changes (e.g. a filter on the same page).
let lastPath = null;
window.addEventListener('hashchange', () => {
  const path = location.hash.split('?')[0];
  if (path !== lastPath) window.scrollTo({ top: 0, behavior: 'instant' });
  lastPath = path;
  route();
});
lastPath = location.hash.split('?')[0];
route();
startFun();
initSearch();
initYou();

meta().then(m => {
  const footer = document.getElementById('freshness');
  footer.textContent = `Data updated ${fmt.ago(m.generatedAt)}.`;
  footer.title = fmt.dateTime(m.generatedAt);
  if (CONFIG.repository) footer.insertAdjacentHTML('afterend', String(html` <a class="dim-link" href="${CONFIG.repository}">Source on GitHub</a>.`));
}).catch(() => {});
