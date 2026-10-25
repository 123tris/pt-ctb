// GET /stats: the owner's usage dashboard, rendered on the server from the USAGE database (usage/store.js).
// Protected by HTTP Basic auth: any user name, the password is the STATS_PASSWORD secret of the Pages project.
// No JavaScript is needed to read it; one tiny inline script (allowed by nonce) runs the "don't count me" switch,
// which sets the same ptctb:notrack flag assets/js/core/track.js checks.

import { ensureSchema, dayOf, KEEP_DAYS } from './store.js';

const RANGES = [7, 30, 90, 365];
const SITES = { prod: 'ptcatch.com', dev: 'dev.ptcatch.com', preview: 'previews' };
// The site's top-level pages (assets/js/app.js ROUTES), so a page nobody opened still shows up, with 0.
const SECTIONS = ['home', 'rankings', 'players', 'player', 'maps', 'map', 'activity', 'challenges', 'games', 'calculator',
  'compare', 'records', 'recap', 'commands', 'verify', 'team', 'glossary'];
const VIA = { nav: 'Top menu', 'more-menu': '"More" menu', search: 'Header search', page: 'A link on the page', footer: 'Footer', 'you-menu': 'Avatar menu', direct: 'Direct, shared link or Back' };
const BAR = '#e85a78'; // the site's rose, one step darker so bars sit in the chart lightness band (checked with the dataviz validator)

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = n => Number(n ?? 0).toLocaleString('en-GB');
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');

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

/** All the numbers for one site and range, in one round trip to the database. */
export async function report(db, site, days, now = Date.now()) {
  await ensureSchema(db);
  const from = dayOf(now - (days - 1) * 86400000);
  const base = 'FROM events WHERE env = ?1 AND day >= ?2';
  const visit = "COUNT(DISTINCT day || visitor)";
  const q = sql => db.prepare(sql).bind(site, from);
  const [daily, pages, used, via, clicks, out, fun, devices, countries, refs, me, total, seen] = await db.batch([
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
    q(`SELECT ${visit} AS visits, SUM(kind = 'view') AS views ${base}`),
    // Earliest time first seen = roughly the order down the page, so sections list top to bottom.
    q(`SELECT name, detail, ${visit} AS visits, MIN(rowid) AS first ${base} AND kind = 'seen' GROUP BY name, detail ORDER BY name, first LIMIT 200`),
  ]);
  return {
    site, days, from, to: dayOf(now),
    daily: daily.results, pages: pages.results, used: used.results, via: via.results, clicks: clicks.results,
    out: out.results, fun: fun.results, devices: devices.results, countries: countries.results, refs: refs.results, seen: seen.results,
    me: me.results[0]?.visits ?? 0, visits: total.results[0]?.visits ?? 0, views: total.results[0]?.views ?? 0,
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

const meter = (n, max) => `<span class="meter"><span style="width:${max ? Math.max(1, Math.round((100 * n) / max)) : 0}%"></span></span>`;

function table(head, rows, empty = 'Nothing yet.') {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<div class="table-wrap"><table><thead><tr>${head.map(h => `<th${h.num ? ' class="num"' : ''}>${esc(h.label ?? h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.join('')}</tr>`).join('')}</tbody></table></div>`;
}
const td = (v, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${v}</td>`;

export function renderDashboard(r, { nonce = '' } = {}) {
  const usedBy = new Map(r.used.map(u => [u.name, u.n]));
  const maxVisits = Math.max(0, ...r.pages.map(p => p.visits));
  const sectionVisits = new Map();
  for (const p of r.pages) sectionVisits.set(p.name.split('/')[0], (sectionVisits.get(p.name.split('/')[0]) ?? 0) + p.visits);
  const unused = SECTIONS.filter(s => !sectionVisits.has(s));
  const phone = r.devices.find(d => d.name === 'phone')?.visits ?? 0;
  const viaTotal = r.via.reduce((a, v) => a + v.n, 0);
  const link = (days, site) => `?days=${days}&site=${site}`;

  const pagesTable = table(
    ['Page', { label: 'Views', num: true }, { label: 'Visits', num: true }, 'Share of visits', { label: 'Used a control', num: true }],
    r.pages.map(p => [td(esc(p.name)), td(num(p.views), 'num'), td(num(p.visits), 'num'), td(`${meter(p.visits, maxVisits)} ${pct(p.visits, r.visits)}`),
      td(usedBy.has(p.name) ? pct(usedBy.get(p.name), p.views) : '–', 'num')]),
    'No page views in this period.');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Usage · PT Catch</title>
<style>
:root { --bg:#1f191b; --surface:#2a2225; --line:#3d3236; --text:#f3ecee; --muted:#a09095; --accent:#ff6b89; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:1080px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:24px; margin:0 0 4px; } h2 { font-size:17px; margin:32px 0 8px; } p { margin:4px 0 8px; }
a { color:var(--accent); } .muted, .tick { color:var(--muted); fill:var(--muted); font-size:12px; }
.bar { display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; margin:12px 0 20px; }
.chips a { display:inline-block; padding:3px 10px; border:1px solid var(--line); border-radius:999px; text-decoration:none; color:var(--text); font-size:13px; }
.chips a[aria-current] { background:var(--accent); border-color:var(--accent); color:#1f191b; font-weight:600; }
.tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px; }
.tile { background:var(--surface); border-radius:6px; padding:12px 14px; }
.tile b { display:block; font-size:26px; font-variant-numeric:tabular-nums; } .tile span { color:var(--muted); font-size:13px; }
.card { background:var(--surface); border-radius:6px; padding:14px; }
.chart { width:100%; height:auto; display:block; } .axis { stroke:var(--line); stroke-width:1; } .grid { stroke:var(--line); stroke-width:1; opacity:.5; }
.chart g:hover path { opacity:.8; }
.cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:0 24px; }
.table-wrap { overflow-x:auto; } table { width:100%; border-collapse:collapse; font-size:14px; }
th { text-align:left; color:var(--muted); font-weight:500; font-size:12px; border-bottom:1px solid var(--line); padding:6px 8px; }
td { border-bottom:1px solid var(--line); padding:6px 8px; } .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.meter { display:inline-block; width:90px; height:6px; background:var(--line); border-radius:3px; vertical-align:middle; margin-right:6px; }
.meter span { display:block; height:100%; background:${BAR}; border-radius:3px; }
.note { margin-top:40px; color:var(--muted); font-size:13px; } button { font:inherit; padding:4px 10px; border-radius:4px; border:1px solid var(--line); background:var(--surface); color:var(--text); cursor:pointer; }
.warn { border-left:3px solid var(--accent); padding-left:10px; }
</style></head><body><main>
<h1>Who uses what on ${esc(SITES[r.site] ?? r.site)}</h1>
<p class="muted">${esc(r.from)} to ${esc(r.to)} (UTC). A <b>visit</b> is one visitor on one day: visitors can't be followed across days, by design.</p>
<div class="bar">
  <span class="chips">${RANGES.map(d => `<a href="${link(d, r.site)}"${d === r.days ? ' aria-current="true"' : ''}>${d} days</a>`).join(' ')}</span>
  <span class="chips">${Object.entries(SITES).map(([k, v]) => `<a href="${link(r.days, k)}"${k === r.site ? ' aria-current="true"' : ''}>${esc(v)}</a>`).join(' ')}</span>
</div>

<div class="tiles">
  <div class="tile"><b>${num(r.visits)}</b><span>visits</span></div>
  <div class="tile"><b>${num(r.views)}</b><span>page views</span></div>
  <div class="tile"><b>${r.visits ? (r.views / r.visits).toFixed(1) : '–'}</b><span>pages per visit</span></div>
  <div class="tile"><b>${pct(phone, r.visits)}</b><span>of visits on a phone</span></div>
  <div class="tile"><b>${pct(r.me, r.visits)}</b><span>of visits with "This is me" set</span></div>
</div>

<h2>Visits per day</h2>
<div class="card">${dailyChart(r)}</div>

<h2>Pages</h2>
<p class="muted">"Used a control": share of that page's views where the visitor typed in a field or changed a filter, toggle or select.</p>
${pagesTable}
${unused.length ? `<p class="warn">Not opened at all in this period: <b>${unused.map(esc).join(', ')}</b>.</p>` : ''}

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
</div>

<div class="note">
<p><b>What's recorded.</b> Page views, which section headings scrolled into view, button presses, links out, easter eggs and the "This is me" switch, with the screen size class and country.
No cookies, no IP addresses, no user agents and no ids: a visitor hash that changes every day (its salt is deleted at midnight UTC).
Browsers with Do Not Track or Global Privacy Control are never counted. Events are deleted after ${KEEP_DAYS} days.</p>
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

/** Handles GET /stats. */
export async function stats(request, env, now = Date.now()) {
  const plain = (status, text, extra = {}) => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...extra } });
  if (!env.STATS_PASSWORD) return plain(503, 'The dashboard is off: set the STATS_PASSWORD secret on the Pages project.');
  if (!(await authorised(request, env.STATS_PASSWORD))) return plain(401, 'Sign in to see the usage dashboard.', { 'www-authenticate': 'Basic realm="PT-CTB usage", charset="UTF-8"' });
  if (!env.USAGE) return plain(503, 'No database: bind a D1 database as USAGE on the Pages project.');
  const url = new URL(request.url);
  const days = RANGES.includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
  const site = Object.hasOwn(SITES, url.searchParams.get('site') ?? '') ? url.searchParams.get('site') : 'prod';
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const body = renderDashboard(await report(env.USAGE, site, days, now), { nonce });
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
