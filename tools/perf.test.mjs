// npm run perf's arithmetic (tools/perf.mjs): the critical-path phases from one load's entries, medians, long frames
// and the budget check. The browser part needs Chromium and the network, so it isn't run here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phases, dataBase, frameSummary, median, medians, overBudget, budgetsFrom } from './perf.mjs';

const DATA = 'https://data.test/';
/** A repeat visit to a profile: HTML at 70 ms, meta.json at 420, the data at 440, a largest paint at 556. */
const RUN = {
  nav: { requestStart: 10, responseStart: 60, responseEnd: 70, loadEventEnd: 600, serverTiming: [{ name: 'asset', duration: 4, description: '' }] },
  paint: { 'first-contentful-paint': 120 },
  lcp: [{ startTime: 120, element: 'div.shell' }, { startTime: 556, element: 'h1.player' }],
  drawn: 550,
  resources: [
    { name: `${DATA}meta.json`, type: 'fetch', start: 75, end: 420 },
    { name: `${DATA}players.AAAAAAAAAA.json`, type: 'fetch', start: 421, end: 430 },
    { name: `${DATA}players/1.BBBBBBBBBB.json`, type: 'fetch', start: 421, end: 440 },
    { name: `${DATA}avatars/1-128.CCCCCCCCCC.webp`, type: 'img', start: 500, end: 520 },
    { name: `${DATA}history.DDDDDDDDDD.json`, type: 'fetch', start: 600, end: 650 }, // after the paint: not waited for
  ],
  parse: [{ start: 431, ms: 3 }, { start: 441, ms: 12 }], // the first one overlaps the wait for the second
  dom: [{ start: 500, ms: 20 }],
  frames: [{ start: 521, ms: 30 }],
  loaf: [{ startTime: 440, duration: 90, blockingDuration: 40, renderStart: 510, styleAndLayoutStart: 515, scripts: [
    { duration: 10, invoker: 'x', invokerType: 'event-listener', sourceURL: 'https://site.test/assets/js/a.js', sourceFunctionName: 'a' },
    { duration: 60, invoker: 'Response.text.then', invokerType: 'resolve-promise', sourceURL: 'https://site.test/assets/js/pages/player.js?v=1', sourceFunctionName: 'draw' },
  ] }],
  requests: [{ url: `${DATA}meta.json`, status: 304, bytes: 300 }, { url: 'https://site.test/player/1', status: 200, bytes: 2048 }],
};

test('the phases follow the critical path and add up to the largest paint', () => {
  const p = phases(RUN);
  assert.deepEqual({ html: p.html, meta: p.meta, data: p.data, parse: p.parse, render: p.render, compute: p.compute, lcp: p.lcp },
    { html: 70, meta: 350, data: 20, parse: 12, render: 50, compute: 54, lcp: 556 });
  assert.equal(p.html + p.meta + p.data + p.parse + p.render + p.compute, p.lcp);
  assert.deepEqual({ ttfb: p.ttfb, server: p.server, fcp: p.fcp, drawn: p.drawn, kb: p.kb, requests: p.requests, dataFiles: p.dataFiles, metaStatus: p.metaStatus },
    { ttfb: 60, server: 50, fcp: 120, drawn: 550, kb: 2, requests: 2, dataFiles: 2, metaStatus: '304' });
  assert.equal(p.lcpElement, 'h1.player');
  assert.equal(p.serverTiming, 'asset;dur=4');
  assert.equal(p.longestFrame, 90);
});

test('a page without data, or whose paint came before its data, still adds up', () => {
  const plain = phases({ nav: { responseStart: 50, responseEnd: 60 }, paint: { 'first-contentful-paint': 200 }, lcp: [], resources: [] });
  assert.deepEqual([plain.html, plain.meta, plain.data, plain.compute, plain.lcp], [60, 0, 0, 140, 200]);
  const early = phases({ ...RUN, lcp: [{ startTime: 300 }] });
  assert.deepEqual([early.html, early.meta, early.data, early.parse, early.render, early.compute], [70, 230, 0, 0, 0, 0]);
});

/**
 * The new client's first visit: the HTML carries its slice of packs.json and meta.json and preloads the core pack and
 * the page's JSON; meta.json is fetched again after the data, for what the page shows later.
 */
const NEW = {
  nav: { requestStart: 10, responseStart: 200, responseEnd: 260, loadEventEnd: 900 },
  paint: { 'first-contentful-paint': 400 },
  lcp: [{ startTime: 820, element: 'h1' }],
  drawn: 800,
  resources: [
    { name: 'https://site.test/assets/web/app.js?v=1', type: 'script', start: 210, end: 380 },
    { name: `${DATA}packs/core.AAAAAAAAAA.ptcb`, type: 'link', start: 215, end: 610 },
    { name: `${DATA}packs/home.BBBBBBBBBB.json`, type: 'link', start: 216, end: 520 },
    { name: `${DATA}meta.json`, type: 'fetch', start: 700, end: 760 }, // asked for after the data: nothing waited for it
  ],
  parse: [{ start: 610, ms: 5 }],
  dom: [{ start: 700, ms: 30 }],
  frames: [{ start: 731, ms: 40 }],
  loaf: [],
  requests: [],
};

test('the new client: manifests inline, packs preloaded, so the wait is data, not meta or compute', () => {
  const p = phases(NEW);
  assert.deepEqual([p.html, p.meta, p.data, p.parse, p.render, p.compute, p.lcp], [260, 0, 350, 5, 70, 135, 820]);
  assert.equal(p.html + p.meta + p.data + p.parse + p.render + p.compute, p.lcp);
  assert.equal(p.dataFiles, 2);
});

test('the data’s folder comes from a manifest or a pack, wherever the data is served', () => {
  assert.equal(dataBase([{ name: 'https://site.test/assets/web/app.js' }, { name: `${DATA}packs/player/1.AAAAAAAAAA.ptcb` }]), DATA);
  assert.equal(dataBase([{ name: 'http://localhost:8080/data/meta.json?x=1' }]), 'http://localhost:8080/data/');
  assert.equal(dataBase([{ name: 'https://site.test/assets/css/site.css' }]), null);
});

test('a long frame names the script that took most of it', () => {
  assert.deepEqual(frameSummary(RUN.loaf[0]), { at: 440, ms: 90, blocking: 40, render: 20, styleLayout: 15, script: 'player.js draw [resolve-promise: Response.text.then]', scriptMs: 60 });
});

test('medians, and budgets with their tolerance', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 10]), 3); // (2 + 3) / 2, rounded
  assert.equal(median([null, 5]), 5);
  assert.deepEqual(medians([{ lcp: 500, how: 'a' }, { lcp: 700, how: 'b' }, { lcp: 600, how: 'c' }]), { lcp: 600, how: 'a' });
  const results = { '/': { 'desktop-cold': { median: { lcp: 540, kb: 300 } }, 'phone-warm': { median: { lcp: 2000 } } } };
  const budgets = { tolerance: 0.1, routes: { '/': { 'desktop-cold': { lcp: 500, kb: 300 }, 'phone-warm': { lcp: 1800 } }, '/maps': { 'desktop-cold': { lcp: 1 } } } };
  // 540 is within 10% of 500; 2000 isn't within 10% of 1800; /maps wasn't measured.
  assert.deepEqual(overBudget(results, budgets), [{ route: '/', condition: 'phone-warm', metric: 'lcp', limit: 1800, got: 2000 }]);
  assert.deepEqual(overBudget(results, budgets, 0), [
    { route: '/', condition: 'desktop-cold', metric: 'lcp', limit: 500, got: 540 },
    { route: '/', condition: 'phone-warm', metric: 'lcp', limit: 1800, got: 2000 },
  ]);
  // Seeded with 20% headroom on the largest paint, to the next 50 ms: 540 → 650, 2000 → 2400.
  assert.deepEqual(budgetsFrom(results).routes, { '/': { 'desktop-cold': { lcp: 650, kb: 300 }, 'phone-warm': { lcp: 2400 } } });
});
