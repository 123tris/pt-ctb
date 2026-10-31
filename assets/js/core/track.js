// Usage counts, so we know who uses which parts of the site and what gets in their way. What's sent, why and for how
// long it's kept is on the privacy page (pages/privacy.js); the server side is usage/store.js, the owner's dashboard
// /stats.
//
// Each browser gets a random visitor id and a session id (localStorage, never derived from the device). When the
// visitor has said who they are on osu! ("This is me" or "Sign in with osu!"), batches carry that player id and how it
// was given. Search text is never sent, only its shape ("text, 3-5 characters"), since it can be anything.
//
// Off when: not on the site's own address (npm run serve, GitHub Pages), Do Not Track or Global Privacy Control is on,
// this browser opted out (the privacy page, or /stats, sets ptctb:notrack), or CONFIG.analyticsConsent asks first and
// the visitor hasn't said yes.
//
// Pages call nothing themselves: views and query changes come from the router and writeQuery, clicks and inputs are
// picked up here by delegation, timings and errors from the browser. Only a few modules report something by name
// (easter eggs, sign-in, game results, header search picks).

import { CONFIG } from '../config.js';
import { english } from './i18n.js';

const ENDPOINT = '/api/hit';
const FLUSH_MS = 15000;
const MAX_QUEUE = 20;
const SESSION_IDLE = 30 * 60 * 1000; // a new session after 30 minutes without an event
const ID_DAYS = 395; // a visitor id is replaced after ~13 months, however often it's used
const MAX_PER_LOAD = 400; // a runaway loop can't send more than this per page load
const MAX_ERRORS = 8;
const MAX_FETCHES = 15;
const QUERY_QUIET_MS = 1500; // a filter or search field is reported once it has been left alone this long

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(`ptctb:${key}`)); } catch { return null; } },
  set(key, value) { try { value === null ? localStorage.removeItem(`ptctb:${key}`) : localStorage.setItem(`ptctb:${key}`, JSON.stringify(value)); } catch { /* storage blocked */ } },
};

/** Why nothing is collected in this browser, or '' when it is: local, dnt, gpc, optout, consent. */
export function trackingBlock() {
  if (!CONFIG.home || location.origin !== CONFIG.home) return 'local';
  if (navigator.globalPrivacyControl === true) return 'gpc';
  if (navigator.doNotTrack === '1') return 'dnt';
  try { if (localStorage.getItem('ptctb:notrack') === '1') return 'optout'; } catch { /* storage blocked */ }
  if (CONFIG.analyticsConsent === 'all' && store.get('consent') !== 'yes') return 'consent';
  return '';
}
const enabled = () => !trackingBlock();

/** Stops collecting in this browser and forgets its ids; with `erase`, also asks the server to delete what it has. */
export function optOut({ erase = false } = {}) {
  const id = store.get('uid')?.id;
  queue = [];
  try { localStorage.setItem('ptctb:notrack', '1'); } catch { /* storage blocked */ }
  store.set('uid', null);
  store.set('session', null);
  if (erase && id) post(JSON.stringify({ forget: id }));
}

/** Collects again (a new visitor id; the old one isn't brought back). */
export function optIn() {
  try { localStorage.removeItem('ptctb:notrack'); } catch { /* storage blocked */ }
  if (CONFIG.analyticsConsent) store.set('consent', 'yes');
  if (!started) startTracking();
}

/** The consent prompt's answer (only asked when CONFIG.analyticsConsent is set). */
export function setConsent(yes) {
  store.set('consent', yes ? 'yes' : 'no');
  if (yes && !started) startTracking();
}

const hexId = bytes => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');

function visitorId() {
  let uid = store.get('uid');
  if (!uid?.id || !/^[0-9a-f]{16}$/.test(uid.id) || Date.now() - uid.t > ID_DAYS * 86400000) store.set('uid', uid = { id: hexId(8), t: Date.now() });
  return uid.id;
}

let sessionFirst = false;
/** This tab's session (shared with other tabs of the site), renewed after SESSION_IDLE without events. */
function sessionId() {
  const now = Date.now();
  let s = store.get('session');
  if (!s?.id || !/^[0-9a-f]{12}$/.test(s.id) || now - s.last > SESSION_IDLE) { s = { id: hexId(6) }; sessionFirst = true; }
  s.last = now;
  store.set('session', s);
  return s.id;
}

let playerName = '';
/** Called by core/you.js once it knows the name of the chosen player, so the dashboard can show it. */
export function identify(name) { playerName = String(name ?? '').slice(0, 30); }

/** Who this browser says it is: the "me" player id, and whether that came from an osu! sign-in (with its proof). */
function identity() {
  const me = store.get('me');
  if (!Number.isSafeInteger(me) || me <= 0) return {};
  if (CONFIG.analyticsConsent === 'identity' && store.get('consent') !== 'yes') return {};
  const osu = store.get('osuMe') === me;
  const proof = store.get('osuProof');
  return { p: me, w: osu ? 'osu' : 'claim', pr: osu && proof?.id === me ? proof.proof : undefined, pn: playerName || undefined };
}

let queue = [];
let timer = 0;
let sent = 0;
let started = false;
let page = '';
let pageObj = '';
let interacted = false;
let source = { area: '', at: 0 };
let firstView = true;

const device = () => (innerWidth < 600 ? 'phone' : innerWidth < 1024 ? 'tablet' : 'desktop');
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
const round10 = n => Math.round(n / 10) * 10;

function post(body) {
  const blob = new Blob([body], { type: 'application/json' });
  if (!navigator.sendBeacon?.(ENDPOINT, blob)) {
    fetch(ENDPOINT, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
  }
}

function flush() {
  clearTimeout(timer);
  timer = 0;
  if (!queue.length || !enabled()) { queue = []; return; }
  const batch = { id: visitorId(), s: sessionId(), d: device(), ...identity(), e: queue };
  batch.m = batch.p ? 1 : 0;
  if (sessionFirst) {
    // Sent once per session: what the screen and browser preferences look like (no exact screen, no fonts, no hardware).
    batch.f = 1;
    batch.c = { vw: round10(innerWidth), vh: round10(innerHeight), sc: matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark', ln: String(navigator.language || '').slice(0, 12) };
    sessionFirst = false;
  }
  queue = [];
  post(JSON.stringify(batch));
}

/**
 * Records one event. kind: view | dwell | seen | use | click | filter | search | out | egg | pref | auth | game | err |
 * perf | fetch. name and detail are short labels; value a number (milliseconds, a score); obj what the page is about
 * (p123 a player, m456 a map, p1|p2 a comparison).
 */
export function track(kind, name, detail = '', ref = '', value = null, obj = '') {
  if (!started || !enabled() || sent >= MAX_PER_LOAD) return;
  sent++;
  sessionId(); // keeps the session alive while events happen
  const ev = [kind, clean(name), clean(detail)];
  if (ref || value !== null || obj) ev.push(ref, value === null ? null : Math.round(value), obj);
  queue.push(ev);
  if (queue.length >= MAX_QUEUE) flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Where on the page a click or Enter happened, so a page view can say how the visitor got there. */
function areaOf(el) {
  if (!(el instanceof Element)) return '';
  if (el.closest('.search')) return 'search';
  if (el.closest('.you')) return 'you-menu';
  if (el.closest('.nav-menu')) return 'nav-menu';
  if (el.closest('.nav, .brand')) return 'nav';
  if (el.closest('.footer')) return 'footer';
  if (el.closest('#content')) return 'page';
  return '';
}

// Time on a page: only while the tab is visible, sent when the page is left or the tab hidden (and then resumed).
let shownAt = 0;
let shownFor = 0;
function sendDwell() {
  if (shownAt) shownFor += performance.now() - shownAt;
  shownAt = document.visibilityState === 'visible' ? performance.now() : 0;
  if (page && shownFor >= 1000) track('dwell', page, '', '', Math.min(shownFor, 30 * 60 * 1000), pageObj);
  shownFor = 0;
}

/**
 * Called by the router after a page has rendered. `key` names the page without ids ("player/loved", "map",
 * "games/guess"). The detail says how the visitor got there: nav, more-menu, search, page (a link in the page),
 * footer, you-menu, or "direct" (first page of the visit, a typed or shared link, Back/Forward). `ms` is how long the
 * page took from the address changing to drawn; `obj` what it's about (see track).
 */
export function trackView(key, { ms = null, obj = '' } = {}) {
  if (!firstView) reportLargestPaint(); // only the first page's largest paint counts: later ones are in-app navigation
  sendDwell();
  flushQuery();
  page = key;
  pageObj = obj;
  interacted = false;
  const via = Date.now() - source.at < 3000 && source.area ? source.area : 'direct';
  source = { area: '', at: 0 };
  let ref = '';
  if (firstView && document.referrer) {
    try { const host = new URL(document.referrer).hostname; if (host !== location.hostname) ref = host; } catch { /* no referrer */ }
  }
  firstView = false;
  track('view', key, via, ref, ms, obj);
  watchSections(key);
}

/** The shape of something typed, never the text: digits or text, and a length band. */
export function shapeOf(text) {
  const t = String(text ?? '').trim();
  if (!t) return 'empty';
  const len = t.length <= 2 ? '1-2' : t.length <= 5 ? '3-5' : t.length <= 10 ? '6-10' : '11+';
  return `${/^\d+$/.test(t) ? 'digits' : 'text'} ${len}`;
}

// Query keys that hold typed text: reported as a search with the text's shape only.
const TYPED = new Set(['q', 'search', 'query']);
let pendingQuery = new Map();
let queryTimer = 0;

function flushQuery() {
  clearTimeout(queryTimer);
  for (const [key, value] of pendingQuery) {
    if (TYPED.has(key)) track('search', page, `typed · ${shapeOf(value)}`);
    else if (value === undefined) track('filter', page, `${key} cleared`);
    else track('filter', page, /^[\w.-]{1,24}$/.test(value) ? `${key}=${value.replace(/\d+/g, '#')}` : key);
  }
  pendingQuery = new Map();
}

/** A filter, sort, tab or search field changed the query in place (core/ui.js writeQuery). */
function queryChanged({ before, after }) {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] !== after[key]) pendingQuery.set(key, after[key]);
  }
  clearTimeout(queryTimer);
  if (pendingQuery.size) queryTimer = setTimeout(flushQuery, QUERY_QUIET_MS);
}

let sectionWatcher = null;

/**
 * Notes each section heading (h2) of the page the first time it scrolls into view, so long pages (records, profiles,
 * challenges) show how far people actually read, not just that they opened the page.
 */
function watchSections(key) {
  sectionWatcher?.disconnect();
  if (!enabled() || !('IntersectionObserver' in window)) return;
  const seen = new Set();
  sectionWatcher = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting || seen.has(entry.target)) continue;
      seen.add(entry.target);
      sectionWatcher.unobserve(entry.target);
      track('seen', key, english(entry.target.textContent).replace(/\d+/g, '#'));
    }
  });
  document.querySelectorAll('#content h2').forEach(h => sectionWatcher.observe(h));
}

/**
 * Labels a pressed button by its visible text, in English whichever language the page is in (digits become #, so pages
 * and counts group together).
 */
function buttonLabel(el) {
  return english(String(el.getAttribute('data-track') || el.getAttribute('aria-label') || el.textContent || '')).replace(/\d+/g, '#');
}

// Errors: the message without addresses or numbers (so the same bug groups together), and the file and line.
let errors = 0;
const errorsSeen = new Set();
export function trackError(error, where = '') {
  const message = String(error?.message ?? error ?? 'unknown').replace(/https?:\/\/\S+/g, 'url').replace(/\d+/g, '#').slice(0, 60);
  if (errors >= MAX_ERRORS || errorsSeen.has(message)) return;
  errors++;
  errorsSeen.add(message);
  track('err', message, where || page);
}
const fileOf = name => String(name ?? '').split('?')[0].split('/').pop();

// Load timings of the first page: server response, first paint, largest paint, load.
let largestPaint = 0;
let paintOpen = true;
function reportLoad() {
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const entry = page || 'home';
  if (nav) {
    if (nav.responseStart > 0) track('perf', 'ttfb', entry, '', nav.responseStart);
    if (nav.loadEventEnd > 0) track('perf', 'load', entry, '', nav.loadEventEnd);
  }
  const fcp = performance.getEntriesByName?.('first-contentful-paint')?.[0];
  if (fcp) track('perf', 'fcp', entry, '', fcp.startTime);
}
function reportLargestPaint() {
  if (paintOpen && largestPaint) track('perf', 'lcp', page || 'home', '', largestPaint);
  paintOpen = false;
  largestPaint = 0;
}

// Data files from R2: how long each took (anything under 50 ms came from the browser's cache).
let fetches = 0;
function watchFetches() {
  if (!('PerformanceObserver' in window) || !CONFIG.data.startsWith('http')) return;
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!entry.name.startsWith(CONFIG.data) || entry.duration < 50 || fetches >= MAX_FETCHES) continue;
        fetches++;
        const file = entry.name.slice(CONFIG.data.length).split('?')[0].replace(/\.[A-Za-z0-9_-]{10}(\.[^./]+)$/, '$1').replace(/\d+/g, '#');
        track('fetch', file, page, '', entry.duration);
      }
    }).observe({ type: 'resource', buffered: true });
    new PerformanceObserver(list => { if (paintOpen) largestPaint = list.getEntries().at(-1)?.startTime ?? largestPaint; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* an older browser without these entry types */ }
}

export function startTracking() {
  if (started || !enabled()) return;
  started = true;
  const note = e => { source = { area: areaOf(e.target), at: Date.now() }; };
  document.addEventListener('click', e => {
    note(e);
    const t = e.target instanceof Element ? e.target : null;
    const link = t?.closest('a[href]');
    if (link) {
      const url = new URL(link.href, location.href);
      // Links out: the site and the first part of the path (osu.ppy.sh/beatmapsets, osu.ppy.sh/users), never the rest.
      if (url.origin !== location.origin) track('out', `${url.hostname}/${url.pathname.split('/')[1] ?? ''}`.replace(/\/$/, ''), page);
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
  const QUIET_PREFS = new Set(['signin', 'osuProof', 'daily', 'consent']);
  window.addEventListener('ptctb:pref', e => {
    if (!QUIET_PREFS.has(e.detail.key) && !e.detail.key.endsWith('-best')) track('pref', e.detail.key, e.detail.value ? 'on' : 'off');
  });
  window.addEventListener('ptctb:query', e => queryChanged(e.detail));
  window.addEventListener('error', e => trackError(e.error ?? e.message, `${fileOf(e.filename)}:${e.lineno ?? 0}`));
  window.addEventListener('unhandledrejection', e => trackError(e.reason, 'promise'));
  watchFetches();
  if (document.readyState === 'complete') setTimeout(reportLoad);
  else addEventListener('load', () => setTimeout(reportLoad), { once: true });
  shownAt = document.visibilityState === 'visible' ? performance.now() : 0;
  const leave = () => { flushQuery(); sendDwell(); reportLargestPaint(); flush(); };
  addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave();
    else shownAt = performance.now();
  });
}
