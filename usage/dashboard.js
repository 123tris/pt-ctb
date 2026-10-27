// GET /stats: the owner's usage dashboard, rendered on the server from the USAGE database (usage/store.js).
// Protected by HTTP Basic auth: any user name, the password is the STATS_PASSWORD secret of the Pages project.
// No JavaScript is needed to read it; one tiny inline script (allowed by nonce) runs the "don't count me" switch,
// which sets the same ptctb:notrack flag assets/js/core/track.js checks.
//
// Views (?view=): overview (this file: pages, ways in, buttons, features), people (who uses the site: players,
// visitors, funnels, retention), health (errors, timings, screens) and person (one player's or visitor's sessions and
// events); the last three are in usage/insights.js. The 365-day overview reads the anonymous daily rollup; everything
// else reads the raw events, which are only kept RAW_KEEP_DAYS.

import { ensureSchema, dayOf, RAW_KEEP_DAYS, ROLLUP_KEEP_DAYS, DAILY_EVENT_CAP, DAILY_READ_BUDGET, usedToday, eventsSince, noteReads } from './store.js';
import { CSS, BAR, esc, num, pct, meter, table, td, duration } from './render.js';
import { peopleReport, renderPeople, healthReport, renderHealth, personReport, renderPerson } from './insights.js';
import { CONFIG } from '../assets/js/config.js';
import { hashedName } from '../assets/js/core/data-name.js';

const RANGES = [7, 30, 90, 365];
// The longest range that reads raw events every time (overview up to 90 days; people, health and person always).
// Longer ones would read too much, and RAW_KEEP_DAYS ends them anyway.
const RAW_MAX = Math.min(90, RAW_KEEP_DAYS);
const VIEWS = { overview: 'Overview', people: 'People', health: 'Health' };
// One report reads every event of its range about this many times (up to 17 queries; the ones without a kind filter
// scan the whole range), so a range's cost is guessed from the quota table before it runs. See DAILY_READ_BUDGET in
// store.js. The rollup has far fewer rows than the events it sums, so reading it costs about one row per event at most.
const READS_PER_EVENT = 10;
const READS_PER_ROLLED_EVENT = 1;
const SITES = { prod: 'ptcatch.com', dev: 'dev.ptcatch.com', preview: 'previews' };
// The site's top-level pages (assets/js/app.js ROUTES), so a page nobody opened still shows up, with 0.
const SECTIONS = ['home', 'rankings', 'players', 'player', 'maps', 'map', 'activity', 'challenges', 'games', 'calculator',
  'compare', 'records', 'recap', 'commands', 'join', 'team', 'glossary', 'privacy'];
const VIA = { nav: 'Top menu', 'more-menu': '"More" menu', search: 'Header search', page: 'A link on the page', footer: 'Footer', 'you-menu': 'Avatar menu', direct: 'Direct, shared link or Back' };
const FEATURES = { search: 'Search', filter: 'Filter, sort or tab', game: 'Game', auth: 'Sign-in' };

async function sameSecret(given, expected) {
  const enc = s => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [a, b] = await Promise.all([enc(given), enc(expected)]).then(x => x.map(d => new Uint8Array(d)));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** True when the request carries Basic credentials whose password is STATS_PASSWORD. */
export async function authorised(request, password) {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try { decoded = atob(header.slice(6)); } catch { return false; }
  const given = decoded.slice(decoded.indexOf(':') + 1);
  return sameSecret(given, password);
}

/** D1 reports each query's rows read in meta; the sum goes into today's quota row (usage/store.js, noteReads). */
export function rowsRead(results) {
  const metered = results.map(x => x.meta?.rows_read);
  return metered.every(n => Number.isFinite(n)) ? metered.reduce((a, b) => a + b, 0) : null;
}

/** All the numbers for one site and range, in one round trip to the database. */
export async function report(db, site, days, now = Date.now()) {
  await ensureSchema(db);
  const from = dayOf(now - (days - 1) * 86400000);
  const base = 'FROM events WHERE env = ?1 AND day >= ?2';
  const visit = "COUNT(DISTINCT day || visitor)";
  const q = sql => db.prepare(sql).bind(site, from);
  const results = await db.batch([
    q(`SELECT day, ${visit} AS visits, SUM(kind = 'view') AS views ${base} GROUP BY day ORDER BY day`),
    q(`SELECT name, COUNT(*) AS views, ${visit} AS visits ${base} AND kind = 'view' GROUP BY name ORDER BY views DESC`),
    q(`SELECT name, COUNT(*) AS n ${base} AND kind = 'use' GROUP BY name`),
    q(`SELECT detail, COUNT(*) AS n ${base} AND kind = 'view' GROUP BY detail ORDER BY n DESC`),
    q(`SELECT name, detail, COUNT(*) AS n, ${visit} AS visits ${base} AND kind = 'click' GROUP BY name, detail ORDER BY n DESC LIMIT 60`),
    q(`SELECT name, detail, COUNT(*) AS n ${base} AND kind = 'out' GROUP BY name, detail ORDER BY n DESC LIMIT 30`),
    q(`SELECT kind, name, detail, COUNT(*) AS n, ${visit} AS visits ${base} AND kind IN ('egg', 'pref') GROUP BY kind, name, detail ORDER BY n DESC`),
    q(`SELECT device AS name, ${visit} AS visits ${base} GROUP BY device ORDER BY visits DESC`),
    q(`SELECT country AS name, ${visit} AS visits ${base} GROUP BY country ORDER BY visits DESC LIMIT 15`),
    q(`SELECT ref AS name, COUNT(*) AS n ${base} AND ref != '' GROUP BY ref ORDER BY n DESC LIMIT 15`),
    q(`SELECT ${visit} AS visits ${base} AND me = 1`),
    q(`SELECT ${visit} AS visits, SUM(kind = 'view') AS views, COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT player) AS players ${base}`),
    // Earliest time first seen = roughly the order down the page, so sections list top to bottom.
    q(`SELECT name, detail, ${visit} AS visits, MIN(rowid) AS first ${base} AND kind = 'seen' GROUP BY name, detail ORDER BY name, first LIMIT 200`),
    q(`SELECT kind, name, detail, COUNT(*) AS n, ${visit} AS visits ${base} AND kind IN ('search', 'filter', 'game', 'auth') GROUP BY kind, name, detail ORDER BY n DESC LIMIT 80`),
    q(`SELECT obj, COUNT(*) AS n, ${visit} AS visits ${base} AND kind = 'view' AND obj != '' GROUP BY obj ORDER BY n DESC LIMIT 30`),
    q(`SELECT name, SUM(val) AS total ${base} AND kind = 'dwell' GROUP BY name`),
    db.prepare('SELECT COUNT(*) AS n, SUM(returned) AS back FROM sessions WHERE env = ?1 AND day >= ?2').bind(site, from),
  ]);
  const [daily, pages, used, via, clicks, out, fun, devices, countries, refs, me, total, seen, features, objects, dwell, sessions] = results.map(r => r.results);
  const t = total[0] ?? {};
  return {
    rowsRead: rowsRead(results),
    site, days, from, to: dayOf(now),
    daily, pages, used, via, clicks, out, fun, devices, countries, refs, seen, features, objects, dwell,
    me: me[0]?.visits ?? 0, visits: t.visits ?? 0, views: t.views ?? 0, visitors: t.visitors ?? 0, players: t.players ?? 0,
    sessions: sessions[0]?.n ?? 0, returning: sessions[0]?.back ?? 0,
  };
}

/**
 * The same numbers as report(), from the anonymous daily rollup (usage/store.js, maintain), for ranges longer than
 * RAW_MAX. Up to yesterday: today isn't rolled up yet. There are no per-person numbers in it.
 */
export async function rollupReport(db, site, days, now = Date.now()) {
  await ensureSchema(db);
  const from = dayOf(now - (days - 1) * 86400000);
  const base = 'FROM rollup WHERE env = ?1 AND day >= ?2';
  const q = sql => db.prepare(sql).bind(site, from);
  const results = await db.batch([
    q(`SELECT day, visits, n AS views ${base} AND kind = '_day' ORDER BY day`),
    q(`SELECT name, SUM(n) AS views, SUM(visits) AS visits ${base} AND kind = '_page' GROUP BY name ORDER BY views DESC`),
    q(`SELECT name, SUM(n) AS n ${base} AND kind = 'use' GROUP BY name`),
    q(`SELECT detail, SUM(n) AS n ${base} AND kind = 'view' GROUP BY detail ORDER BY n DESC`),
    q(`SELECT name, detail, SUM(n) AS n, SUM(visits) AS visits ${base} AND kind = 'click' GROUP BY name, detail ORDER BY n DESC LIMIT 60`),
    q(`SELECT name, detail, SUM(n) AS n ${base} AND kind = 'out' GROUP BY name, detail ORDER BY n DESC LIMIT 30`),
    q(`SELECT kind, name, detail, SUM(n) AS n, SUM(visits) AS visits ${base} AND kind IN ('egg', 'pref') GROUP BY kind, name, detail ORDER BY n DESC`),
    q(`SELECT name, SUM(visits) AS visits ${base} AND kind = '_device' GROUP BY name ORDER BY visits DESC`),
    q(`SELECT name, SUM(visits) AS visits ${base} AND kind = '_country' GROUP BY name ORDER BY visits DESC LIMIT 15`),
    q(`SELECT name, SUM(n) AS n ${base} AND kind = '_ref' GROUP BY name ORDER BY n DESC LIMIT 15`),
    q(`SELECT SUM(visits) AS visits ${base} AND kind = '_me'`),
    q(`SELECT SUM(visits) AS visits, SUM(n) AS views ${base} AND kind = '_day'`),
    q(`SELECT name, detail, SUM(visits) AS visits ${base} AND kind = 'seen' GROUP BY name, detail ORDER BY name, visits DESC LIMIT 200`),
    q(`SELECT kind, name, detail, SUM(n) AS n, SUM(visits) AS visits ${base} AND kind IN ('search', 'filter', 'game', 'auth') GROUP BY kind, name, detail ORDER BY n DESC LIMIT 80`),
    q(`SELECT name, SUM(total) AS total ${base} AND kind = 'dwell' GROUP BY name`),
    q(`SELECT SUM(n) AS n, SUM(CASE WHEN name = 'returning' THEN n ELSE 0 END) AS back ${base} AND kind = '_sessions'`),
  ]);
  const [daily, pages, used, via, clicks, out, fun, devices, countries, refs, me, total, seen, features, dwell, sessions] = results.map(r => r.results);
  return {
    rowsRead: rowsRead(results), rolled: true,
    site, days, from, to: dayOf(now - 86400000),
    daily, pages, used, via, clicks, out, fun, devices, countries, refs, seen, features, objects: [], dwell,
    me: me[0]?.visits ?? 0, visits: total[0]?.visits ?? 0, views: total[0]?.views ?? 0, visitors: null, players: null,
    sessions: sessions[0]?.n ?? 0, returning: sessions[0]?.back ?? 0,
  };
}

/** Every day of the range, so days without visits show as gaps rather than disappearing. */
function fillDays(r) {
  const byDay = new Map(r.daily.map(d => [d.day, d]));
  const out = [];
  for (let t = Date.parse(r.from); dayOf(t) <= r.to; t += 86400000) out.push(byDay.get(dayOf(t)) ?? { day: dayOf(t), visits: 0, views: 0 });
  return out;
}

function dailyChart(r) {
  const days = fillDays(r);
  const W = 720, H = 160, top = 16, bottom = 22, left = 4;
  const max = Math.max(1, ...days.map(d => d.visits));
  const step = (W - left) / days.length;
  const bw = Math.max(1, step - 2);
  const y = v => top + (H - top - bottom) * (1 - v / max);
  const base = H - bottom;
  const bars = days.map((d, i) => {
    const x = left + i * step;
    const h = base - y(d.visits);
    const r4 = Math.min(4, bw / 2, h);
    const shape = h <= 0 ? '' : `<path d="M${x},${base} v${-(h - r4)} q0,${-r4} ${r4},${-r4} h${bw - 2 * r4} q${r4},0 ${r4},${r4} v${h - r4} z" fill="${BAR}"/>`;
    return `<g><rect x="${x}" y="${top}" width="${step}" height="${base - top}" fill="transparent"/>${shape}<title>${esc(d.day)}: ${num(d.visits)} visits, ${num(d.views)} page views</title></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Visits per day, ${esc(r.from)} to ${esc(r.to)}; peak ${num(max)}">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="axis"/>
    <line x1="0" x2="${W}" y1="${top}" y2="${top}" class="grid"/>
    <text x="${W}" y="${top - 4}" text-anchor="end" class="tick">${num(max)} visits</text>
    ${bars}
    <text x="${left}" y="${H - 6}" class="tick">${esc(r.from)}</text>
    <text x="${W}" y="${H - 6}" text-anchor="end" class="tick">${esc(r.to)}</text>
  </svg>`;
}

/** A player's name (from the site's players.json, else what their browser sent), linked to their person view. */
export function playerLink(id, names, extra = '') {
  return `<a href="?view=person&amp;player=${esc(id)}${extra}">${esc(names.get(Number(id)) ?? `player ${id}`)}</a>`;
}

/** Links for a page's object (p123, m456, p1|p2): players to their person view, maps to the site. */
export function objectLink(obj, names, extra = '') {
  return String(obj).split('|').map(o => (o[0] === 'p' ? playerLink(o.slice(1), names, extra)
    : `<a href="${esc(CONFIG.production)}/#/map/${esc(o.slice(1))}">map ${esc(o.slice(1))}</a>`)).join(' vs ');
}

/** The page around every view: title, view tabs, range and site chips, and the notes at the bottom. */
export function shell(r, { view, title, body, nonce = '', query = '' }) {
  const ranges = view === 'overview' ? RANGES : RANGES.filter(d => d <= RAW_MAX);
  const link = (days, site, v = view) => `?view=${v}&amp;days=${days}&amp;site=${site}${v === view ? query : ''}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Usage · PT Catch</title>
<style>${CSS}</style></head><body><main>
<h1>${title}</h1>
<p class="muted">${esc(r.from)} to ${esc(r.to)} (UTC). A <b>visit</b> is one visitor on one day; a <b>session</b> ends after 30 minutes without activity.${r.rolled ? ' This range comes from the anonymous daily totals: no per-person numbers, and it ends yesterday.' : ''}</p>
${r.capped ? `<p class="cap"><b>Counting is paused until midnight UTC:</b> today reached the cap of ${num(DAILY_EVENT_CAP)} events that keeps the database inside Cloudflare's free plan (usage/store.js).</p>` : ''}
<nav class="views" aria-label="Views">${Object.entries(VIEWS).map(([k, v]) => `<a href="${link(k === 'overview' ? r.days : Math.min(r.days, RAW_MAX), r.site, k)}"${k === view ? ' aria-current="page"' : ''}>${v}</a>`).join('')}</nav>
<div class="bar">
  <span class="chips">${ranges.map(d => `<a href="${link(d, r.site)}"${d === r.days ? ' aria-current="true"' : ''}>${d} days</a>`).join(' ')}</span>
  <span class="chips">${Object.entries(SITES).map(([k, v]) => `<a href="${link(r.days, k)}"${k === r.site ? ' aria-current="true"' : ''}>${esc(v)}</a>`).join(' ')}</span>
</div>
${body}
<div class="note">
<p><b>What's recorded</b> is on the site's privacy page (#/privacy). Raw events, with visitor, session and player ids, are kept ${RAW_KEEP_DAYS} days; anonymous daily totals ${ROLLUP_KEEP_DAYS} days.
Browsers with Do Not Track or Global Privacy Control are never counted.</p>
<p><b>Your own visits:</b> <span id="me-state">counted on this browser</span>. <button type="button" id="me-toggle">Don't count this browser</button></p>
</div>
</main>
<script nonce="${esc(nonce)}">
(() => {
  const state = document.getElementById('me-state'), button = document.getElementById('me-toggle');
  const off = () => { try { return localStorage.getItem('ptctb:notrack') === '1'; } catch { return false; } };
  const draw = () => { state.textContent = off() ? 'not counted on this browser' : 'counted on this browser'; button.textContent = off() ? 'Count this browser again' : "Don't count this browser"; };
  button.addEventListener('click', () => { try { off() ? localStorage.removeItem('ptctb:notrack') : localStorage.setItem('ptctb:notrack', '1'); } catch {} draw(); });
  draw();
})();
</script></body></html>`;
}

export function renderDashboard(r, { nonce = '', names = new Map() } = {}) {
  const usedBy = new Map(r.used.map(u => [u.name, u.n]));
  const dwellBy = new Map(r.dwell.map(d => [d.name, d.total]));
  const maxVisits = Math.max(0, ...r.pages.map(p => p.visits));
  const sectionVisits = new Map();
  for (const p of r.pages) sectionVisits.set(p.name.split('/')[0], (sectionVisits.get(p.name.split('/')[0]) ?? 0) + p.visits);
  const unused = SECTIONS.filter(s => !sectionVisits.has(s));
  const phone = r.devices.find(d => d.name === 'phone')?.visits ?? 0;
  const viaTotal = r.via.reduce((a, v) => a + v.n, 0);
  const query = `&amp;days=${Math.min(r.days, RAW_MAX)}&amp;site=${r.site}`;

  const pagesTable = table(
    ['Page', { label: 'Views', num: true }, { label: 'Visits', num: true }, 'Share of visits', { label: 'Time per view', num: true }, { label: 'Used a control', num: true }],
    r.pages.map(p => [td(esc(p.name)), td(num(p.views), 'num'), td(num(p.visits), 'num'), td(`${meter(p.visits, maxVisits)} ${pct(p.visits, r.visits)}`),
      td(dwellBy.get(p.name) ? duration(dwellBy.get(p.name) / 1000 / p.views) : '–', 'num'),
      td(usedBy.has(p.name) ? pct(usedBy.get(p.name), p.views) : '–', 'num')]),
    'No page views in this period.');

  const body = `
<div class="tiles">
  <div class="tile"><b>${num(r.visits)}</b><span>visits</span></div>
  ${r.visitors === null ? '' : `<div class="tile"><b>${num(r.visitors)}</b><span>visitors</span></div>`}
  <div class="tile"><b>${num(r.views)}</b><span>page views</span></div>
  <div class="tile"><b>${r.visits ? (r.views / r.visits).toFixed(1) : '–'}</b><span>pages per visit</span></div>
  <div class="tile"><b>${pct(r.returning, r.sessions)}</b><span>of sessions by a returning visitor</span></div>
  <div class="tile"><b>${pct(phone, r.visits)}</b><span>of visits on a phone</span></div>
  <div class="tile"><b>${pct(r.me, r.visits)}</b><span>of visits with "This is me" set</span></div>
  ${r.players === null ? '' : `<div class="tile"><b>${num(r.players)}</b><span>known players</span></div>`}
</div>

<h2>Visits per day</h2>
<div class="card">${dailyChart(r)}</div>

<h2>Pages</h2>
<p class="muted">"Time per view": time with the page visible, per view. "Used a control": share of that page's views where the visitor typed in a field or changed a filter, toggle or select.</p>
${pagesTable}
${unused.length ? `<p class="warn">Not opened at all in this period: <b>${unused.map(esc).join(', ')}</b>.</p>` : ''}

${r.rolled ? '' : `<h2>Most-viewed profiles and maps</h2>
<p class="muted">Which players and maps people open (player pages, recaps, comparisons, map pages). Names link to what that player does on the site.</p>
${table(['Player or map', { label: 'Views', num: true }, { label: 'Visits', num: true }], r.objects.map(o => [td(objectLink(o.obj, names, query)), td(num(o.n), 'num'), td(num(o.visits), 'num')]), 'No profile or map views yet.')}`}

<h2>Features</h2>
<p class="muted">Searches (the shape of what was typed, never the text), filters, sorts and tabs that change the address, game results and sign-ins. Top 80.</p>
${table(['Feature', 'Page', 'What', { label: 'Times', num: true }, { label: 'Visits', num: true }],
  r.features.map(f => [td(esc(FEATURES[f.kind] ?? f.kind)), td(esc(f.name)), td(esc(f.detail)), td(num(f.n), 'num'), td(num(f.visits), 'num')]), 'No feature use recorded yet.')}

<h2>How far people read</h2>
<p class="muted">For each page, the share of its visits that scrolled each section heading into view, top of the page first. A section few people reach is a candidate to move up, shorten or cut.</p>
${table(['Page', 'Section', { label: 'Visits that saw it', num: true }, 'Share of the page’s visits'],
  r.seen.map(s => {
    const total = r.pages.filter(p => p.name === s.name).reduce((a, p) => a + p.visits, 0);
    return [td(esc(s.name)), td(esc(s.detail)), td(num(s.visits), 'num'), td(`${meter(s.visits, total)} ${pct(s.visits, total)}`)];
  }), 'No sections seen yet.')}

<div class="cols">
<div><h2>How people move around</h2>
<p class="muted">What the visitor clicked to open each page.</p>
${table(['Way in', { label: 'Page views', num: true }, 'Share'], r.via.map(v => [td(esc(VIA[v.detail] ?? v.detail)), td(num(v.n), 'num'), td(`${meter(v.n, viaTotal)} ${pct(v.n, viaTotal)}`)]))}</div>
<div><h2>Links out</h2>
${table(['Site', 'From page', { label: 'Clicks', num: true }], r.out.map(o => [td(esc(o.name)), td(esc(o.detail)), td(num(o.n), 'num')]))}</div>
</div>

<h2>Buttons pressed</h2>
<p class="muted">Every button, toggle and checkbox inside the pages, by label (digits shown as #). Top 60.</p>
${table(['Page', 'Button', { label: 'Presses', num: true }, { label: 'Visits', num: true }], r.clicks.map(c => [td(esc(c.name)), td(esc(c.detail)), td(num(c.n), 'num'), td(num(c.visits), 'num')]))}

<div class="cols">
<div><h2>Easter eggs and settings</h2>
${table(['What', '', { label: 'Times', num: true }, { label: 'Visits', num: true }], r.fun.map(f => [td(f.kind === 'egg' ? 'Easter egg' : 'Setting'), td(esc(`${f.name}${f.detail ? ` (${f.detail})` : ''}`)), td(num(f.n), 'num'), td(num(f.visits), 'num')]))}</div>
<div><h2>Screens</h2>
${table(['Screen', { label: 'Visits', num: true }], r.devices.map(d => [td(esc(d.name || 'unknown')), td(num(d.visits), 'num')]))}</div>
<div><h2>Countries</h2>
${table(['Country', { label: 'Visits', num: true }], r.countries.map(c => [td(esc(c.name || '??')), td(num(c.visits), 'num')]))}</div>
<div><h2>Came from</h2>
${table(['Site', { label: 'Visits started there', num: true }], r.refs.map(x => [td(esc(x.name)), td(num(x.n), 'num')]), 'No referring sites yet (Discord links often send none).')}</div>
</div>`;
  return shell(r, { view: 'overview', nonce, title: `Who uses what on ${esc(SITES[r.site] ?? r.site)}`, body });
}

/**
 * Player names from the site's own data (players.json on R2, the same file the site loads), so the dashboard can
 * name players who were only looked at. Empty when it can't be fetched: names then come from what browsers sent.
 */
export async function playerNames(dataUrl = CONFIG.data) {
  try {
    const get = url => fetch(url, { signal: AbortSignal.timeout(3000), cf: { cacheTtl: 3600 } }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    const meta = await get(`${dataUrl}meta.json`);
    const file = meta.files?.['players.json'] ? hashedName('players.json', meta.files['players.json']) : 'players.json';
    return new Map((await get(`${dataUrl}${file}`)).map(p => [p.id, p.name]));
  } catch {
    return new Map();
  }
}

/** Handles GET /stats. `names` (player id → name) is only passed by tests, to skip fetching players.json. */
export async function stats(request, env, now = Date.now(), { names } = {}) {
  const plain = (status, text, extra = {}) => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...extra } });
  if (!env.STATS_PASSWORD) return plain(503, 'The dashboard is off: set the STATS_PASSWORD secret on the Pages project.');
  if (!(await authorised(request, env.STATS_PASSWORD))) return plain(401, 'Sign in to see the usage dashboard.', { 'www-authenticate': 'Basic realm="PT-CTB usage", charset="UTF-8"' });
  if (!env.USAGE) return plain(503, 'No database: bind a D1 database as USAGE on the Pages project.');
  const url = new URL(request.url);
  const player = Number(url.searchParams.get('player'));
  const visitor = url.searchParams.get('visitor') ?? '';
  const who = Number.isSafeInteger(player) && player > 0 ? { player } : /^[0-9a-f]{16}$/.test(visitor) ? { visitor } : null;
  const view = who ? 'person' : Object.hasOwn(VIEWS, url.searchParams.get('view') ?? '') ? url.searchParams.get('view') : 'overview';
  const asked = Number(url.searchParams.get('days'));
  const days = view === 'overview' ? (RANGES.includes(asked) ? asked : 30) : (RANGES.includes(asked) && asked <= RAW_MAX ? asked : 30);
  const site = Object.hasOwn(SITES, url.searchParams.get('site') ?? '') ? url.searchParams.get('site') : 'prod';
  const rolled = view === 'overview' && days > RAW_MAX;
  // Free-plan guard: a long range over a busy year could read millions of rows (D1 Free: 5,000,000 a day, then every
  // query fails until midnight UTC), so a report that would take today's reads past DAILY_READ_BUDGET isn't run.
  const db = env.USAGE;
  await ensureSchema(db);
  const today = dayOf(now);
  const used = await usedToday(db, today);
  const estimate = (rolled ? READS_PER_ROLLED_EVENT : READS_PER_EVENT) * await eventsSince(db, dayOf(now - (days - 1) * 86400000));
  if (used.reads + estimate > DAILY_READ_BUDGET) {
    return plain(429, `Not run: the last ${days} days would read about ${estimate.toLocaleString('en-GB')} rows, and ${used.reads.toLocaleString('en-GB')} `
      + `of today's budget of ${DAILY_READ_BUDGET.toLocaleString('en-GB')} are used (Cloudflare D1's free plan allows 5,000,000 a day). `
      + 'Pick a shorter range, or come back after midnight UTC.', { 'retry-after': '3600' });
  }
  const r = view === 'people' ? await peopleReport(db, site, days, now)
    : view === 'health' ? await healthReport(db, site, days, now)
      : view === 'person' ? await personReport(db, site, days, who, now)
        : rolled ? await rollupReport(db, site, days, now) : await report(db, site, days, now);
  await noteReads(db, today, r.rowsRead ?? estimate);
  r.capped = used.events >= DAILY_EVENT_CAP;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  // Names of the players in the report: the site's players.json first, then the names visitors' browsers sent.
  const known = new Map([...(r.names ?? []), ...(names ?? (view === 'health' ? new Map() : await playerNames()))]);
  const parts = { nonce, names: known, shell, playerLink, objectLink, site: SITES[r.site] ?? r.site };
  const body = view === 'people' ? renderPeople(r, parts)
    : view === 'health' ? renderHealth(r, parts)
      : view === 'person' ? renderPerson(r, parts)
        : renderDashboard(r, { nonce, names: known });
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}
