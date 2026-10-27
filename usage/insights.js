// The dashboard's per-person views (usage/dashboard.js renders the page around them):
//   people  who uses the site: known players and what they look at, anonymous regulars, funnels, where sessions start
//           and end, which page follows which, and who comes back
//   health  errors, how long pages and data take, and the screens and browsers people use
//   person  one player (all their browsers) or one visitor: sessions, pages, features, latest events
// All read the raw events and sessions (usage/store.js), so they only cover the last RAW_KEEP_DAYS.

import { ensureSchema, dayOf } from './store.js';
import { esc, num, pct, ms, duration, when, quantile, meter, table, td, topBy } from './render.js';
import { CONFIG } from '../assets/js/config.js';

const rowsRead = results => {
  const metered = results.map(x => x.meta?.rows_read);
  return metered.every(n => Number.isFinite(n)) ? metered.reduce((a, b) => a + b, 0) : null;
};
const rangeOf = (days, now) => ({ from: dayOf(now - (days - 1) * 86400000), to: dayOf(now) });
const WHO = { verified: ['verified', 'Signed in with osu!, checked'], osu: ['osu!', 'Signed in with osu! (not checkable on this site)'], claimed: ['claimed', 'Picked with “This is me”: could be anyone'] };
const RANK = { verified: 3, osu: 2, claimed: 1, '': 0 };
const whoTag = who => (WHO[who] ? `<span class="tag${who === 'verified' ? ' ok' : ''}" title="${esc(WHO[who][1])}">${esc(WHO[who][0])}</span>` : '');

// Paths through the site worth watching: each step matches a page key (assets/js/app.js pageKey).
const FUNNELS = [
  ['Home → a profile → Compare', [/^home$/, /^player/, /^compare/]],
  ['Leaderboards → a profile', [/^rankings/, /^player/]],
  ['A profile → Compare', [/^player/, /^compare/]],
  ['Maps → a map', [/^maps/, /^map$/]],
  ['Home → Challenges', [/^home$/, /^challenges/]],
  ['Home → Games → finished a game', [/^home$/, /^games/, /^game:/]],
];

/** How far each session got through each funnel: sessions reaching step 1, 2, … in order (other pages in between are fine). */
export function funnels(sequences) {
  return FUNNELS.map(([label, steps]) => {
    const reached = steps.map(() => 0);
    for (const pages of sequences.values()) {
      let step = 0;
      for (const page of pages) if (step < steps.length && steps[step].test(page)) reached[step++]++;
    }
    return { label, steps: steps.map(s => s.source.replace(/[\^$]/g, '').replace('game:', 'finished a game')), reached };
  });
}

/** The ISO week (Monday) a day falls in, as its Monday's date. */
const weekOf = day => {
  const t = Date.parse(day);
  return dayOf(t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000);
};

export async function peopleReport(db, site, days, now = Date.now()) {
  await ensureSchema(db);
  const { from, to } = rangeOf(days, now);
  const base = 'FROM events WHERE env = ?1 AND day >= ?2';
  const q = sql => db.prepare(sql).bind(site, from);
  const results = await db.batch([
    q(`SELECT player, COUNT(*) AS events, SUM(kind = 'view') AS views, COUNT(DISTINCT day) AS days, COUNT(DISTINCT sid) AS sessions, MAX(ts) AS last
      ${base} AND player IS NOT NULL GROUP BY player ORDER BY days DESC, views DESC LIMIT 100`),
    q(`SELECT player, name, COUNT(*) AS n ${base} AND kind = 'view' AND player IS NOT NULL GROUP BY player, name`),
    q(`SELECT player, obj, COUNT(*) AS n ${base} AND kind = 'view' AND obj != '' AND player IS NOT NULL GROUP BY player, obj`),
    // How each player was given: from their sessions (a browser can switch "me"), names from the visitor rows.
    db.prepare(`SELECT player, who, '' AS name FROM sessions WHERE env = ?1 AND day >= ?2 AND player IS NOT NULL GROUP BY player, who
      UNION ALL SELECT player, who, name FROM visitors WHERE env = ?1 AND player IS NOT NULL`).bind(site, from),
    q(`SELECT visitor, COUNT(*) AS events, SUM(kind = 'view') AS views, COUNT(DISTINCT day) AS days, COUNT(DISTINCT sid) AS sessions, MAX(ts) AS last
      ${base} AND player IS NULL AND sid != '' AND visitor NOT IN (SELECT visitor FROM visitors WHERE player IS NOT NULL)
      GROUP BY visitor ORDER BY days DESC, views DESC LIMIT 25`),
    // Each session's pages in order, plus finished games as pseudo-pages, for funnels and "which page comes next".
    q(`SELECT sid, CASE WHEN kind = 'game' THEN 'game:' || name ELSE name END AS name ${base} AND kind IN ('view', 'game') AND sid != '' ORDER BY sid, ts, rowid LIMIT 30000`),
    db.prepare(`SELECT visitor, day, returned, entry, exit, views, last - start AS secs, player IS NOT NULL AS known
      FROM sessions WHERE env = ?1 AND day >= ?2 LIMIT 30000`).bind(site, from),
    db.prepare('SELECT visitor, first_day FROM visitors WHERE env = ?1 AND first_day >= ?2').bind(site, from),
  ]);
  const [players, playerPages, playerObjs, identities, anonymous, steps, sessions, firsts] = results.map(r => r.results);
  const best = new Map();
  for (const v of identities) {
    const was = best.get(v.player);
    best.set(v.player, { who: !was || RANK[v.who] > RANK[was.who] ? v.who : was.who, name: v.name || was?.name || '' });
  }
  const sequences = new Map();
  for (const s of steps) {
    if (!sequences.has(s.sid)) sequences.set(s.sid, []);
    const list = sequences.get(s.sid);
    if (list.at(-1) !== s.name) list.push(s.name);
  }
  return {
    rowsRead: rowsRead(results), site, days, from, to,
    players, anonymous, sessions, firsts, sequences, identities: best,
    names: [...best].filter(([, v]) => v.name).map(([id, v]) => [id, v.name]),
    playerPages: topBy(playerPages, 'player'), playerObjs: topBy(playerObjs, 'player'),
  };
}

/** Rows of [label, count] as a small table with share meters. */
function shares(head, entries, total, empty) {
  const max = Math.max(0, ...entries.map(e => e[1]));
  return table([head, { label: 'Sessions', num: true }, 'Share'], entries.map(([k, n]) => [td(esc(k)), td(num(n), 'num'), td(`${meter(n, max)} ${pct(n, total)}`)]), empty);
}
const counted = (rows, key, top = 10) => {
  const m = new Map();
  for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key]; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, top);
};

export function renderPeople(r, { nonce, names, shell, playerLink, objectLink, site }) {
  const query = `&amp;days=${r.days}&amp;site=${r.site}`;
  const s = r.sessions;
  const returning = s.filter(x => x.returned).length;
  const bounced = s.filter(x => x.views <= 1).length;
  const known = s.filter(x => x.known).length;

  // Coming back: visitors first seen in each week of the range, and the share seen again 1–4 weeks later.
  const weeksOf = new Map();
  for (const x of s) {
    if (!weeksOf.has(x.visitor)) weeksOf.set(x.visitor, new Set());
    weeksOf.get(x.visitor).add(weekOf(x.day));
  }
  const cohorts = new Map();
  for (const v of r.firsts) {
    const week = weekOf(v.first_day);
    if (!cohorts.has(week)) cohorts.set(week, { size: 0, back: [0, 0, 0, 0] });
    const c = cohorts.get(week);
    c.size++;
    for (let k = 1; k <= 4; k++) if (weeksOf.get(v.visitor)?.has(dayOf(Date.parse(week) + k * 7 * 86400000))) c.back[k - 1]++;
  }
  const lastWeek = weekOf(r.to);
  const daysOf = new Map();
  for (const x of s) {
    if (!daysOf.has(x.visitor)) daysOf.set(x.visitor, new Set());
    daysOf.get(x.visitor).add(x.day);
  }
  const BANDS = [['1 day', 1, 1], ['2 days', 2, 2], ['3–5 days', 3, 5], ['6–10 days', 6, 10], ['11 days or more', 11, Infinity]];
  const frequency = BANDS.map(([label, lo, hi]) => [label, [...daysOf.values()].filter(d => d.size >= lo && d.size <= hi).length]);

  const transitions = new Map();
  for (const pages of r.sequences.values()) {
    for (let i = 1; i < pages.length; i++) {
      const k = `${pages[i - 1]} → ${pages[i]}`;
      transitions.set(k, (transitions.get(k) ?? 0) + 1);
    }
  }
  const nextPages = [...transitions].sort((a, b) => b[1] - a[1]).slice(0, 20);

  const body = `
<div class="tiles">
  <div class="tile"><b>${num(s.length)}</b><span>sessions</span></div>
  <div class="tile"><b>${num(weeksOf.size)}</b><span>visitors</span></div>
  <div class="tile"><b>${pct(returning, s.length)}</b><span>of sessions by a returning visitor</span></div>
  <div class="tile"><b>${duration(quantile(s.map(x => x.secs), 0.5))}</b><span>median session (first to last event)</span></div>
  <div class="tile"><b>${pct(bounced, s.length)}</b><span>of sessions saw one page</span></div>
  <div class="tile"><b>${pct(known, s.length)}</b><span>of sessions by a known player</span></div>
</div>

<h2>Players</h2>
<p class="muted">Visitors who said who they are: <span class="tag ok">verified</span> signed in with osu! (checked), <span class="tag">osu!</span> signed in on a site that can't check it, <span class="tag">claimed</span> pressed “This is me”, which anyone can do for anyone. Names open everything that player did.</p>
${table(['Player', { label: 'Days', num: true }, { label: 'Sessions', num: true }, { label: 'Page views', num: true }, 'Last seen', 'Mostly opens', 'Looks at'],
  r.players.map(p => [
    td(`${playerLink(p.player, names, query)} ${whoTag(r.identities.get(p.player)?.who)}`),
    td(num(p.days), 'num'), td(num(p.sessions), 'num'), td(num(p.views), 'num'), td(esc(when(p.last)), 'nowrap small'),
    td(esc((r.playerPages.get(p.player) ?? []).map(x => `${x.name} (${x.n})`).join(', ')), 'small'),
    td((r.playerObjs.get(p.player) ?? []).map(x => `${objectLink(x.obj, names, query)} (${x.n})`).join(', '), 'small'),
  ]), 'No known players in this period.')}

<h2>Regulars who haven't said who they are</h2>
<p class="muted">The most active visitors without a player, by random id. If one of them later presses “This is me”, their earlier visits join that player.</p>
${table(['Visitor', { label: 'Days', num: true }, { label: 'Sessions', num: true }, { label: 'Page views', num: true }, 'Last seen'],
  r.anonymous.map(v => [td(`<a href="?view=person&amp;visitor=${esc(v.visitor)}${query}">${esc(v.visitor.slice(0, 8))}</a>`), td(num(v.days), 'num'), td(num(v.sessions), 'num'), td(num(v.views), 'num'), td(esc(when(v.last)), 'nowrap small')]),
  'No anonymous visitors with an id yet.')}

<h2>Funnels</h2>
<p class="muted">Sessions that opened each page in this order (other pages in between are fine), and the share that went on from the step before.</p>
${table(['Path', 'Step 1', 'Step 2', 'Step 3'], funnels(r.sequences).map(f => [td(esc(f.label)),
  ...[0, 1, 2].map(i => td(i >= f.steps.length ? '' : `${esc(f.steps[i])}: <b>${num(f.reached[i])}</b>${i ? ` <span class="muted">${pct(f.reached[i], f.reached[i - 1])}</span>` : ''}`, 'small'))]))}

<div class="cols">
<div><h2>Where sessions start</h2>${shares('First page', counted(s.filter(x => x.entry), 'entry'), s.length, 'No sessions yet.')}</div>
<div><h2>Where they end</h2>${shares('Last page', counted(s.filter(x => x.exit), 'exit'), s.length, 'No sessions yet.')}</div>
</div>

<h2>Which page comes next</h2>
<p class="muted">The most common moves from one page to the next within a session. Top 20.</p>
${table(['From → to', { label: 'Times', num: true }], nextPages.map(([k, n]) => [td(esc(k)), td(num(n), 'num')]), 'Not enough sessions yet.')}

<div class="cols">
<div><h2>Coming back</h2>
<p class="muted">Visitors first seen each week, and the share seen again 1, 2, 3 and 4 weeks later (– is still to come).</p>
${table(['First week', { label: 'New', num: true }, { label: '+1', num: true }, { label: '+2', num: true }, { label: '+3', num: true }, { label: '+4', num: true }],
  [...cohorts].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([week, c]) => [td(esc(week)), td(num(c.size), 'num'),
    ...c.back.map((n, k) => td(dayOf(Date.parse(week) + (k + 1) * 7 * 86400000) > lastWeek ? '–' : pct(n, c.size), 'num'))]), 'No new visitors in this period.')}</div>
<div><h2>How often</h2>
<p class="muted">Visitors by the number of days they came in this period.</p>
${table(['Came on', { label: 'Visitors', num: true }, 'Share'], frequency.map(([k, n]) => [td(esc(k)), td(num(n), 'num'), td(`${meter(n, daysOf.size)} ${pct(n, daysOf.size)}`)]))}</div>
</div>`;
  return shell(r, { view: 'people', nonce, title: `Who uses ${esc(site)}`, body });
}

export async function healthReport(db, site, days, now = Date.now()) {
  await ensureSchema(db);
  const { from, to } = rangeOf(days, now);
  const base = 'FROM events WHERE env = ?1 AND day >= ?2';
  const q = sql => db.prepare(sql).bind(site, from);
  const results = await db.batch([
    q(`SELECT name, detail, COUNT(*) AS n, COUNT(DISTINCT sid) AS sessions, COUNT(DISTINCT visitor) AS visitors, MAX(ts) AS last
      ${base} AND kind = 'err' GROUP BY name, detail ORDER BY n DESC LIMIT 40`),
    db.prepare(`SELECT e.name, s.browser || ' ' || s.os AS agent, COUNT(*) AS n FROM events e JOIN sessions s ON s.sid = e.sid
      WHERE e.env = ?1 AND e.day >= ?2 AND e.kind = 'err' GROUP BY e.name, agent`).bind(site, from),
    q(`SELECT name, val ${base} AND kind = 'view' AND val IS NOT NULL LIMIT 40000`),
    q(`SELECT name, val, device ${base} AND kind = 'perf' LIMIT 20000`),
    q(`SELECT name, val ${base} AND kind = 'fetch' LIMIT 20000`),
    db.prepare('SELECT device, browser, os, vw, scheme, lang FROM sessions WHERE env = ?1 AND day >= ?2 LIMIT 30000').bind(site, from),
  ]);
  const [errors, agents, renders, perf, fetches, sessions] = results.map(r => r.results);
  return { rowsRead: rowsRead(results), site, days, from, to, errors, agents: topBy(agents, 'name', 2), renders, perf, fetches, sessions };
}

/** Values grouped by `key`, as { key, count, p50, p75, p95, slow } sorted by p75, slowest first. */
function timings(rows, key, slowMs = 1000) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r[key])) groups.set(r[key], []);
    groups.get(r[key]).push(r.val);
  }
  return [...groups].map(([k, v]) => ({ key: k, count: v.length, p50: quantile(v, 0.5), p75: quantile(v, 0.75), p95: quantile(v, 0.95), slow: v.filter(x => x >= slowMs).length }))
    .sort((a, b) => b.p75 - a.p75);
}

const WIDTHS = [['under 360 px', 0, 359], ['360–399', 360, 399], ['400–599', 400, 599], ['600–1023', 600, 1023], ['1024–1439', 1024, 1439], ['1440 and up', 1440, Infinity]];

export function renderHealth(r, { nonce, shell, site }) {
  const s = r.sessions;
  const errorSessions = r.errors.reduce((a, e) => a + e.sessions, 0);
  const metric = name => r.perf.filter(p => p.name === name).map(p => p.val);
  const slowFetches = r.fetches.filter(f => f.val >= 1000).length;
  const METRICS = { ttfb: 'Server response (TTFB)', fcp: 'First paint', lcp: 'Largest paint', load: 'Page loaded' };
  const DEVICES = ['phone', 'tablet', 'desktop'];
  const cell = values => (values.length ? `${ms(quantile(values, 0.5))} <span class="muted">/ ${ms(quantile(values, 0.75))}</span>` : '–');
  const timingTable = (head, rows, empty) => table([head, { label: 'Times', num: true }, { label: 'Median', num: true }, { label: '75th %', num: true }, { label: '95th %', num: true }, { label: 'Over 1 s', num: true }],
    rows.map(t => [td(esc(t.key)), td(num(t.count), 'num'), td(ms(t.p50), 'num'), td(ms(t.p75), 'num'), td(ms(t.p95), 'num'), td(pct(t.slow, t.count), 'num')]), empty);
  const width = WIDTHS.map(([label, lo, hi]) => [label, s.filter(x => x.vw >= lo && x.vw <= hi).length]);

  const body = `
<div class="tiles">
  <div class="tile"><b>${num(r.errors.reduce((a, e) => a + e.n, 0))}</b><span>errors</span></div>
  <div class="tile"><b>${pct(errorSessions, s.length)}</b><span>of sessions hit an error</span></div>
  <div class="tile"><b>${ms(quantile(metric('ttfb'), 0.5))}</b><span>median server response</span></div>
  <div class="tile"><b>${ms(quantile(metric('lcp'), 0.75))}</b><span>largest paint, 75th percentile</span></div>
  <div class="tile"><b>${ms(quantile(r.renders.map(x => x.val), 0.75))}</b><span>page drawn after a click, 75th percentile</span></div>
  <div class="tile"><b>${pct(slowFetches, r.fetches.length)}</b><span>of data downloads over 1 s</span></div>
</div>

<h2>Errors</h2>
<p class="muted">Script errors and pages that showed “Something went wrong”, grouped by message (addresses and numbers taken out) and where they happened.</p>
${table(['Message', 'Where', { label: 'Times', num: true }, { label: 'Sessions', num: true }, { label: 'Visitors', num: true }, 'Browsers', 'Last'],
  r.errors.map(e => [td(esc(e.name)), td(esc(e.detail), 'small'), td(num(e.n), 'num'), td(num(e.sessions), 'num'), td(num(e.visitors), 'num'),
    td(esc((r.agents.get(e.name) ?? []).map(a => a.agent).join(', ')), 'small'), td(esc(when(e.last)), 'nowrap small')]), 'No errors recorded. Nice.')}

<h2>Slow pages</h2>
<p class="muted">From the address changing to the page drawn, including its data downloads. Slowest (75th percentile) first.</p>
${timingTable('Page', timings(r.renders, 'name'), 'No timed page views yet.')}

<div class="cols">
<div><h2>First load</h2>
<p class="muted">The first page of each visit: median / 75th percentile, by screen.</p>
${table(['Timing', ...DEVICES, 'All'], Object.entries(METRICS).map(([k, label]) => [td(esc(label)),
  ...DEVICES.map(d => td(cell(r.perf.filter(p => p.name === k && p.device === d).map(p => p.val)), 'num small')), td(cell(metric(k)), 'num small')]))}</div>
<div><h2>Data downloads</h2>
<p class="muted">Files from ${esc(CONFIG.data)}, not counting ones the browser had cached.</p>
${timingTable('File', timings(r.fetches, 'name'), 'No data downloads timed yet.')}</div>
</div>

<h2>Screens and browsers</h2>
<p class="muted">By session.</p>
<div class="cols">
<div>${shares('Screen', counted(s, x => x.device || 'unknown'), s.length)}</div>
<div>${shares('Window width', width.filter(([, n]) => n), s.length)}</div>
<div>${shares('Browser', counted(s, 'browser'), s.length)}</div>
<div>${shares('System', counted(s, 'os'), s.length)}</div>
<div>${shares('Prefers', counted(s, x => x.scheme || 'unknown'), s.length)}</div>
<div>${shares('Language', counted(s, x => x.lang || 'unknown'), s.length)}</div>
</div>`;
  return shell(r, { view: 'health', nonce, title: `What gets in the way on ${esc(site)}`, body });
}

export async function personReport(db, site, days, who, now = Date.now()) {
  await ensureSchema(db);
  const { from, to } = rangeOf(days, now);
  const key = who.player ?? who.visitor;
  // A player is every browser that ever said it was them, including what it did before it said so.
  const mine = who.player ? '(player = ?3 OR visitor IN (SELECT visitor FROM visitors WHERE player = ?3))' : 'visitor = ?3';
  const base = `FROM events WHERE env = ?1 AND day >= ?2 AND ${mine}`;
  const q = sql => db.prepare(sql).bind(site, from, key);
  const results = await db.batch([
    db.prepare(`SELECT * FROM visitors WHERE env = ?1 AND ${who.player ? 'player' : 'visitor'} = ?2 ORDER BY last DESC`).bind(site, key),
    db.prepare(`SELECT * FROM sessions WHERE env = ?1 AND day >= ?2 AND ${mine} ORDER BY start DESC LIMIT 60`).bind(site, from, key),
    q(`SELECT name, COUNT(*) AS n ${base} AND kind = 'view' GROUP BY name ORDER BY n DESC`),
    q(`SELECT name, SUM(val) AS total ${base} AND kind = 'dwell' GROUP BY name`),
    q(`SELECT obj, COUNT(*) AS n ${base} AND kind = 'view' AND obj != '' GROUP BY obj ORDER BY n DESC LIMIT 20`),
    q(`SELECT kind, name, detail, COUNT(*) AS n ${base} AND kind IN ('search', 'filter', 'game', 'auth', 'pref', 'click', 'out', 'err') GROUP BY kind, name, detail ORDER BY n DESC LIMIT 40`),
    q(`SELECT ts, sid, kind, name, detail, val, obj ${base} AND kind != 'seen' ORDER BY ts DESC, rowid DESC LIMIT 150`),
  ]);
  const [visitors, sessions, pages, dwell, objects, features, latest] = results.map(r => r.results);
  const named = visitors.find(v => v.name);
  return {
    rowsRead: rowsRead(results), site, days, from, to, who, visitors, sessions, pages, dwell, objects, features, latest,
    names: who.player && named ? [[who.player, named.name]] : [],
  };
}

export function renderPerson(r, { nonce, names, shell, objectLink, site }) {
  const query = `&amp;days=${r.days}&amp;site=${r.site}`;
  const best = r.visitors.reduce((a, v) => (RANK[v.who] > RANK[a?.who ?? ''] ? v : a), null);
  const title = r.who.player ? `${esc(names.get(r.who.player) ?? `Player ${r.who.player}`)} ${whoTag(best?.who)}` : `Visitor ${esc(r.who.visitor.slice(0, 8))}`;
  const dwellBy = new Map(r.dwell.map(d => [d.name, d.total]));
  const timeOnSite = r.dwell.reduce((a, d) => a + d.total, 0) / 1000;
  const first = Math.min(...r.visitors.map(v => v.first)), last = Math.max(...r.visitors.map(v => v.last));
  const facts = r.visitors.length ? `First seen ${esc(when(first))}, last ${esc(when(last))}, on ${num(r.visitors.length)} browser${r.visitors.length === 1 ? '' : 's'} (${num(r.visitors.reduce((a, v) => a + v.days, 0))} active days in all).` : 'No visitor record (older than the raw data, or deleted on request).';
  const body = `
<p>${facts}${r.who.player ? ` <a href="${esc(CONFIG.production)}/#/player/${esc(r.who.player)}">Their profile on the site</a>.` : ''} <a href="?view=people${query}">← All people</a></p>
<div class="tiles">
  <div class="tile"><b>${num(r.sessions.length)}</b><span>sessions${r.sessions.length === 60 ? ' (latest 60)' : ''}</span></div>
  <div class="tile"><b>${num(r.pages.reduce((a, p) => a + p.n, 0))}</b><span>page views</span></div>
  <div class="tile"><b>${duration(timeOnSite)}</b><span>time with a page visible</span></div>
  <div class="tile"><b>${duration(quantile(r.sessions.map(s => s.last - s.start), 0.5))}</b><span>median session</span></div>
</div>

<div class="cols">
<div><h2>Pages</h2>
${table(['Page', { label: 'Views', num: true }, { label: 'Time', num: true }], r.pages.map(p => [td(esc(p.name)), td(num(p.n), 'num'), td(duration((dwellBy.get(p.name) ?? 0) / 1000), 'num')]), 'No page views in this period.')}</div>
<div><h2>Players and maps they look at</h2>
${table(['Player or map', { label: 'Views', num: true }], r.objects.map(o => [td(objectLink(o.obj, names, query)), td(num(o.n), 'num')]), 'None in this period.')}</div>
</div>

<h2>What they use</h2>
${table(['Kind', 'Page or name', 'What', { label: 'Times', num: true }], r.features.map(f => [td(esc(f.kind)), td(esc(f.name)), td(esc(f.detail)), td(num(f.n), 'num')]), 'Nothing recorded in this period.')}

<h2>Sessions</h2>
${table(['Started', { label: 'Length', num: true }, { label: 'Pages', num: true }, 'Path', 'Device', 'Came from', 'As'],
  r.sessions.map(s => [td(esc(when(s.start)), 'nowrap small'), td(duration(s.last - s.start), 'num'), td(num(s.views), 'num'),
    td(esc(`${s.entry || '?'}${s.exit && s.exit !== s.entry ? ` → … → ${s.exit}` : ''}`), 'small'),
    td(esc([s.device, s.browser, s.os, s.vw ? `${s.vw}×${s.vh}` : ''].filter(Boolean).join(' · ')), 'small'), td(esc(s.ref || '–'), 'small'),
    td(s.player ? whoTag(s.who) : '<span class="muted small">anonymous</span>')]), 'No sessions in this period.')}

<h2>Latest events</h2>
<p class="muted">Newest first, 150 at most (section headings scrolled into view left out).</p>
${table(['Time', 'Kind', 'Page or name', 'Detail', { label: 'Value', num: true }, 'About'],
  r.latest.map(e => [td(esc(when(e.ts)), 'nowrap small'), td(esc(e.kind)), td(esc(e.name)), td(esc(e.detail), 'small'),
    td(e.val === null ? '' : esc(['dwell', 'perf', 'fetch', 'view'].includes(e.kind) ? ms(e.val) : num(e.val)), 'num small'), td(e.obj ? objectLink(e.obj, names, query) : '', 'small')]), 'Nothing in this period.')}`;
  return shell(r, { view: 'person', nonce, title: `${title} <span class="muted">on ${esc(site)}</span>`, body, query: `&amp;${r.who.player ? `player=${r.who.player}` : `visitor=${esc(r.who.visitor)}`}` });
}
