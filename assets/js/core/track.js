// Anonymous usage counts, so we know which parts of the site people actually use (and which could go). No cookies,
// nothing stored on the visitor's device, no ids: each event is just "this page was viewed" or "this button was
// pressed", plus the screen size class and whether "This is me" is set (not who). The server adds the country and
// a visitor hash that changes every day (functions/api/hit.js, usage/track.js). The owner's dashboard is /stats.
//
// Off when: not on the site's own address (npm run serve, GitHub Pages), Do Not Track or Global Privacy Control is on,
// or this browser opted out (/stats has the switch, which sets ptctb:notrack).
//
// Pages call nothing themselves: views come from the router, clicks and inputs are picked up here by delegation.
// Only fun.js reports its easter eggs by name.

import { CONFIG } from '../config.js';

const ENDPOINT = '/api/hit';
const FLUSH_MS = 15000;
const MAX_QUEUE = 20;

const optedOut = () => {
  try { if (localStorage.getItem('ptctb:notrack') === '1') return true; } catch { /* storage blocked */ }
  return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
};
const enabled = Boolean(CONFIG.home) && location.origin === CONFIG.home && !optedOut();

let queue = [];
let timer = 0;
let page = '';
let interacted = false;
let source = { area: '', at: 0 };
let firstView = true;

const device = () => (innerWidth < 600 ? 'phone' : innerWidth < 1024 ? 'tablet' : 'desktop');
const isMe = () => { try { return localStorage.getItem('ptctb:me') ? 1 : 0; } catch { return 0; } };
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);

function flush() {
  clearTimeout(timer);
  timer = 0;
  if (!queue.length) return;
  const body = JSON.stringify({ e: queue, d: device(), m: isMe() });
  queue = [];
  const blob = new Blob([body], { type: 'application/json' });
  if (!navigator.sendBeacon?.(ENDPOINT, blob)) {
    fetch(ENDPOINT, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
  }
}

/** Records one event: kind is view | seen | use | click | out | egg | pref; name and detail are short labels. */
export function track(kind, name, detail = '', ref = '') {
  if (!enabled) return;
  queue.push(ref ? [kind, clean(name), clean(detail), ref] : [kind, clean(name), clean(detail)]);
  if (queue.length >= MAX_QUEUE) flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Where on the page a click or Enter happened, so a page view can say how the visitor got there. */
function areaOf(el) {
  if (!(el instanceof Element)) return '';
  if (el.closest('.search')) return 'search';
  if (el.closest('.you')) return 'you-menu';
  if (el.closest('.nav-more-menu')) return 'more-menu';
  if (el.closest('.nav, .brand')) return 'nav';
  if (el.closest('.footer')) return 'footer';
  if (el.closest('#content')) return 'page';
  return '';
}

/**
 * Called by the router after a page has rendered. `key` names the page without ids ("player/loved", "map",
 * "games/guess"). The detail says how the visitor got there: nav, more-menu, search, page (a link in the page),
 * footer, you-menu, or "direct" (first page of the visit, a typed or shared link, Back/Forward).
 */
export function trackView(key) {
  page = key;
  interacted = false;
  const via = Date.now() - source.at < 3000 && source.area ? source.area : 'direct';
  source = { area: '', at: 0 };
  let ref = '';
  if (firstView && document.referrer) {
    try { const host = new URL(document.referrer).hostname; if (host !== location.hostname) ref = host; } catch { /* no referrer */ }
  }
  firstView = false;
  track('view', key, via, ref);
  watchSections(key);
}

let sectionWatcher = null;

/**
 * Notes each section heading (h2) of the page the first time it scrolls into view, so long pages (records, profiles,
 * challenges) show how far people actually read, not just that they opened the page.
 */
function watchSections(key) {
  sectionWatcher?.disconnect();
  if (!enabled || !('IntersectionObserver' in window)) return;
  const seen = new Set();
  sectionWatcher = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting || seen.has(entry.target)) continue;
      seen.add(entry.target);
      sectionWatcher.unobserve(entry.target);
      track('seen', key, entry.target.textContent.replace(/\d+/g, '#'));
    }
  });
  document.querySelectorAll('#content h2').forEach(h => sectionWatcher.observe(h));
}

/** Labels a pressed button by its visible text (digits become #, so pages and counts group together). */
function buttonLabel(el) {
  return String(el.getAttribute('data-track') || el.getAttribute('aria-label') || el.textContent || '').replace(/\d+/g, '#');
}

export function startTracking() {
  if (!enabled) return;
  const note = e => { source = { area: areaOf(e.target), at: Date.now() }; };
  document.addEventListener('click', e => {
    note(e);
    const t = e.target instanceof Element ? e.target : null;
    const link = t?.closest('a[href]');
    if (link) {
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) track('out', url.hostname, page);
      return;
    }
    const button = t?.closest('button, [role="button"], summary, input[type="checkbox"], input[type="radio"]');
    if (button && !button.closest('.search, .nav, .nav-toggle')) track('click', page, buttonLabel(button));
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Enter') note(e); }, true);
  // The first time a visitor types into or changes a control on a page counts as "used it" (once per page view).
  const used = e => {
    if (interacted || !(e.target instanceof Element) || !e.target.closest('#content')) return;
    interacted = true;
    track('use', page, e.target.getAttribute('aria-label') || e.target.getAttribute('name') || e.target.getAttribute('type') || '');
  };
  document.addEventListener('input', used, true);
  document.addEventListener('change', used, true);
  window.addEventListener('ptctb:pref', e => track('pref', e.detail.key, e.detail.value ? 'on' : 'off'));
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}
