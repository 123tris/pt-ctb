#!/usr/bin/env node
// The lab half of the site's performance measurement; the other half is real visitors' timings (web/src/client/track.ts,
// and core/track.js for the old client, read on /stats Health). Loads each page in Chromium (Playwright) the way a
// visitor would and says where the time goes. Playwright is pinned in package.json so that its Chromium stays the one
// perf/baseline.json was measured with: a new Chromium moves the numbers, so take a new baseline after upgrading it.
//
//   npm run perf                                  the live site (https://ptcatch.com), 3 runs of each page
//   npm run perf -- https://dev.ptcatch.com       another copy of the site
//   npm run perf -- --runs 1 --routes home,maps   fewer runs or pages (no leading slash), for a quick look
//   npm run perf -- --baseline                    (re)write perf/baseline.json, the numbers later steps compare to
//   npm run perf -- --write-budgets               (re)write perf/budgets.json from this run's medians, with headroom
//
// Each page is loaded four ways: in a desktop window without throttling, and in a phone-sized one at 4× CPU slowdown
// with DevTools' Fast 4G network (CDP Emulation.setCPUThrottlingRate and Network.emulateNetworkConditions); each cold
// (a new browser profile: empty cache, new connections) and warm (the same profile reopened: a repeat visit, with the
// cache full and new connections). The medians go to perf/latest.json, and to perf/baseline.json the first time or with
// --baseline. Exits 1 when a page is more than 10% over its budget in perf/budgets.json (or failed to load).
//
// The phases follow the critical path in order, so they add up to the largest paint (LCP):
//   html     the page's HTML, in full (ttfb: its first byte; server: of that, the server's own wait)
//   meta     then waiting for a manifest of the data (meta.json or packs.json: another origin, revalidated on every
//            load), when the page asked for one before any data file. The old client always does. The new client has
//            its page's slice of both inline in the HTML, so for it this is 0
//   data     then waiting for the page's data files: JSON, and the new client's packs (.ptcb), which it preloads while
//            the HTML is still being read
//   parse    JSON.parse of what arrived last (files that came earlier are parsed while later ones download). Decoding a
//            pack isn't timed apart: it's in compute
//   render   setting the page's HTML (innerHTML) and the frame after it: style, layout, paint
//   compute  the rest until the largest paint: the page's own code (still downloading, evaluating, decoding packs) and
//            short gaps
// Chrome's network emulation holds back the whole response, so on the phone the emulated latency shows in html, not in
// ttfb. Then the longest animation frames (long-animation-frame entries), with the script each spent most of its time
// in; "no file [resolve-promise: Response.text.then]" is a fetched file's JSON.parse (as timed here) and the page code
// that ran on from it. While measuring, the page's usage counting is off (ptctb:notrack), so runs never reach /stats.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'perf');

/** The pages measured: the most used first (per /stats), then one of each other kind. */
export const ROUTES = ['/', '/rankings', '/player/6205809', '/maps', '/map/553728', '/activity', '/challenges', '/records', '/calculator', '/glossary'];

// DevTools' "Fast 4G" preset, scaled the way its network panel scales it.
const FAST_4G = { offline: false, latency: 60 * 2.75, downloadThroughput: (9e6 / 8) * 0.9, uploadThroughput: (1.5e6 / 8) * 0.9 };
export const PROFILES = {
  desktop: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, cpu: 1, network: null },
  phone: { viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true, cpu: 4, network: FAST_4G },
};
export const CONDITIONS = Object.keys(PROFILES).flatMap(p => [`${p}-cold`, `${p}-warm`]);
export const TOLERANCE = 0.1;

/** Runs in the page before its own scripts: switches usage counting off, and times what the Performance API can't. */
function instrument() {
  try { localStorage.setItem('ptctb:notrack', '1'); } catch { /* no storage */ }
  const P = (globalThis.__perf = { parse: [], dom: [], frames: [], lcp: [], loaf: [], drawn: null });
  // Response.json is the text, then JSON.parse: timed apart.
  Response.prototype.json = async function json() {
    const url = this.url;
    const text = await this.text();
    const start = performance.now();
    const value = JSON.parse(text);
    P.parse.push({ url, start, ms: performance.now() - start });
    return value;
  };
  // Setting a page's HTML, and the frame after it: from the frame's start to the next task (style, layout, paint).
  let waiting = false;
  const afterFrame = () => {
    if (waiting) return;
    waiting = true;
    requestAnimationFrame(() => {
      const start = performance.now();
      const channel = new MessageChannel();
      channel.port1.onmessage = () => { P.frames.push({ start, ms: performance.now() - start }); waiting = false; };
      channel.port2.postMessage(0);
    });
  };
  const timed = (start, text) => { if (String(text).length >= 1000) { P.dom.push({ start, ms: performance.now() - start }); afterFrame(); } };
  const inner = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { ...inner, set(value) { const start = performance.now(); inner.set.call(this, value); timed(start, value); } });
  const adjacent = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function insertAdjacentHTML(where, text) { const start = performance.now(); adjacent.call(this, where, text); timed(start, text); };
  // The router marks #content aria-busy while it draws a page (web/src/app.ts, and assets/js/app.js in the old client):
  // drawn is when that first ends.
  new MutationObserver(changes => {
    if (P.drawn === null && changes.some(c => c.target.id === 'content' && c.oldValue === 'true' && !c.target.hasAttribute('aria-busy'))) P.drawn = performance.now();
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-busy'], attributeOldValue: true });
  const watch = (type, list, map) => {
    try { new PerformanceObserver(l => list.push(...l.getEntries().map(map))).observe({ type, buffered: true }); } catch { /* not supported */ }
  };
  watch('largest-contentful-paint', P.lcp, e => ({ startTime: e.startTime, size: e.size, url: e.url, element: e.element ? `${e.element.tagName.toLowerCase()}${e.element.className ? `.${String(e.element.className).split(' ')[0]}` : ''}` : '' }));
  watch('long-animation-frame', P.loaf, e => ({
    startTime: e.startTime, duration: e.duration, blockingDuration: e.blockingDuration, renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart,
    scripts: e.scripts.map(s => ({ duration: s.duration, invoker: s.invoker, invokerType: s.invokerType, sourceURL: s.sourceURL, sourceFunctionName: s.sourceFunctionName, forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration })),
  }));
}

/**
 * Waits until a full second goes by without a new paint or long frame (15 s at most). The frame after a page is drawn
 * can take most of a second on the throttled phone, and its largest paint is only reported once it's on screen;
 * networkidle alone has often passed by then.
 */
function settled() {
  return new Promise(done => {
    let seen = -1;
    const check = () => {
      const P = globalThis.__perf;
      const now = P.lcp.length + P.loaf.length + P.frames.length;
      if (now === seen) done();
      else { seen = now; requestAnimationFrame(() => setTimeout(check, 1000)); }
    };
    check();
    setTimeout(done, 15_000);
  });
}

/** What the page measured: navigation, resource and paint entries, plus instrument()'s. */
function collect() {
  const nav = performance.getEntriesByType('navigation')[0]?.toJSON() ?? null;
  const resources = performance.getEntriesByType('resource').map(r => ({ name: r.name, type: r.initiatorType, start: r.startTime, end: r.responseEnd }));
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, p.startTime]));
  return { nav, resources, paint, agent: navigator.userAgent, ...globalThis.__perf };
}

const round = v => (Number.isFinite(v) ? Math.round(v) : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fileOf = url => String(url ?? '').split('?')[0].split('/').pop() || String(url ?? '');

const MANIFEST = /\/(meta|packs)\.json(\?|$)/;
const DATA_FILE = /\.(json|ptcb)(\?|$)/;

/**
 * Where the data lives (the folder of meta.json), from the first manifest or pack the page fetched: data.ptcatch.com
 * for the site, a local folder under npm run serve -- --local-data. Null when the page fetched neither.
 */
export function dataBase(resources) {
  for (const r of resources) {
    const m = /^(.*\/)(?:meta\.json|packs\.json|packs\/[^?]*)(\?.*)?$/.exec(r.name);
    if (m) return m[1];
  }
  return null;
}

/** One load's phases (see the top of this file) and headline numbers, in whole milliseconds. */
export function phases(run) {
  const nav = run.nav ?? {};
  const fcp = run.paint?.['first-contentful-paint'] ?? null;
  const lcp = run.lcp?.at(-1)?.startTime ?? fcp ?? run.drawn ?? nav.loadEventEnd;
  const base = dataBase(run.resources);
  const fromData = base ? run.resources.filter(r => r.name.startsWith(base) && DATA_FILE.test(r.name)) : [];
  const asked = fromData.filter(r => !MANIFEST.test(r.name));
  const files = asked.filter(r => r.end <= lcp);
  // A manifest is on the way to the page only when it came back before the first data file was asked for.
  const firstAsked = Math.min(...asked.map(r => r.start));
  const manifests = fromData.filter(r => MANIFEST.test(r.name) && r.end <= firstAsked);
  const html = clamp(nav.responseEnd ?? 0, 0, lcp);
  const metaEnd = clamp(Math.max(html, ...manifests.map(r => r.end)), html, lcp);
  const dataEnd = clamp(Math.max(metaEnd, ...files.map(r => r.end)), metaEnd, lcp);
  const within = list => list.filter(x => x.start >= dataEnd && x.start < lcp).reduce((a, x) => a + Math.min(x.ms, lcp - x.start), 0);
  const tail = lcp - dataEnd;
  const parse = Math.min(tail, within(run.parse ?? []));
  const render = Math.min(tail - parse, within([...(run.dom ?? []), ...(run.frames ?? [])]));
  const frames = run.loaf ?? [];
  const bytes = (run.requests ?? []).reduce((a, r) => a + (r.bytes ?? 0), 0);
  const metaRequest = (run.requests ?? []).find(r => /\/meta\.json(\?|$)/.test(r.url));
  return {
    ttfb: round(nav.responseStart), server: nav.requestStart > 0 ? round(nav.responseStart - nav.requestStart) : null,
    html: round(html), meta: round(metaEnd - html), data: round(dataEnd - metaEnd),
    parse: round(parse), compute: round(tail - parse - render), render: round(render),
    lcp: round(lcp), lcpElement: run.lcp?.at(-1)?.element ?? '', fcp: round(fcp), drawn: round(run.drawn), load: round(nav.loadEventEnd),
    longestFrame: round(Math.max(0, ...frames.map(f => f.duration))), blocking: round(frames.reduce((a, f) => a + (f.blockingDuration ?? 0), 0)),
    kb: round(bytes / 1024), requests: (run.requests ?? []).length, dataFiles: files.length,
    metaStatus: String(metaRequest?.status ?? ''), serverTiming: (nav.serverTiming ?? []).map(s => `${s.name}${s.duration ? `;dur=${round(s.duration)}` : ''}${s.description ? `;desc=${s.description}` : ''}`).join(', '),
  };
}

/** A long animation frame, with where its time went and the script that took most of it. */
export function frameSummary(f) {
  const end = f.startTime + f.duration;
  const top = [...(f.scripts ?? [])].sort((a, b) => b.duration - a.duration)[0];
  return {
    at: round(f.startTime), ms: round(f.duration), blocking: round(f.blockingDuration),
    render: f.renderStart ? round(end - f.renderStart) : 0, styleLayout: f.styleAndLayoutStart ? round(end - f.styleAndLayoutStart) : 0,
    script: top ? `${fileOf(top.sourceURL) || 'no file'}${top.sourceFunctionName ? ` ${top.sourceFunctionName}` : ''} [${top.invokerType}: ${top.invoker}]` : '', scriptMs: top ? round(top.duration) : 0,
  };
}

/** The middle value (the mean of the two middle ones for an even count); null for none. */
export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/** Each numeric phase's median over the runs. */
export function medians(runs) {
  const out = {};
  for (const key of Object.keys(runs[0] ?? {})) {
    out[key] = typeof runs[0][key] === 'number' || runs[0][key] === null ? median(runs.map(r => r[key])) : runs[0][key];
  }
  return out;
}

/** Budgets a result is more than `tolerance` over: [{ route, condition, metric, limit, got }]. Unmeasured ones are skipped. */
export function overBudget(results, budgets, tolerance = budgets.tolerance ?? TOLERANCE) {
  const over = [];
  for (const [route, conditions] of Object.entries(budgets.routes ?? {})) {
    for (const [condition, limits] of Object.entries(conditions)) {
      const got = results[route]?.[condition]?.median;
      if (!got) continue;
      for (const [metric, limit] of Object.entries(limits)) {
        if (Number.isFinite(got[metric]) && got[metric] > limit * (1 + tolerance)) over.push({ route, condition, metric, limit, got: got[metric] });
      }
    }
  }
  return over;
}

// Seeded budgets leave this much room over the measured median for the live network's noise (single loads of the same
// page vary by 2× and more).
const HEADROOM = 0.2;

/** Budgets from a run's medians: the largest paint everywhere (with HEADROOM, to the next 50 ms), and cold loads' bytes. */
export function budgetsFrom(results) {
  const up = (v, step) => Math.ceil(v / step) * step;
  const routes = {};
  for (const [route, conditions] of Object.entries(results)) {
    routes[route] = {};
    for (const [condition, { median: m }] of Object.entries(conditions)) {
      if (!m?.lcp) continue;
      const lcp = up(m.lcp * (1 + HEADROOM), 50);
      routes[route][condition] = condition.endsWith('-cold') ? { lcp, kb: up(m.kb, 10) } : { lcp };
    }
  }
  return {
    tolerance: TOLERANCE,
    note: `Per page and condition, the most each may take: lcp in ms (seeded at the median plus ${HEADROOM * 100}%), kb transferred. npm run perf fails past these by more than the tolerance. Lower them as pages get faster.`,
    routes,
  };
}

/** Loads `url` once in the browser profile at `dir` and returns what the page and the network saw. */
async function load(chromium, url, profile, dir) {
  const p = PROFILES[profile];
  const context = await chromium.launchPersistentContext(dir, { headless: true, viewport: p.viewport, deviceScaleFactor: p.deviceScaleFactor, isMobile: p.isMobile, hasTouch: p.hasTouch });
  try {
    await context.addInitScript(instrument);
    const page = context.pages()[0] ?? await context.newPage();
    const cdp = await context.newCDPSession(page);
    const requests = new Map();
    cdp.on('Network.responseReceived', ({ requestId, response }) => requests.set(requestId, { url: response.url, status: response.status, cached: Boolean(response.fromDiskCache), protocol: response.protocol, bytes: 0 }));
    cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => { const r = requests.get(requestId); if (r) r.bytes = encodedDataLength; });
    await cdp.send('Network.enable');
    if (p.network) await cdp.send('Network.emulateNetworkConditions', p.network);
    if (p.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
    const response = await page.goto(url, { waitUntil: 'load', timeout: 90_000 });
    await page.waitForFunction(() => globalThis.__perf?.drawn !== null, null, { timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => { /* a page that keeps polling */ });
    await page.evaluate(settled);
    const raw = await page.evaluate(collect);
    return { ...raw, requests: [...requests.values()], colo: String(response?.headers()['cf-ray'] ?? '').split('-')[1] ?? '' };
  } finally {
    await context.close();
  }
}

function parseArgs(argv) {
  const opts = { base: 'https://ptcatch.com', runs: 3, routes: ROUTES, baseline: false, writeBudgets: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') opts.runs = Math.max(1, Number(argv[++i]) || 1);
    // Pages without their leading slash (Git Bash turns /player/1 into a Windows path), home as "home".
    else if (a === '--routes') opts.routes = argv[++i].split(',').map(r => (r === 'home' ? '/' : r.startsWith('/') ? r : `/${r}`));
    else if (a === '--baseline') opts.baseline = true;
    else if (a === '--write-budgets') opts.writeBudgets = true;
    else if (/^https?:\/\//.test(a)) opts.base = a.replace(/\/+$/, '');
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const pad = (v, n, left = false) => (left ? String(v ?? '–').padEnd(n) : String(v ?? '–').padStart(n));

function printTable(results, baseline) {
  const cols = [['ttfb', 5], ['server', 6], ['html', 5], ['meta', 5], ['data', 5], ['parse', 5], ['compute', 7], ['render', 6], ['lcp', 6], ['frame', 6], ['kb', 6]];
  const width = Math.max(...Object.keys(results).map(r => r.length), 4);
  console.log(`\n${pad('page', width, true)}  ${pad('how', 12, true)}${cols.map(([k, n]) => ` ${pad(k, n)}`).join('')}${baseline ? '  lcp vs baseline' : ''}`);
  for (const [route, conditions] of Object.entries(results)) {
    for (const [condition, r] of Object.entries(conditions)) {
      const m = r.median;
      if (!m) { console.log(`${pad(route, width, true)}  ${pad(condition, 12, true)} failed: ${r.errors.join('; ')}`); continue; }
      const was = baseline?.routes?.[route]?.[condition]?.median?.lcp;
      const delta = Number.isFinite(was) && Number.isFinite(m.lcp) ? `  ${m.lcp - was >= 0 ? '+' : ''}${m.lcp - was} ms (${Math.round(((m.lcp - was) / was) * 100)}%)` : '';
      console.log(`${pad(route, width, true)}  ${pad(condition, 12, true)}${cols.map(([k, n]) => ` ${pad(m[k === 'frame' ? 'longestFrame' : k], n)}`).join('')}${delta}`);
    }
  }
  console.log('\nms; medians. html + meta + data + parse + compute + render = lcp (the critical path); frame: the longest animation frame; kb: transferred.');
}

function printFrames(results) {
  const all = [];
  for (const [route, conditions] of Object.entries(results)) for (const [condition, r] of Object.entries(conditions)) for (const f of r.frames ?? []) all.push({ route, condition, ...f });
  all.sort((a, b) => b.ms - a.ms);
  console.log('\nLongest animation frames (long-animation-frame entries), and the script each spent most of its time in:');
  for (const f of all.slice(0, 12)) {
    console.log(`  ${pad(f.ms, 4)} ms  ${f.route} ${f.condition} at ${f.at} ms: ${f.script ? `${f.scriptMs} ms in ${f.script}` : 'no script'}; style and layout ${f.styleLayout} ms, rendering ${f.render} ms`);
  }
  if (!all.length) console.log('  none over 50 ms.');
}

async function main(argv) {
  const opts = parseArgs(argv);
  const { chromium } = await import('playwright');
  const results = {};
  const edges = {}; // the Cloudflare edge that answered each load (cf-ray): routing can change from one run to the next
  let agent = '';
  console.log(`Measuring ${opts.base}: ${opts.routes.length} pages × ${CONDITIONS.length} ways × ${opts.runs} runs.`);
  for (const route of opts.routes) {
    results[route] = {};
    for (const profile of Object.keys(PROFILES)) {
      const runs = { cold: [], warm: [] }, frames = { cold: [], warm: [] }, errors = { cold: [], warm: [] };
      for (let i = 0; i < opts.runs; i++) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptcatch-perf-'));
        try {
          for (const cache of ['cold', 'warm']) {
            try {
              const raw = await load(chromium, `${opts.base}${route}`, profile, dir);
              runs[cache].push({ ...phases(raw), edge: raw.colo });
              frames[cache].push(...raw.loaf.map(frameSummary));
              edges[raw.colo || '?'] = (edges[raw.colo || '?'] ?? 0) + 1;
              agent ||= raw.agent;
            } catch (e) {
              errors[cache].push(String(e.message).split('\n')[0]);
              if (cache === 'cold') break; // a warm load needs the cold one's cache
            }
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
      }
      for (const cache of ['cold', 'warm']) {
        results[route][`${profile}-${cache}`] = {
          median: runs[cache].length ? medians(runs[cache]) : null, runs: runs[cache], errors: errors[cache],
          frames: frames[cache].sort((a, b) => b.ms - a.ms).slice(0, 3),
        };
      }
      const lcp = cache => results[route][`${profile}-${cache}`].median?.lcp ?? 'failed';
      console.log(`  ${route} ${profile}: largest paint ${lcp('cold')} ms cold, ${lcp('warm')} ms warm`);
    }
  }

  const report = {
    measured: new Date().toISOString(), base: opts.base, runs: opts.runs, edges, agent, node: process.version,
    machine: `${os.platform()} ${os.arch()}, ${os.cpus()[0]?.model ?? 'unknown CPU'}`,
    conditions: Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [k, { viewport: p.viewport, deviceScaleFactor: p.deviceScaleFactor, cpuSlowdown: p.cpu, network: p.network ? 'Fast 4G' : 'none' }])),
    routes: results,
  };
  fs.mkdirSync(OUT, { recursive: true });
  const baselineFile = path.join(OUT, 'baseline.json');
  const baseline = readJson(baselineFile);
  fs.writeFileSync(path.join(OUT, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (opts.baseline || !baseline) fs.writeFileSync(baselineFile, `${JSON.stringify(report, null, 2)}\n`);
  if (opts.writeBudgets) fs.writeFileSync(path.join(OUT, 'budgets.json'), `${JSON.stringify(budgetsFrom(results), null, 2)}\n`);

  console.log(`\nLoads answered by Cloudflare's ${Object.entries(edges).map(([k, n]) => `${k} (${n})`).join(', ') || 'unknown'} edge, ${agent}.`);
  printTable(results, opts.baseline || !baseline ? null : baseline);
  printFrames(results);
  console.log(`\nWrote perf/latest.json${opts.baseline || !baseline ? ' and perf/baseline.json' : ''}${opts.writeBudgets ? ' and perf/budgets.json' : ''}.`);

  const budgets = readJson(path.join(OUT, 'budgets.json'));
  const failed = Object.entries(results).flatMap(([route, c]) => Object.entries(c).filter(([, r]) => !r.median).map(([condition]) => `${route} ${condition}`));
  const over = budgets ? overBudget(results, budgets) : [];
  if (!budgets) console.log('No perf/budgets.json yet: nothing to check (npm run perf -- --write-budgets makes one from this run).');
  for (const o of over) console.log(`OVER BUDGET: ${o.route} ${o.condition} ${o.metric} ${o.got} (budget ${o.limit}, +${Math.round((budgets.tolerance ?? TOLERANCE) * 100)}% allowed)`);
  for (const f of failed) console.log(`FAILED: ${f}`);
  if (budgets && !over.length && !failed.length) console.log(`Every page is within ${Math.round((budgets.tolerance ?? TOLERANCE) * 100)}% of its budget.`);
  return over.length || failed.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => { console.error(e); process.exitCode = 2; });
}
