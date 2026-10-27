// Storage for the usage counts: one D1 database (bound to the Pages project as USAGE).
//
// Who an event belongs to. Every browser that allows counting gets a random visitor id and a session id from
// assets/js/core/track.js (localStorage, first-party, nothing derived from the device). When the visitor has said who
// they are on osu! ("This is me", or "Sign in with osu!"), their events carry that player id too, marked as how it was
// given: 'claimed' (picked by hand, so it could be anyone), 'osu' (signed in, but this site can't check it: dev) or
// 'verified' (signed in, and the proof from /auth/callback checks out: signin/proof.js). Browsers too old to send an
// id fall back to the old daily hash (SHA-256 of a per-day salt + IP + user agent, the salt deleted the next day).
//
// What's never stored: IP addresses, user agents (only the browser family and OS, worked out here), cookies, search
// text. The IP is only ever hashed with today's salt, as the key of the per-source rate limit (`limits`), and that
// row goes with the salt at midnight UTC.
//
// Tables:
//   events    one row per event: page views, clicks, timings, errors… (kinds below), with visitor, session, player
//   sessions  one row per session: start/end, entry/exit page, referrer, device, browser, OS, screen, scheme, language
//   visitors  one row per visitor id: first/last seen, active days, sessions, player and name (if given)
//   rollup    anonymous daily counts (no ids at all), kept longer than the raw rows; the 365-day dashboard reads these
//   quota     per UTC day: events, rows written (estimated) and rows the dashboard read, for the free-plan caps
//   limits    per UTC day and source (salted IP hash): events, for the per-source cap
//   salts     today's salt; forget: visitor ids whose data is to be deleted (the privacy page's "delete")
//
// Retention: raw events and sessions RAW_KEEP_DAYS, visitor rows VISITOR_KEEP_DAYS after their last visit, the
// anonymous rollup ROLLUP_KEEP_DAYS. Clean-up and the rollup run on the first event of each UTC day.

import { checkProof } from '../signin/proof.js';

export const RAW_KEEP_DAYS = 180;
export const VISITOR_KEEP_DAYS = 395; // ~13 months
export const ROLLUP_KEEP_DAYS = 760; // ~25 months
export const KEEP_DAYS = RAW_KEEP_DAYS;

const KINDS = new Set(['view', 'seen', 'use', 'click', 'out', 'egg', 'pref', 'filter', 'dwell', 'search', 'err', 'perf', 'fetch', 'auth', 'game']);
// assets/js/core/track.js sends at most 20 events per batch; a few more are allowed, but not a flood per request.
const MAX_EVENTS = 25;

// Free-plan guard. D1 on Workers Free allows 100,000 rows written and 5,000,000 rows read per day (all databases of
// the account, reset at 00:00 UTC; queries fail once either is used up) and 500 MB per database.
//   - An event costs 2 rows written (the row and its events_by_day entry). A batch adds about BATCH_WRITES more: the
//     quota and limits counters, the session and visitor rows (and their keys the first time).
//   - DAILY_EVENT_CAP events a day (all sites together), then nothing until midnight UTC. DAILY_WRITE_CAP stops a flood
//     of tiny batches, which cost more per event. Either way at most ~45,000 rows written a day, under half the quota.
//   - SOURCE_DAILY_CAP events per source (salted IP hash) a day, so one script or runaway tab can't use the day up
//     for everyone. Visitor ids can't be the key: a script makes up a new one per request.
//   - Storage: ~200 bytes per event with its index, so 8,000 × 180 days ≈ 290 MB at the very most; sessions, visitors
//     and the rollup add a few MB.
// The dashboard keeps its reads under DAILY_READ_BUDGET the same way (usage/dashboard.js). See notes/free-tier-audit.md.
export const DAILY_EVENT_CAP = 8000;
export const DAILY_WRITE_CAP = 45_000;
export const SOURCE_DAILY_CAP = 1500;
export const DAILY_READ_BUDGET = 2_000_000;
const BATCH_WRITES = 6;

/** Labels keep letters, digits and plain punctuation only (no markup, emoji or control characters), 60 at most. */
const label = s => (typeof s === 'string' ? s.replace(/[^\p{L}\p{N} #'’&.,:/!?()+\-–—…→←]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60) : '');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    ts INTEGER NOT NULL, day TEXT NOT NULL, env TEXT NOT NULL, visitor TEXT NOT NULL,
    kind TEXT NOT NULL, name TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '', me INTEGER NOT NULL DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS events_by_day ON events (env, day, kind)',
  'CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)',
  // Per UTC day: events recorded, rows written (estimated) and rows the dashboard read, for the free-plan caps above.
  'CREATE TABLE IF NOT EXISTS quota (day TEXT PRIMARY KEY, events INTEGER NOT NULL DEFAULT 0, reads INTEGER NOT NULL DEFAULT 0)',
  `CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY, env TEXT NOT NULL, visitor TEXT NOT NULL, day TEXT NOT NULL, start INTEGER NOT NULL, last INTEGER NOT NULL,
    batches INTEGER NOT NULL DEFAULT 1, events INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0,
    entry TEXT NOT NULL DEFAULT '', exit TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '',
    player INTEGER, who TEXT NOT NULL DEFAULT '', returned INTEGER NOT NULL DEFAULT 0,
    device TEXT NOT NULL DEFAULT '', browser TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '',
    vw INTEGER, vh INTEGER, scheme TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '')`,
  'CREATE INDEX IF NOT EXISTS sessions_by_day ON sessions (env, day)',
  `CREATE TABLE IF NOT EXISTS visitors (
    visitor TEXT PRIMARY KEY, env TEXT NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL, first_day TEXT NOT NULL, last_day TEXT NOT NULL,
    days INTEGER NOT NULL DEFAULT 1, sessions INTEGER NOT NULL DEFAULT 1, events INTEGER NOT NULL DEFAULT 0,
    player INTEGER, who TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS rollup (
    day TEXT NOT NULL, env TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, detail TEXT NOT NULL,
    n INTEGER NOT NULL, visits INTEGER NOT NULL, total INTEGER, PRIMARY KEY (day, env, kind, name, detail)) WITHOUT ROWID`,
  'CREATE TABLE IF NOT EXISTS limits (day TEXT NOT NULL, source TEXT NOT NULL, events INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, source)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS forget (visitor TEXT PRIMARY KEY, day TEXT NOT NULL)',
];
// Columns added after the first version (usage/migrations/0002_people.sql adds the same ones).
const COLUMNS = {
  events: [['sid', "TEXT NOT NULL DEFAULT ''"], ['player', 'INTEGER'], ['val', 'INTEGER'], ['obj', "TEXT NOT NULL DEFAULT ''"]],
  quota: [['writes', 'INTEGER NOT NULL DEFAULT 0']],
};

async function migrate(db) {
  await db.batch(SCHEMA.map(sql => db.prepare(sql)));
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const have = new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(c => c.name));
    for (const [name, type] of columns.filter(([n]) => !have.has(n))) {
      // Two instances starting at once may both try; the second one's "duplicate column" is fine.
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run().catch(e => { if (!/duplicate column/i.test(String(e?.message))) throw e; });
    }
  }
}

const ready = new WeakMap();
/**
 * Creates the tables and adds missing columns on first use, once per worker instance. The same changes are in
 * usage/migrations/0002_people.sql, to run by hand before a deploy (SETUP-HOSTING.md); this is the safety net.
 */
export function ensureSchema(db) {
  if (!ready.has(db)) ready.set(db, migrate(db).catch(e => { ready.delete(db); throw e; }));
  return ready.get(db);
}

export const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
const daysBefore = (day, n) => dayOf(Date.parse(day) - n * 86400000);

/** The site an event came from: the release site, the development one, or something else (a pages.dev preview). */
export function envOf(host) {
  if (host === 'ptcatch.com' || host === 'www.ptcatch.com') return 'prod';
  if (host === 'dev.ptcatch.com') return 'dev';
  return 'preview';
}

/** The browser family and OS from a user agent; the user agent itself is never stored. */
export function agentOf(ua = '') {
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  return { browser, os };
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const hashOf = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).slice(0, 16);

const salts = new WeakMap(); // per database: { day, salt }, so most events skip the salt read

/** Today's salt, made on the first event of the day, which also runs the day's clean-up and rollup (maintain). */
async function saltFor(db, day) {
  const cached = salts.get(db);
  if (cached?.day === day) return cached.salt;
  let row = await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first();
  if (!row) {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').bind(day, salt),
      db.prepare('DELETE FROM salts WHERE day < ?').bind(day),
      db.prepare('DELETE FROM limits WHERE day < ?').bind(day),
    ]);
    // Two first events at once: both insert-or-ignore, both then use whichever salt won, and only the winner cleans up.
    row = await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first();
    if (row.salt === salt) await maintain(db, day);
  }
  salts.set(db, { day, salt: row.salt });
  return row.salt;
}

/** The old visitor key, for browsers that send no id: a hash that changes every day. */
export async function visitorHash(db, day, ip, agent) {
  return hashOf(`${await saltFor(db, day)}|${ip}|${agent}`);
}

/**
 * Once a day: deletes what a visitor asked to forget, rolls every finished day not rolled yet into anonymous daily
 * counts, and deletes rows past their retention. Reads each new day's events about seven times (the GROUP BYs) and
 * writes a few hundred rollup rows.
 */
export async function maintain(db, today) {
  const rawCutoff = daysBefore(today, RAW_KEEP_DAYS);
  const pending = await db.prepare('SELECT COUNT(*) AS n FROM forget').first();
  if (pending?.n) {
    const gone = 'visitor IN (SELECT visitor FROM forget)';
    await db.batch([
      db.prepare(`DELETE FROM events WHERE ${gone}`), db.prepare(`DELETE FROM sessions WHERE ${gone}`),
      db.prepare(`DELETE FROM visitors WHERE ${gone}`), db.prepare('DELETE FROM forget'),
    ]);
  }
  const last = (await db.prepare("SELECT MAX(day) AS day FROM rollup WHERE day < ?").bind(today).first())?.day;
  const from = last && last >= rawCutoff ? daysBefore(last, -1) : rawCutoff;
  const range = 'day >= ?1 AND day < ?2';
  const roll = (select, where = '', group = '') => db.prepare(`INSERT OR IGNORE INTO rollup (day, env, kind, name, detail, n, visits, total)
    SELECT ${select} FROM events WHERE ${range}${where} GROUP BY day, env${group}`).bind(from, today);
  const statements = from < today ? [
    roll('day, env, kind, name, detail, COUNT(*), COUNT(DISTINCT visitor), SUM(val)', '', ', kind, name, detail'),
    roll("day, env, '_day', '', '', SUM(kind = 'view'), COUNT(DISTINCT visitor), NULL"),
    roll("day, env, '_page', name, '', COUNT(*), COUNT(DISTINCT visitor), SUM(val)", " AND kind = 'view'", ', name'),
    roll("day, env, '_device', device, '', COUNT(*), COUNT(DISTINCT visitor), NULL", '', ', device'),
    roll("day, env, '_country', country, '', COUNT(*), COUNT(DISTINCT visitor), NULL", '', ', country'),
    roll("day, env, '_ref', ref, '', COUNT(*), COUNT(DISTINCT visitor), NULL", " AND ref != ''", ', ref'),
    roll("day, env, '_me', '', '', COUNT(*), COUNT(DISTINCT visitor), NULL", ' AND me = 1'),
    db.prepare(`INSERT OR IGNORE INTO rollup (day, env, kind, name, detail, n, visits, total)
      SELECT day, env, '_sessions', CASE WHEN returned THEN 'returning' ELSE 'new' END, '', COUNT(*), COUNT(DISTINCT visitor), SUM(last - start)
      FROM sessions WHERE ${range} GROUP BY day, env, returned`).bind(from, today),
  ] : [];
  await db.batch([
    ...statements,
    db.prepare('DELETE FROM events WHERE day < ?').bind(rawCutoff),
    db.prepare('DELETE FROM sessions WHERE day < ?').bind(rawCutoff),
    db.prepare('DELETE FROM quota WHERE day < ?').bind(rawCutoff),
    db.prepare('DELETE FROM visitors WHERE last_day < ?').bind(daysBefore(today, VISITOR_KEEP_DAYS)),
    db.prepare('DELETE FROM rollup WHERE day < ?').bind(daysBefore(today, ROLLUP_KEEP_DAYS)),
  ]);
}

const int = (v, min, max) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null);

/**
 * Checks one batch from assets/js/core/track.js and returns what to store (events that make no sense are skipped),
 * or null when the batch itself isn't one. Each event is [kind, name, detail, ref, value, object]: value is a number
 * (milliseconds for timings, a score for games), object what the page is about (p123 a player, m456 a map).
 */
export function parseBatch(body) {
  if (!body || !Array.isArray(body.e) || !body.e.length || body.e.length > MAX_EVENTS) return null;
  const device = ['phone', 'tablet', 'desktop'].includes(body.d) ? body.d : '';
  const player = Number.isSafeInteger(body.p) && body.p > 0 && body.p < 1e10 ? body.p : null;
  const me = body.m === 1 || player ? 1 : 0;
  const rows = [];
  for (const ev of body.e) {
    if (!Array.isArray(ev) || !KINDS.has(ev[0])) continue;
    const name = label(ev[1]);
    if (!name) continue;
    const ref = typeof ev[3] === 'string' && /^[a-z0-9.-]{1,100}$/i.test(ev[3]) ? ev[3].toLowerCase() : '';
    const obj = typeof ev[5] === 'string' && /^[pm]\d{1,10}(\|[pm]\d{1,10})?$/.test(ev[5]) ? ev[5] : '';
    rows.push({ kind: ev[0], name, detail: label(ev[2]), ref, device, me, player, val: int(ev[4], 0, 3_600_000), obj });
  }
  if (!rows.length) return null;
  const c = body.c && typeof body.c === 'object' ? body.c : {};
  return {
    rows,
    visitor: typeof body.id === 'string' && /^[0-9a-f]{16}$/.test(body.id) ? body.id : '',
    sid: typeof body.s === 'string' && /^[0-9a-f]{12}$/.test(body.s) ? body.s : '',
    first: body.f === 1,
    player,
    how: player ? (body.w === 'osu' ? 'osu' : 'claimed') : '',
    proof: typeof body.pr === 'string' ? body.pr.slice(0, 40) : '',
    playerName: player ? label(body.pn).slice(0, 30) : '',
    context: {
      vw: int(c.vw, 200, 8000), vh: int(c.vh, 200, 8000),
      scheme: ['dark', 'light'].includes(c.sc) ? c.sc : '',
      lang: typeof c.ln === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(c.ln) ? c.ln : '',
    },
  };
}

/** Today's quota row: events recorded, rows written and rows the dashboard read so far (0 before the first). */
export async function usedToday(db, day) {
  const row = await db.prepare('SELECT events, reads, writes FROM quota WHERE day = ?').bind(day).first();
  return { events: row?.events ?? 0, reads: row?.reads ?? 0, writes: row?.writes ?? 0 };
}

/** Events recorded from `from` (a day) on, all sites together: what a dashboard range has to read through. */
export async function eventsSince(db, from) {
  const row = await db.prepare('SELECT COALESCE(SUM(events), 0) AS n FROM quota WHERE day >= ?').bind(from).first();
  return row?.n ?? 0;
}

/** Adds `reads` rows read to today's quota row. */
export function noteReads(db, day, reads) {
  return db.prepare('INSERT INTO quota (day, reads) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET reads = reads + excluded.reads')
    .bind(day, Math.max(0, Math.round(reads))).run();
}

const BOTS = /bot|crawl|spider|slurp|headless|lighthouse|preview|python|curl|wget|node-fetch/i;

/**
 * Handles POST /api/hit. Always answers 204 to the browser (there's nothing for it to do with an error); returns
 * a reason string as the response's x-usage header for tests and debugging.
 */
export async function recordHit(request, env, now = Date.now()) {
  const done = reason => new Response(null, { status: 204, headers: { 'x-usage': reason } });
  const db = env.USAGE;
  if (!db) return done('no-database');
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return done('foreign-origin');
  const agent = request.headers.get('user-agent') ?? '';
  if (!agent || BOTS.test(agent)) return done('bot');
  const text = await request.text();
  if (text.length > 8000) return done('too-big');
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (typeof body?.forget === 'string') return forget(db, body.forget, request, now, done);
  const batch = parseBatch(body);
  if (!batch) return done('invalid');

  await ensureSchema(db);
  const day = dayOf(now);
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  const salt = await saltFor(db, day);
  const source = await hashOf(`${salt}|${ip}`);
  // The free-plan caps, all in one read: today's totals and this source's share.
  const used = await db.prepare(`SELECT COALESCE((SELECT events FROM quota WHERE day = ?1), 0) AS events,
    COALESCE((SELECT writes FROM quota WHERE day = ?1), 0) AS writes,
    COALESCE((SELECT events FROM limits WHERE day = ?1 AND source = ?2), 0) AS mine`).bind(day, source).first();
  if (used.events >= DAILY_EVENT_CAP) return done('daily-cap');
  if (used.writes + BATCH_WRITES + 2 > DAILY_WRITE_CAP) return done('write-cap');
  if (used.mine >= SOURCE_DAILY_CAP) return done('source-cap');
  const room = Math.min(DAILY_EVENT_CAP - used.events, SOURCE_DAILY_CAP - used.mine, Math.floor((DAILY_WRITE_CAP - used.writes - BATCH_WRITES) / 2));
  const rows = batch.rows.slice(0, room);

  const visitor = batch.visitor || await hashOf(`${salt}|${ip}|${agent}`);
  const site = envOf(url.hostname);
  const country = String(request.cf?.country ?? request.headers.get('cf-ipcountry') ?? '').slice(0, 2).toUpperCase();
  const ts = Math.floor(now / 1000);
  const who = batch.how === 'osu' && await checkProof(env.OSU_CLIENT_SECRET, batch.player, batch.proof) ? 'verified' : batch.how;
  const insert = db.prepare(`INSERT INTO events (ts, day, env, visitor, kind, name, detail, device, country, ref, me, sid, player, val, obj)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const statements = [
    ...rows.map(r => insert.bind(ts, day, site, visitor, r.kind, r.name, r.detail, r.device, country, r.ref, r.me, batch.sid, r.player, r.val, r.obj)),
    db.prepare(`INSERT INTO quota (day, events, writes) VALUES (?, ?, ?)
      ON CONFLICT(day) DO UPDATE SET events = events + excluded.events, writes = writes + excluded.writes`).bind(day, rows.length, 2 * rows.length + BATCH_WRITES),
    db.prepare(`INSERT INTO limits (day, source, events) VALUES (?, ?, ?)
      ON CONFLICT(day, source) DO UPDATE SET events = events + excluded.events`).bind(day, source, rows.length),
  ];
  if (batch.visitor && batch.sid) {
    const views = rows.filter(r => r.kind === 'view');
    const { browser, os } = agentOf(agent);
    const c = batch.context;
    // A session id only ever belongs to the visitor that started it (the WHERE), so a made-up batch can't rewrite one.
    statements.push(db.prepare(`INSERT INTO sessions (sid, env, visitor, day, start, last, events, views, entry, exit, ref, player, who,
        returned, device, browser, os, country, vw, vh, scheme, lang)
      VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, EXISTS (SELECT 1 FROM visitors WHERE visitor = ?3), ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
      ON CONFLICT(sid) DO UPDATE SET last = excluded.last, batches = batches + 1, events = events + excluded.events,
        views = views + excluded.views, entry = CASE WHEN entry = '' THEN excluded.entry ELSE entry END,
        exit = CASE WHEN excluded.exit = '' THEN exit ELSE excluded.exit END, ref = CASE WHEN ref = '' THEN excluded.ref ELSE ref END,
        player = COALESCE(excluded.player, player), who = CASE WHEN excluded.player IS NULL THEN who ELSE excluded.who END,
        vw = COALESCE(excluded.vw, vw), vh = COALESCE(excluded.vh, vh),
        scheme = CASE WHEN excluded.scheme = '' THEN scheme ELSE excluded.scheme END, lang = CASE WHEN excluded.lang = '' THEN lang ELSE excluded.lang END
      WHERE sessions.visitor = excluded.visitor`)
      .bind(batch.sid, site, visitor, day, ts, rows.length, views.length, views[0]?.name ?? '', views.at(-1)?.name ?? '',
        rows.find(r => r.ref)?.ref ?? '', batch.player, who, rows[0]?.device ?? '', browser, os, country, c.vw, c.vh, c.scheme, c.lang));
    statements.push(db.prepare(`INSERT INTO visitors (visitor, env, first, last, first_day, last_day, events, player, who, name)
      VALUES (?1, ?2, ?3, ?3, ?4, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(visitor) DO UPDATE SET last = excluded.last, days = days + (last_day != excluded.last_day), last_day = excluded.last_day,
        sessions = sessions + ?9, events = events + excluded.events, player = COALESCE(excluded.player, player),
        who = CASE WHEN excluded.player IS NULL THEN who ELSE excluded.who END, name = CASE WHEN excluded.name = '' THEN name ELSE excluded.name END`)
      .bind(visitor, site, ts, day, rows.length, batch.player, who, batch.playerName, batch.first ? 1 : 0));
  }
  await db.batch(statements);
  return done(`ok:${rows.length}`);
}

/**
 * The privacy page's "delete": stops the visitor row at once and queues the visitor's events and sessions for the next
 * daily clean-up (one pass for everybody's requests, so a flood of them can't run a full scan each). Only someone with
 * the id, which lives in that browser's storage, can ask.
 */
async function forget(db, visitor, request, now, done) {
  if (!/^[0-9a-f]{16}$/.test(visitor)) return done('invalid');
  await ensureSchema(db);
  const day = dayOf(now);
  const source = await hashOf(`${await saltFor(db, day)}|${request.headers.get('cf-connecting-ip') ?? ''}`);
  const mine = await db.prepare('SELECT events FROM limits WHERE day = ? AND source = ?').bind(day, source).first();
  if ((mine?.events ?? 0) >= SOURCE_DAILY_CAP) return done('source-cap');
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO forget (visitor, day) VALUES (?, ?)').bind(visitor, day),
    db.prepare('DELETE FROM visitors WHERE visitor = ?').bind(visitor),
    // Counts as 100 events against the source, so one address can ask at most 15 times a day.
    db.prepare('INSERT INTO limits (day, source, events) VALUES (?, ?, 100) ON CONFLICT(day, source) DO UPDATE SET events = events + 100').bind(day, source),
  ]);
  return done('forgotten');
}
