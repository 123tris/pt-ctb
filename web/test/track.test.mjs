// node --test web/test/track.test.mjs
// The usage counts (web/src/client/track.ts) against the old module's (assets/js/core/track.js), which feed usage/ and
// the /stats dashboard: the same visit, played into each in a stand-in browser, sends the same batches to the same
// endpoint, field for field (the random visitor and session ids aside), and the same rules say when nothing is sent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../assets/js/config.js';

const ORIGIN = 'https://ptcatch.com';

/** A page element as the listeners see it: what it matches itself, and what its ancestors match. */
class FakeElement {
  constructor({ matches = [], within = [], attrs = {}, text = '', href } = {}) {
    Object.assign(this, { own: new Set(matches), within: new Set(within), attrs, textContent: text, href });
  }
  closest(selector) {
    const parts = selector.split(',').map(s => s.trim());
    if (parts.some(p => this.own.has(p))) return this;
    const up = parts.find(p => this.within.has(p));
    return up ? new FakeElement({ matches: [up] }) : null;
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
}

/**
 * A stand-in browser on globalThis: storage, the address, the clock, and the document's and window's listeners, which
 * `fire` calls with any event object. What's sent with sendBeacon lands in `posts`.
 */
function browser({ origin = ORIGIN, storage = {}, navigator = {} } = {}) {
  const items = new Map(Object.entries(storage));
  const listeners = { document: {}, window: {} };
  const on = bucket => (type, fn) => { (bucket[type] ??= []).push(fn); };
  const posts = [];
  const env = {
    now: 1000,
    posts,
    items,
    fire: (where, type, event) => { for (const fn of listeners[where][type] ?? []) fn(event); },
  };
  const globals = {
    localStorage: {
      getItem: k => (items.has(k) ? items.get(k) : null),
      setItem: (k, v) => { items.set(k, String(v)); },
      removeItem: k => { items.delete(k); },
    },
    location: new URL(`${origin}/player/3821475`),
    navigator: {
      language: 'en-GB', languages: ['en-GB'], ...navigator,
      sendBeacon: (url, blob) => { posts.push(blob.text().then(body => ({ url, body: JSON.parse(body) }))); return true; },
    },
    document: {
      addEventListener: on(listeners.document), visibilityState: 'visible', readyState: 'complete',
      referrer: 'https://discord.com/channels/1/2', documentElement: {}, querySelectorAll: () => [],
    },
    window: { addEventListener: on(listeners.window) },
    addEventListener: on(listeners.window),
    innerWidth: 1280,
    innerHeight: 777,
    matchMedia: () => ({ matches: false }),
    performance: {
      now: () => env.now,
      getEntriesByType: type => (type === 'navigation' ? [{ responseStart: 81.4, loadEventEnd: 640.6 }] : []),
      getEntriesByName: name => (name === 'first-contentful-paint' ? [{ startTime: 210.2 }] : []),
    },
    Element: FakeElement,
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  return env;
}

/** One visit, the same for both modules: a signed-in player opens a profile, uses it, then the leaderboards, and leaves. */
async function visit(t, m, env) {
  m.startTracking();
  t.mock.timers.tick(1); // the load timings
  m.identify('Tris');
  m.trackView('player', { ms: 312.6, obj: 'p3821475' });
  const inPage = { within: ['#content'] };
  env.fire('document', 'click', { target: new FakeElement({ matches: ['button'], text: 'Show 25 more', ...inPage }) });
  env.fire('document', 'click', { target: new FakeElement({ matches: ['button'], attrs: { 'data-track': 'more badges' }, text: '+3 more', ...inPage }) });
  env.fire('document', 'click', { target: new FakeElement({ matches: ['a[href]'], href: 'https://osu.ppy.sh/beatmapsets/1#fruits/2', ...inPage }) });
  env.fire('document', 'click', { target: new FakeElement({ matches: ['a[href]'], href: `${ORIGIN}/map/5`, ...inPage }) });
  env.fire('document', 'click', { target: new FakeElement({ matches: ['button'], text: 'Open menu', within: ['.nav-toggle'] }) });
  env.fire('document', 'input', { target: new FakeElement({ attrs: { 'aria-label': 'Search plays' }, ...inPage }) });
  env.fire('document', 'change', { target: new FakeElement({ attrs: { name: 'sort' }, ...inPage }) });
  for (const [key, value] of [['ppchart', true], ['osuSession', null], ['guess-best', 12], ['consent', 'yes'], ['dense', false]]) {
    env.fire('window', 'ptctb:pref', { detail: { key, value } });
  }
  env.fire('window', 'ptctb:query', { detail: { before: { sort: 'pp' }, after: { q: 'freedom dive', sort: 'acc', page: '2', mods: 'HD,HR' } } });
  t.mock.timers.tick(1500);
  env.fire('window', 'ptctb:query', { detail: { before: { q: 'x', cat: 'u' }, after: { q: '1234' } } });
  m.trackError(new Error('players/3821475.json answered HTTP 503 at https://data.ptcatch.com/x'), 'player');
  m.trackError(new Error('players/12.json answered HTTP 503 at https://data.ptcatch.com/y'), 'player'); // the same, once
  env.fire('window', 'error', { error: new Error('x is not a function 7'), filename: `${ORIGIN}/assets/web/app.js?v=1`, lineno: 3 });
  env.fire('window', 'error', { message: 'Script error.', filename: '', lineno: 0 });
  env.fire('window', 'unhandledrejection', { reason: 'nope 5' });
  m.track('search', 'header', `picked a player · ${m.shapeOf('tris')}`);
  m.track('game', 'guess', 'finished', '', 12.6);
  m.track('egg', 'konami');
  env.now += 4321;
  env.fire('document', 'keydown', { key: 'Enter', target: new FakeElement({ within: ['.nav-menu'] }) });
  m.trackView('rankings/converts', { ms: 50.4 });
  env.fire('document', 'click', { target: new FakeElement({ matches: ['button'], text: 'Sign in', within: ['.you'] }) });
  env.now += 2000;
  env.fire('window', 'pagehide', {});
  m.optOut({ erase: true });
  return Promise.all(env.posts);
}

/** A batch with its random ids put aside (they're checked for their shape). */
function plain(post) {
  const body = structuredClone(post.body);
  if ('forget' in body) { assert.match(body.forget, /^[0-9a-f]{16}$/); body.forget = 'ID'; }
  if ('id' in body) { assert.match(body.id, /^[0-9a-f]{16}$/); body.id = 'ID'; }
  if ('s' in body) { assert.match(body.s, /^[0-9a-f]{12}$/); body.s = 'S'; }
  return { url: post.url, body };
}

const storage = {
  'ptctb:osuSession': JSON.stringify({ id: 3821475, token: '3821475.4000000000.sig', exp: 4e9 }),
  'ptctb:osuProof': JSON.stringify({ id: 3821475, proof: 'proof' }),
};

async function run(t, load) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = browser({ storage });
  CONFIG.home = ORIGIN;
  const m = await load();
  const posts = (await visit(t, m, env)).map(plain);
  t.mock.timers.reset();
  return { posts, items: Object.fromEntries(env.items) };
}

test('the same visit sends the same batches as the old module, and opting out forgets the same way', async t => {
  const old = await run(t, () => import('../../assets/js/core/track.js'));
  const now = await run(t, () => import('../src/client/track.ts'));
  assert.ok(old.posts.length >= 2, 'a batch and the request to forget');
  assert.deepEqual(now.posts, old.posts);
  // What's left in the browser afterwards: opted out, the ids gone.
  assert.deepEqual(now.items, old.items);
  // The first batch, spelled out where the dashboard reads it.
  const [first] = now.posts;
  assert.equal(first.url, '/api/hit');
  assert.deepEqual(Object.keys(first.body).sort(), ['c', 'd', 'e', 'f', 'id', 'm', 'p', 'pn', 'pr', 's', 'w'].sort());
  assert.deepEqual({ ...first.body, e: undefined }, {
    id: 'ID', s: 'S', d: 'desktop', p: 3821475, w: 'osu', pr: 'proof', pn: 'Tris', m: 1, f: 1, e: undefined,
    c: { vw: 1280, vh: 780, sc: 'dark', ln: 'en-GB' },
  });
  assert.deepEqual(first.body.e[0], ['perf', 'ttfb', 'home', '', 81, '']);
  // More than a batch's worth of events: two batches, the second without the once-a-session part.
  const events = now.posts.flatMap(p => p.body.e ?? []);
  assert.equal(now.posts.length, 3);
  assert.equal(now.posts[1].body.f, undefined);
  assert.ok(events.some(e => e[0] === 'view' && e[1] === 'player' && e[2] === 'direct' && e[3] === 'discord.com'));
  assert.ok(events.some(e => e[0] === 'view' && e[1] === 'rankings/converts' && e[2] === 'nav-menu'));
  assert.ok(events.some(e => e[0] === 'dwell' && e[1] === 'player' && e[4] === 4321));
  assert.deepEqual(now.posts.at(-1).body, { forget: 'ID' });
});

test('when nothing is counted: elsewhere, Do Not Track, Global Privacy Control, opted out, or no consent yet', async () => {
  const old = await import('../../assets/js/core/track.js');
  const now = await import('../src/client/track.ts');
  const cases = [
    [{ origin: 'http://127.0.0.1:8080' }, 'local'],
    [{ navigator: { globalPrivacyControl: true } }, 'gpc'],
    [{ navigator: { doNotTrack: '1' } }, 'dnt'],
    [{ storage: { 'ptctb:notrack': '1' } }, 'optout'],
    [{}, ''],
  ];
  CONFIG.home = ORIGIN;
  for (const [setup, why] of cases) {
    browser(setup);
    assert.equal(now.trackingBlock(), why, JSON.stringify(setup));
    assert.equal(now.trackingBlock(), old.trackingBlock());
  }
  const consent = CONFIG.analyticsConsent;
  try {
    CONFIG.analyticsConsent = 'all';
    browser();
    assert.equal(now.trackingBlock(), 'consent');
    browser({ storage: { 'ptctb:consent': '"yes"' } });
    assert.equal(now.trackingBlock(), '');
    assert.equal(now.trackingBlock(), old.trackingBlock());
  } finally {
    CONFIG.analyticsConsent = consent;
  }
  for (const text of ['', ' ', 'ab', 'abc', '12345', 'freedom dive', '123456789012']) assert.equal(now.shapeOf(text), old.shapeOf(text));
});
