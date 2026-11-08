// The app: the router and what's around every page (the top bar's menus, search and You menu, the language switch, the
// footer), as assets/js/app.js has it. Path router: /player/123?tab=x → entries/player.ts. index.html is the only
// document: Cloudflare Pages answers every page address with it (functions/[[path]].js, which also writes the page's
// link preview and its data's addresses into it), and links between pages are followed here, without a reload. Old
// #/player/123 links still work: they're turned into the path on load.
//
// index.html loads this, and the old app (assets/js/app.js) only when this can't load: the github.io copy, served from
// the repo as it is, has no assets/web.

import { html } from './kernel/html.ts';
import type { Ctx } from './kernel/ctx.ts';
import { PAGE_MODULES, match, moved as unmoved, pageKey, pageObject, pageOf, type Found, type Query } from './pages.ts';
import { oldPage, type RouterPage } from './client/page.ts';
import {
  CONFIG, lang, htmlLang, setLang, store, clientCtx, here, go, setTitle, enhanceTables, openSearch, startTips, checkOldUi,
  startTracking, trackView, trackError, startFun, initSearch, initYou, readSignIn, initReveal, initConsent, moved,
  NotFound, loading, notFoundQuips, pick,
} from './client/shell.ts';

// Before anything can fail: index.html's next script loads the old app unless this says the new one is running.
(globalThis as { ptctbApp?: boolean }).ptctbApp = true;

/**
 * A page's module: its entry in the new client (a chunk of its own, loaded when the page is first opened), or the old
 * page (pages.ts PAGE_MODULES) where that won't load.
 */
async function pageModule(pattern: string): Promise<RouterPage> {
  const { entry, old } = PAGE_MODULES[pattern];
  try {
    return (await import(`./entries/${entry}.ts`)).default as RouterPage;
  } catch (e) {
    // A page of the new client's only (no old page): the router's error page.
    if (!old) throw e;
    console.warn(`${entry}: the old page stands in:`, e);
    return oldPage(old);
  }
}

/** The data's NotFound, or the old pages' own (assets/js/core/data.js), which they throw when they stand in. */
const isNotFound = (e: unknown) => e instanceof NotFound || (e as Error | null)?.constructor?.name === 'NotFound';

const root = document.getElementById('content')!;
const nav = document.getElementById('nav')!;
const toggle = document.querySelector<HTMLElement>('.nav-toggle')!;
let ctx: Ctx;
let current = 0;
let lastPath: string | null = null;

/**
 * Draws the page for the current address. `newPage` (a different path, not just a new query) moves focus to the new
 * page's heading, so keyboard and screen-reader users land on it and hear it, instead of staying on the old link.
 * `newView` is a switch of sub-view on the same page (pages.ts SUB_VIEWS): counted as a view, but drawn in place.
 */
async function route({ newPage = false, newView = false } = {}): Promise<void> {
  const { t } = ctx;
  const ticket = ++current;
  const started = performance.now();
  let path = location.pathname.replace(/^\/+/, '');
  const search = location.search.slice(1);
  if (unmoved(path) !== path) {
    path = unmoved(path);
    history.replaceState(history.state, '', `/${path}${location.search}`);
    lastPath = location.pathname;
  }
  const query: Query = Object.fromEntries(new URLSearchParams(search));
  const section = path.split('/')[0];

  markNav(section);
  closeMenus();

  const found: Found | null = match(path);
  if (!found) trackView('not-found');
  if (!found) return showError(t('Page not found'), `${pick(notFoundQuips(ctx))} ${t('Try the search, or go back to the home page.')}`, { newPage, glyph: 'ש' });

  const spinner = setTimeout(() => {
    if (ticket !== current) return;
    if (newView) root.classList.add('switching');
    else root.innerHTML = String(loading(ctx));
  }, 150);
  const focused = newView && root.contains(document.activeElement);
  root.setAttribute('aria-busy', 'true');
  try {
    const page = await pageModule(found.pattern);
    if (ticket !== current) return;
    await page(root, { params: found.params, query, isCurrent: () => ticket === current });
    checkOldUi();
    if (ticket === current && newPage) focusHeading();
    // A page that redrew itself whole took the picked tab (and its focus) with it: back to the new one.
    if (ticket === current && focused && !root.contains(document.activeElement)) root.querySelector<HTMLElement>('.tabs [aria-current="page"]')?.focus({ preventScroll: true });
    // One view per page opened (a filter or sort that only changes the query isn't a new view).
    if (ticket === current && (newPage || newView || ticket === 1)) trackView(pageKey(found, path, query), { ms: performance.now() - started, obj: pageObject(found) });
  } catch (e) {
    if (ticket !== current) return;
    console.error(e);
    if (isNotFound(e)) {
      if (section === 'player' || section === 'recap') showError(t('Never heard of them!'), t('There’s no Portuguese player with this id. They may not be tracked yet, or the link has a typo.'), { newPage, players: true });
      else if (section === 'duel') showError(t('No such duel'), t('There’s no duel with this number. It may not be in the data yet, or the link has a typo.'), { newPage });
      else showError(t('Not found'), t('There’s no data for this. The map may not be tracked yet.'), { newPage });
    } else {
      trackError(e, pageKey(found, path, query));
      showError(t('This page didn’t load'), t('The site couldn’t get its data: the connection may have dropped, or the data was being updated. Reload the page in a minute.'), { newPage, detail: (e as Error | null)?.message ?? String(e) });
    }
  } finally {
    clearTimeout(spinner);
    if (ticket === current) {
      root.removeAttribute('aria-busy');
      root.classList.remove('switching');
    }
  }
}

function focusHeading(): void {
  const heading = root.querySelector('h1');
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

/**
 * An error page: what went wrong, why, and what to do (DESIGN.md §8). `detail` is the technical cause, in small print for
 * bug reports; `glyph` puts a Dan glyph above it (Shin, the stage nobody has reached, for a page that isn't there).
 */
function showError(title: string, text: string, { newPage = false, players = false, glyph = '', detail = '' } = {}): void {
  const { t } = ctx;
  setTitle(title);
  root.innerHTML = String(html`<div class="empty">${glyph ? html`<div class="lost-glyph" aria-hidden="true">${glyph}</div>` : ''}<h1>${title}</h1><p>${text}</p>${detail ? html`<p class="small faint">${detail}</p>` : ''}
    <div class="btn-row justify-center">
      <button class="btn btn-primary" type="button" data-open-search>${t('Search players')}</button>
      ${players ? html`<a class="btn" href="/players">${t('Browse all players')}</a>` : ''}
      <a class="btn" href="/">${t('Go to the home page')}</a>
    </div></div>`);
  root.querySelector('[data-open-search]')!.addEventListener('click', openSearch);
  if (newPage) focusHeading();
}

/**
 * Marks the current category in the main nav (class and aria-current on its name) and, in its menu, the page that's
 * open: the link matching the whole address, or else the one matching its path (/activity for /activity?kind=x).
 */
function markNav(section: string): void {
  document.querySelectorAll<HTMLElement>('.nav-top').forEach(a => {
    // Strictly true/false: classList.toggle(name, undefined) flips the class instead of removing it.
    const on = Boolean(section && a.dataset.section?.split(' ').includes(section));
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const address = here();
  const path = location.pathname;
  document.querySelectorAll('.nav-menu').forEach(menu => {
    const links = [...menu.querySelectorAll('a')];
    const now = links.find(a => a.getAttribute('href') === address) ?? links.find(a => a.getAttribute('href') === path);
    links.forEach(a => a.classList.toggle('current', a === now));
  });
}

function closeMenus(): void {
  nav.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
}

// An old #/player/123 address (a link from before the site had paths, or one still written that way) becomes the path.
function fromHash(): boolean {
  if (!location.hash.startsWith('#/')) return false;
  history.replaceState(history.state, '', `/${location.hash.slice(2)}`);
  return true;
}

/** index.html is written in English; this puts its text, the nav and the footer, in the visitor's language. */
function translatePage({ t }: Ctx): void {
  // data-t marks an element whose text to translate, data-t-html one whose markup (ours, so trusted) to translate, and
  // data-t-label one whose aria-label to translate.
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.textContent!.trim()); });
  document.querySelectorAll('[data-t-html]').forEach(el => { el.innerHTML = t(el.innerHTML.trim()); });
  document.querySelectorAll('[data-t-label]').forEach(el => el.setAttribute('aria-label', t(el.getAttribute('aria-label')!)));
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('Portugal’s osu!catch community: leaderboards, player profiles, the Dan course, weekly challenges and games.'));

  // The EN / PT switch at the end of the nav: the current language is pressed, and the other reloads the page in it.
  document.querySelectorAll<HTMLElement>('[data-lang]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
    button.addEventListener('click', () => setLang(button.dataset.lang!));
  });
}

/** The nav's menus: the mobile toggle, a category's menu on hover or focus, Escape, and the skip link. */
function wireNav(): void {
  toggle.addEventListener('click', () => {
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });

  // A category's menu opens on hover or keyboard focus (site.css). After a pick from it, or Escape, it stays shut until
  // the pointer or focus leaves the category, so it doesn't hang over the page that just opened.
  document.querySelectorAll('.nav-cat').forEach(cat => {
    cat.addEventListener('click', e => { if ((e.target as Element).closest('.nav-menu a')) cat.classList.add('shut'); });
    cat.addEventListener('mouseleave', () => cat.classList.remove('shut'));
    cat.addEventListener('focusout', e => { if (!cat.contains((e as FocusEvent).relatedTarget as Node | null)) cat.classList.remove('shut'); });
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const cat = document.activeElement?.closest('.nav-cat');
    if (cat && !nav.classList.contains('open')) { cat.classList.add('shut'); cat.querySelector<HTMLElement>('.nav-top')!.focus(); }
    else if (nav.classList.contains('open') && nav.contains(document.activeElement)) { closeMenus(); toggle.focus(); }
  });

  // "Skip to content" focuses the page rather than following #content, which would put a hash in the address.
  document.querySelector('.skip')?.addEventListener('click', e => { e.preventDefault(); root.focus(); });
}

/** Moving between the site's pages: its own links, Back and Forward, and old #/ addresses typed into the bar. */
function wireLinks(): void {
  // Links to the site's own pages open here without a reload (client/ui.ts go()). New tabs, downloads, other sites and
  // the addresses that aren't pages (/auth, /api, /stats) are left to the browser.
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !match(unmoved(url.pathname.replace(/^\/+/, '')))) return;
    if (url.hash && url.pathname === location.pathname && url.search === location.search) return;
    e.preventDefault();
    go(url.pathname + url.search);
  });
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('routechange')));
  window.addEventListener('hashchange', () => { if (fromHash()) window.dispatchEvent(new Event('routechange')); });

  // Scroll to the top on a new page, but not when only the query changes (e.g. a filter on the same page).
  window.addEventListener('routechange', () => {
    const path = location.pathname;
    const newPage = path !== lastPath && pageOf(path) !== pageOf(lastPath);
    const newView = path !== lastPath && !newPage;
    if (newPage) window.scrollTo({ top: 0, behavior: 'instant' });
    lastPath = path;
    route({ newPage, newView });
  });
}

/** The footer: the Discord invite, and when the data was last updated, with the source's address. */
function footer({ t, fmt }: Ctx): void {
  if (CONFIG.discordInvite) {
    document.getElementById('footer-links')?.insertAdjacentHTML('afterbegin',
      String(html`<a class="btn btn-small" href="${CONFIG.discordInvite}" target="_blank" rel="noopener">${t('Join the Discord')}</a>`));
  }
  store.generatedAt().then(at => {
    const freshness = document.getElementById('freshness')!;
    freshness.textContent = t('Data updated {ago}.', { ago: fmt.ago(at) });
    freshness.title = fmt.dateTime(at);
    if (CONFIG.repository) freshness.insertAdjacentHTML('afterend', String(html` <a class="dim-link" href="${CONFIG.repository}">${t('Source on GitHub')}</a>.`));
  }).catch(() => {});
}

// The address first: leaving the github.io copy, the sign-in's answer from osu! (#signin?…) and an old #/ address.
moved();
const signedIn = readSignIn();
fromHash();
document.documentElement.lang = htmlLang;

// Hide images marked data-hide-broken (avatars, covers) that fail to load. One capture-phase listener, since error
// doesn't bubble and the CSP in _headers blocks inline onerror handlers.
document.addEventListener('error', e => {
  if (e.target instanceof HTMLImageElement && e.target.hasAttribute('data-hide-broken')) e.target.style.visibility = 'hidden';
}, true);

// Then the strings (pt.js for Portuguese), before anything is drawn, as the old app waited for them.
clientCtx().then(c => {
  ctx = c;
  translatePage(ctx);
  wireNav();
  startTips();
  wireLinks();
  lastPath = location.pathname;
  startTracking();
  route();
  // Tables are drawn by many pages, some after the fact (paging, filters): label each one as it appears.
  new MutationObserver(() => enhanceTables(root)).observe(root, { childList: true, subtree: true });
  startFun(ctx);
  initSearch(ctx);
  initYou(ctx, signedIn);
  initReveal();
  initConsent(ctx);
  footer(ctx);
});
