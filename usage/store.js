// Storage for the anonymous usage counts: one D1 table of events (bound to the Pages project as USAGE).
// What's kept per event: time, day, site (prod/dev), a visitor hash that changes every day, the event, the screen
// size class, the country (from Cloudflare), the referring site on a visit's first page, and whether "This is me" is
// set. No IP address, user agent or cookie is stored. The hash is SHA-256 of a random per-day salt + IP + user agent;
// yesterday's salt is deleted, so after midnight (UTC) nobody, us included, can link a hash back to anyone.

export const KEEP_DAYS = 400;
const KINDS = new Set(['view', 'use', 'click', 'out', 'egg', 'pref', 'filter']);
const MAX_EVENTS = 50;
/** Labels keep letters, digits and plain punctuation only (no markup, emoji or control characters), 60 at most. */
const label = s => (typeof s === 'string' ? s.replace(/[^\p{L}\p{N} #'’&.,:/!?()+\-–—…→←]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60) : '');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    ts INTEGER NOT NULL, day TEXT NOT NULL, env TEXT NOT NULL, visitor TEXT NOT NULL,
    kind TEXT NOT NULL, name TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '', me INTEGER NOT NULL DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS events_by_day ON events (env, day, kind)',
  'CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)',
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
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  const visitor = await visitorHash(db, day, ip, agent);
  const site = envOf(url.hostname);
  const country = String(request.cf?.country ?? '').slice(0, 2);
  const ts = Math.floor(now / 1000);
  const insert = db.prepare(`INSERT INTO events (ts, day, env, visitor, kind, name, detail, device, country, ref, me)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  await db.batch(rows.map(r => insert.bind(ts, day, site, visitor, r.kind, r.name, r.detail, r.device, country, r.ref, r.me)));
  return done(`ok:${rows.length}`);
}
