// Storage for the anonymous usage counts: one D1 table of events (bound to the Pages project as USAGE).
// What's kept per event: time, day, site (prod/dev), a visitor hash that changes every day, the event, the screen
// size class, the country (from Cloudflare), the referring site on a visit's first page, and whether "This is me" is
// set. No IP address, user agent or cookie is stored. The hash is SHA-256 of a random per-day salt + IP + user agent;
// yesterday's salt is deleted, so after midnight (UTC) nobody, us included, can link a hash back to anyone.

export const KEEP_DAYS = 400;
const KINDS = new Set(['view', 'seen', 'use', 'click', 'out', 'egg', 'pref', 'filter']);
// assets/js/core/track.js sends at most 20 events per batch; a few more are allowed, but not a flood per request.
const MAX_EVENTS = 25;

// Free-plan guard. D1 on Workers Free allows 100,000 rows written and 5,000,000 rows read per day (all databases of
// the account, reset at 00:00 UTC; queries fail once either is used up) and 500 MB per database. An event costs 2 rows
// written (the row and its index entry), each request adds one to today's quota row, the retention delete costs the
// event's 2 rows again 400 days later, and a stored event is ~150 bytes. So past DAILY_EVENT_CAP events a day (all
// sites together) nothing more is recorded until midnight UTC: at most ~36,000 rows written a day even if someone
// floods /api/hit, and at most ~360 MB after 400 days. The dashboard keeps its reads under DAILY_READ_BUDGET the same way
// (usage/dashboard.js). See notes/free-tier-audit.md.
export const DAILY_EVENT_CAP = 6000;
export const DAILY_READ_BUDGET = 2_000_000;
/** Labels keep letters, digits and plain punctuation only (no markup, emoji or control characters), 60 at most. */
const label = s => (typeof s === 'string' ? s.replace(/[^\p{L}\p{N} #'’&.,:/!?()+\-–—…→←]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60) : '');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    ts INTEGER NOT NULL, day TEXT NOT NULL, env TEXT NOT NULL, visitor TEXT NOT NULL,
    kind TEXT NOT NULL, name TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '', me INTEGER NOT NULL DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS events_by_day ON events (env, day, kind)',
  'CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)',
  // Per UTC day: events recorded and rows the dashboard read, for the free-plan caps above.
  'CREATE TABLE IF NOT EXISTS quota (day TEXT PRIMARY KEY, events INTEGER NOT NULL DEFAULT 0, reads INTEGER NOT NULL DEFAULT 0)',
];

const ready = new WeakMap();
/** Creates the tables on first use, once per worker instance (so there's no separate migration step). */
export function ensureSchema(db) {
  if (!ready.has(db)) ready.set(db, db.batch(SCHEMA.map(sql => db.prepare(sql))).catch(e => { ready.delete(db); throw e; }));
  return ready.get(db);
}

export const dayOf = ms => new Date(ms).toISOString().slice(0, 10);

/** The site an event came from: the release site, the development one, or something else (a pages.dev preview). */
export function envOf(host) {
  if (host === 'ptcatch.com' || host === 'www.ptcatch.com') return 'prod';
  if (host === 'dev.ptcatch.com') return 'dev';
  return 'preview';
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/** Today's salt, made on the first event of the day; older salts are deleted then, with events past KEEP_DAYS. */
async function saltFor(db, day) {
  const row = await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first();
  if (row) return row.salt;
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const cutoff = dayOf(Date.parse(day) - KEEP_DAYS * 86400000);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').bind(day, salt),
    db.prepare('DELETE FROM salts WHERE day < ?').bind(day),
    db.prepare('DELETE FROM events WHERE day < ?').bind(cutoff),
    db.prepare('DELETE FROM quota WHERE day < ?').bind(cutoff),
  ]);
  // Two first events at once: both insert-or-ignore, and both then use whichever salt won.
  return (await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first()).salt;
}

export async function visitorHash(db, day, ip, agent) {
  const salt = await saltFor(db, day);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${ip}|${agent}`));
  return hex(digest).slice(0, 16);
}

/**
 * Checks one batch from assets/js/core/track.js and returns the rows to insert (events that make no sense are
 * skipped), or null when the batch itself isn't one.
 */
export function parseBatch(body) {
  if (!body || !Array.isArray(body.e) || !body.e.length || body.e.length > MAX_EVENTS) return null;
  const device = ['phone', 'tablet', 'desktop'].includes(body.d) ? body.d : '';
  const me = body.m === 1 ? 1 : 0;
  const rows = [];
  for (const ev of body.e) {
    if (!Array.isArray(ev) || !KINDS.has(ev[0])) continue;
    const name = label(ev[1]);
    if (!name) continue;
    const ref = typeof ev[3] === 'string' && /^[a-z0-9.-]{1,100}$/i.test(ev[3]) ? ev[3].toLowerCase() : '';
    rows.push({ kind: ev[0], name, detail: label(ev[2]), ref, device, me });
  }
  return rows.length ? rows : null;
}

/** Today's quota row: events recorded and rows the dashboard read so far (0 and 0 before the first). */
export async function usedToday(db, day) {
  const row = await db.prepare('SELECT events, reads FROM quota WHERE day = ?').bind(day).first();
  return { events: row?.events ?? 0, reads: row?.reads ?? 0 };
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
  let rows;
  try { rows = parseBatch(JSON.parse(text)); } catch { rows = null; }
  if (!rows) return done('invalid');

  await ensureSchema(db);
  const day = dayOf(now);
  // The free-plan cap (DAILY_EVENT_CAP): checked before the salt, so a flood past it costs one row read per request.
  const { events: recorded } = await usedToday(db, day);
  if (recorded >= DAILY_EVENT_CAP) return done('daily-cap');
  if (rows.length > DAILY_EVENT_CAP - recorded) rows = rows.slice(0, DAILY_EVENT_CAP - recorded);
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  const visitor = await visitorHash(db, day, ip, agent);
  const site = envOf(url.hostname);
  const country = String(request.cf?.country ?? '').slice(0, 2);
  const ts = Math.floor(now / 1000);
  const insert = db.prepare(`INSERT INTO events (ts, day, env, visitor, kind, name, detail, device, country, ref, me)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  await db.batch([
    ...rows.map(r => insert.bind(ts, day, site, visitor, r.kind, r.name, r.detail, r.device, country, r.ref, r.me)),
    db.prepare('INSERT INTO quota (day, events) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET events = events + excluded.events').bind(day, rows.length),
  ]);
  return done(`ok:${rows.length}`);
}
