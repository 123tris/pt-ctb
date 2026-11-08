// Storage for Bananas 🍌 on the site side: one D1 database (bound to the Pages project as ECONOMY). The bot is the bank
// (C:\Repos\PT-CTB-Discord-Bot\CURRENCY-DESIGN.md, and the bot ↔ site contract): the site never moves money. It only
// keeps what the bot can't see for itself, and the bot pulls it every 15 minutes through the inbox (economy/api.js):
//
//   signins       one row per osu! id that ever signed in on the site: first and last time, and `seq`, its place in
//                 the inbox. The first sign-in is the event that collects the player's pouch.
//   daily_rounds  the paying daily game's map per Lisbon day: the six options shown and which one is right, picked from
//                 a secret seed (economy/daily.js) and kept, so a new export of the quiz pool can't move it mid-day.
//   daily_game    one row per osu! id per Lisbon day (the primary key is the "one a day" rule): the guesses, and `seq`
//                 once the game is over, which is when it goes into the inbox.
//   requests      what players asked to spend (post or fund a bounty, tip, buy, shield), and admins' `admin.*` requests
//                 (contract §8), queued for the bot, with the status it acked and, for a refusal, its `code`. The bot
//                 alone decides; this only checks the shape. The Top 10's payouts and thanks (kinds top10.*) are
//                 rows here too, inserted by top10/store.js only.
//   inbox_state   the cursor the bot last acked.
//
// No IP addresses, Discord ids or osu! tokens are stored. Free-plan cost: a sign-in writes 1–2 rows, a daily guess 1–2,
// a request 2 (with its index), the bot's pull reads only what's new (indexed by seq) and an ack writes one row per
// result. A hundred players a day is a few hundred rows written, against D1's 100,000.

export const PENDING_CAP = 5; // a player's requests waiting for the bot at once
export const DAILY_REQUEST_CAP = 20; // a player's requests per Lisbon day
export const KEEP_DAYS = 180; // decided requests and finished daily games are deleted after this
const INBOX_MAX = 500; // events per kind per pull

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS signins (
    osu_id INTEGER PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, first INTEGER NOT NULL, last INTEGER NOT NULL, times INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS daily_rounds (
    day TEXT PRIMARY KEY, options TEXT NOT NULL, answer INTEGER NOT NULL, made INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS daily_game (
    day TEXT NOT NULL, osu_id INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, guesses TEXT NOT NULL DEFAULT '',
    solved INTEGER NOT NULL DEFAULT 0, finished INTEGER, seq INTEGER UNIQUE, PRIMARY KEY (day, osu_id)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS requests (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, osu_id INTEGER NOT NULL, kind TEXT NOT NULL,
    payload TEXT NOT NULL, created INTEGER NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT, decided INTEGER, code TEXT)`,
  'CREATE INDEX IF NOT EXISTS requests_by_player ON requests (osu_id, seq)',
  'CREATE TABLE IF NOT EXISTS inbox_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
];

const ready = new WeakMap();
/**
 * Creates the tables on first use, once per worker instance. economy/migrations/0001_economy.sql has the same, to run
 * by hand when the database is made (SETUP-HOSTING.md); this is the safety net.
 */
export function ensureSchema(db) {
  if (!ready.has(db)) ready.set(db, db.batch(SCHEMA.map(sql => db.prepare(sql))).then(() => addCodeColumn(db)).catch(e => { ready.delete(db); throw e; }));
  return ready.get(db);
}

/** `requests.code` came after the first release (economy/migrations/0002_admin.sql); a database made before gets it here. */
async function addCodeColumn(db) {
  const { results } = await db.prepare('PRAGMA table_info(requests)').all();
  if (!results.some(c => c.name === 'code')) await db.prepare('ALTER TABLE requests ADD COLUMN code TEXT').run();
}

const lisbon = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' });
/** The Lisbon day (yyyy-MM-dd) of a time in unix seconds: the daily game's day, as the bot counts it. */
export const lisbonDay = t => lisbon.format(new Date(t * 1000));
export const iso = t => new Date(t * 1000).toISOString().replace('.000Z', 'Z');
const nowSec = () => Math.floor(Date.now() / 1000);

// ---- Sign-ins -------------------------------------------------------------------------------------------------------

/** Notes a sign-in. Only the first one per osu! id gets an inbox place (`seq`); later ones just move `last`. */
export async function recordSignin(db, osuId, now = nowSec()) {
  await ensureSchema(db);
  await db.prepare(`INSERT INTO signins (osu_id, seq, first, last) VALUES (?1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM signins), ?2, ?2)
    ON CONFLICT (osu_id) DO UPDATE SET last = excluded.last, times = times + 1`).bind(osuId, now).run();
}

// ---- The daily game -------------------------------------------------------------------------------------------------

/** A day's round, { day, options: [[setId, artist, title, mapper]], answer }, or null before anyone asked for it. */
export async function readRound(db, day) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT options, answer FROM daily_rounds WHERE day = ?').bind(day).first();
  return row ? { day, options: JSON.parse(row.options), answer: row.answer } : null;
}

/** Keeps a newly picked round; when two requests pick at once, the first kept wins, and both get it. */
export async function keepRound(db, round, now = nowSec()) {
  await db.prepare('INSERT OR IGNORE INTO daily_rounds (day, options, answer, made) VALUES (?, ?, ?, ?)')
    .bind(round.day, JSON.stringify(round.options), round.answer, now).run();
  return readRound(db, round.day);
}

/** A player's game on a day: { tries, guesses: [option index], solved, done }; tries 0 before the first guess. */
export async function readGame(db, day, osuId) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT tries, guesses, solved, finished FROM daily_game WHERE day = ? AND osu_id = ?').bind(day, osuId).first();
  return gameOf(row);
}
const gameOf = row => ({
  tries: row?.tries ?? 0,
  guesses: row?.guesses ? row.guesses.split(',').map(Number) : [],
  solved: !!row?.solved,
  done: row?.finished != null,
});

export const TRIES = 3;

/**
 * Takes one guess (an option index) for a player on a day. Returns { game } after it, or { error } when the game is
 * over or that option was already tried. The row is only updated if it still has the tries it was read with, so two
 * guesses sent at once can't both count.
 */
export async function guess(db, round, osuId, choice, now = nowSec()) {
  await ensureSchema(db);
  await db.prepare('INSERT OR IGNORE INTO daily_game (day, osu_id) VALUES (?, ?)').bind(round.day, osuId).run();
  const before = await readGame(db, round.day, osuId);
  if (before.done) return { error: 'over', game: before };
  if (before.guesses.includes(choice)) return { error: 'repeat', game: before };
  const solved = choice === round.answer;
  const over = solved || before.tries + 1 >= TRIES;
  const guesses = [...before.guesses, choice].join(',');
  const result = await db.prepare(`UPDATE daily_game SET tries = tries + 1, guesses = ?1, solved = ?2,
      finished = CASE WHEN ?3 THEN ?4 END, seq = CASE WHEN ?3 THEN (SELECT COALESCE(MAX(seq), 0) + 1 FROM daily_game) END
    WHERE day = ?5 AND osu_id = ?6 AND tries = ?7 AND finished IS NULL`)
    .bind(guesses, solved ? 1 : 0, over ? 1 : 0, now, round.day, osuId, before.tries).run();
  if (!changed(result)) return { error: 'busy', game: await readGame(db, round.day, osuId) };
  return { game: await readGame(db, round.day, osuId) };
}
const changed = result => (result?.meta?.changes ?? 1) > 0;

// ---- Spending requests ----------------------------------------------------------------------------------------------

export const REQUEST_TYPES = ['bounty.create', 'bounty.fund', 'tip', 'shop.buy', 'shield'];
/** The Top 10's request kinds (top10.*), which only the site's own code inserts. */
export const isTop10Type = type => typeof type === 'string' && type.toLowerCase().startsWith('top10.');
export const SHOP_ITEMS = ['title', 'signature', 'colour', 'motw', 'wildcard', 'role'];
const GOALS = ['fc', 'pass', 'snipe'];
const DAYS = [30, 60, 90];
const MAX_AMOUNT = 1_000_000;
const MAX_PERIODS = 52; // a year of a weekly item

const id = v => (Number.isSafeInteger(v) && v > 0 && v < 1e10 ? v : null);
const amount = v => (Number.isSafeInteger(v) && v > 0 && v <= MAX_AMOUNT ? v : null);
/** Plain one-line text (no markup or control characters), `max` characters at most, or null. */
const line = (v, max) => {
  if (typeof v !== 'string') return null;
  const clean = v.replace(/[\p{C}<>]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return clean || null;
};
/** "HDHR"-style mods from the bounty allowlist (HD, HR, DT or NC, FL), each once; '' and null mean none. */
function bountyMods(v) {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v !== 'string' || !/^((HD|HR|DT|NC|FL)){1,4}$/.test(v)) return { ok: false };
  const mods = v.match(/../g);
  if (new Set(mods.map(m => (m === 'NC' ? 'DT' : m))).size !== mods.length) return { ok: false };
  return { ok: true, value: v };
}

/**
 * Checks a request's shape against the contract and rebuilds its payload field by field (anything else is dropped).
 * Returns { type, payload } or { error }. Amounts, balances, the 1,000 gate and every limit are the bot's to judge.
 */
export function parseRequest(body, osuId) {
  const type = body?.type;
  // Top 10 payouts and thanks (top10.payout, top10.thanks) are queued by the site's own code at finalize and on a
  // thanks (top10/store.js), never by a player, whatever REQUEST_TYPES lists (TOP10-DESIGN.md §13.6).
  if (isTop10Type(type)) return { error: 'Top 10 bananas are paid by the site itself once the results are final; they can’t be requested.' };
  const p = body?.payload && typeof body.payload === 'object' ? body.payload : null;
  if (!REQUEST_TYPES.includes(type) || !p) return { error: 'That isn’t a request the bot takes.' };
  if (type === 'bounty.create') {
    const mods = bountyMods(p.mods);
    const payload = { map: id(p.map), goal: GOALS.includes(p.goal) ? p.goal : null, stake: amount(p.stake), mods: mods.value, days: DAYS.includes(p.days) ? p.days : null };
    if (!payload.map || !payload.goal || !payload.stake || !payload.days || !mods.ok) return { error: 'The bounty needs a map, a goal, a stake and a duration of 30, 60 or 90 days.' };
    return { type, payload };
  }
  if (type === 'bounty.fund') {
    const payload = { bountyId: id(p.bountyId), amount: amount(p.amount) };
    return payload.bountyId && payload.amount ? { type, payload } : { error: 'Funding needs a bounty and an amount.' };
  }
  if (type === 'tip') {
    const payload = { to: id(p.to), amount: amount(p.amount), reason: line(p.reason, 80) };
    if (!payload.to || !payload.amount) return { error: 'A tip needs a player and an amount.' };
    if (payload.to === osuId) return { error: 'You can’t tip yourself.' };
    return { type, payload };
  }
  if (type === 'shop.buy') {
    const arg = Number.isSafeInteger(p.arg) ? p.arg : line(p.arg, 80);
    if (!SHOP_ITEMS.includes(p.item)) return { error: 'That isn’t in the shop.' };
    // Timed items (colour, role) can be bought several periods at once, up to a year of weeks; anything else is one.
    const periods = p.periods === undefined || p.periods === null ? 1 : p.periods;
    if (!Number.isSafeInteger(periods) || periods < 1 || periods > MAX_PERIODS) return { error: 'Buy 1 to 52 periods at once.' };
    return { type, payload: { item: p.item, arg, periods } };
  }
  return typeof p.on === 'boolean' ? { type, payload: { on: p.on } } : { error: 'Shield needs on or off.' };
}

// ---- Admin requests (contract §8) -----------------------------------------------------------------------------------

export const ADMIN_TYPES = [
  'admin.set', 'admin.reset', 'admin.hill.approve', 'admin.hill.reroll', 'admin.hill.redraft', 'admin.bounty.cancel',
  'admin.bananas.adjust', 'admin.map.ban', 'admin.map.unban',
];
export const isAdminType = type => typeof type === 'string' && type.startsWith('admin.');
const HILL_SLOTS = ['NM', 'HD', 'HR', 'DT', 'FM', 'CV'];
const HILL_TIERS = ['open', 'challenger'];
const settingKey = v => (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9]{0,40}(\.[A-Za-z][A-Za-z0-9]{0,40}){1,2}$/.test(v) ? v : null);
/** A setting's value as the bot takes it: a number, true/false, a list of up to 10 whole numbers, or short text. */
function settingValue(v) {
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= 1e9 ? { ok: true, value: v } : { ok: false };
  if (typeof v === 'boolean') return { ok: true, value: v };
  if (Array.isArray(v)) return v.length >= 1 && v.length <= 10 && v.every(n => Number.isSafeInteger(n) && Math.abs(n) <= 1e9) ? { ok: true, value: v } : { ok: false };
  const text = line(v, 40);
  return text ? { ok: true, value: text } : { ok: false };
}

/**
 * Checks an admin request's shape (§8) and rebuilds its payload. Loose on purpose: the bot knows the settings, their
 * ranges and what exists, and refuses with a code. Returns { type, payload } or { error }.
 */
export function parseAdminRequest(body) {
  const type = body?.type;
  const p = body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
  if (!ADMIN_TYPES.includes(type)) return { error: 'That isn’t an admin request the bot takes.' };
  switch (type) {
    case 'admin.set': {
      const key = settingKey(p.key);
      const value = settingValue(p.value);
      return key && value.ok ? { type, payload: { key, value: value.value } } : { error: 'A setting needs its key and a value.' };
    }
    case 'admin.reset': {
      const key = settingKey(p.key);
      return key ? { type, payload: { key } } : { error: 'A reset needs the setting’s key.' };
    }
    case 'admin.hill.reroll': {
      const slot = String(p.slot ?? '').toUpperCase();
      const tier = String(p.tier ?? '').toLowerCase();
      return HILL_SLOTS.includes(slot) && HILL_TIERS.includes(tier) ? { type, payload: { slot, tier } } : { error: 'A reroll needs a slot (NM, HD, HR, DT, FM, CV) and a tier.' };
    }
    case 'admin.bounty.cancel': {
      const bounty = id(p.id);
      if (!bounty || (p.refund !== undefined && typeof p.refund !== 'boolean')) return { error: 'Cancelling needs the bounty’s id.' };
      return { type, payload: { id: bounty, refund: p.refund !== false } };
    }
    case 'admin.bananas.adjust': {
      const osuId = id(p.osuId);
      const n = Number.isSafeInteger(p.amount) && p.amount !== 0 && Math.abs(p.amount) <= MAX_AMOUNT ? p.amount : null;
      if (!osuId || !n) return { error: 'An adjustment needs a player and a whole amount other than 0.' };
      const note = line(p.note, 100);
      return { type, payload: { osuId, amount: n, ...(note ? { note } : {}) } };
    }
    case 'admin.map.ban':
    case 'admin.map.unban': {
      const beatmapId = id(p.beatmapId);
      return beatmapId ? { type, payload: { beatmapId } } : { error: 'That needs a beatmap id.' };
    }
    default: // approve, redraft
      return { type, payload: {} };
  }
}
// An admin saving a page of settings sends one request per change, so their caps are wider than a player's.
export const ADMIN_PENDING_CAP = 40;
export const ADMIN_DAILY_CAP = 200;

const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

/**
 * Queues a request for the bot. Returns { requestId } or { error, status } when the player has PENDING_CAP waiting
 * already or sent DAILY_REQUEST_CAP today. Admin requests count apart, against the ADMIN_ caps.
 */
export async function queueRequest(db, osuId, { type, payload }, now = nowSec()) {
  await ensureSchema(db);
  const day = lisbonDay(now);
  const admin = isAdminType(type);
  const [pendingCap, dailyCap] = admin ? [ADMIN_PENDING_CAP, ADMIN_DAILY_CAP] : [PENDING_CAP, DAILY_REQUEST_CAP];
  // The Top 10's payouts and thanks (top10.*) are the site's own, queued for the player, not by them: they never
  // count against a player's caps (TOP10-DESIGN.md §13.6).
  const counts = await db.prepare(`SELECT SUM(status = 'pending') AS pending, SUM(day = ?2) AS today FROM requests
    WHERE osu_id = ?1 AND (kind LIKE 'admin.%') = ?3 AND kind NOT LIKE 'top10.%'`).bind(osuId, day, admin ? 1 : 0).first();
  if ((counts?.pending ?? 0) >= pendingCap) return { status: 429, error: `You have ${pendingCap} requests waiting for the bot. It takes them every 15 minutes; try again after.` };
  if ((counts?.today ?? 0) >= dailyCap) return { status: 429, error: `That’s ${dailyCap} requests today. Try again tomorrow.` };
  const requestId = hex(crypto.getRandomValues(new Uint8Array(12)));
  await db.prepare('INSERT INTO requests (id, osu_id, kind, payload, created, day) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(requestId, osuId, type, JSON.stringify(payload), now, day).run();
  return { requestId };
}

/**
 * A player's latest requests, newest first: { requestId, type, payload, t, status, reason, code, decided }. Spending
 * ones by default; `admin` lists their admin.* ones instead.
 */
export async function listRequests(db, osuId, limit = 30, { admin = false } = {}) {
  await ensureSchema(db);
  const { results } = await db.prepare(`SELECT id, kind, payload, created, status, reason, code, decided FROM requests
    WHERE osu_id = ? AND (kind LIKE 'admin.%') = ? ORDER BY seq DESC LIMIT ?`).bind(osuId, admin ? 1 : 0, limit).all();
  return results.map(r => ({
    requestId: r.id, type: r.kind, payload: JSON.parse(r.payload), t: iso(r.created), status: r.status, reason: r.reason ?? null,
    code: r.code ?? null, decided: r.decided ? iso(r.decided) : null,
  }));
}

// ---- The inbox, for the bot -----------------------------------------------------------------------------------------

/** "<signins>.<daily>.<requests>": the last seq the bot has seen of each kind. Anything else reads as the start. */
export function parseCursor(text) {
  const m = /^(\d{1,12})\.(\d{1,12})\.(\d{1,12})$/.exec(text ?? '');
  return m ? { s: Number(m[1]), d: Number(m[2]), r: Number(m[3]) } : null;
}
const cursorText = c => `${c.s}.${c.d}.${c.r}`;
// Within the same second, a sign-in goes before what it made possible.
const KIND_ORDER = { signin: 0, daily: 1, request: 2 };

/**
 * Events after `since` (a cursor; null: after the last acked one), as the contract has them, oldest first, with the
 * cursor that follows them. At most INBOX_MAX of each kind per pull; the bot asks again with the new cursor.
 */
export async function inbox(db, since) {
  await ensureSchema(db);
  const from = since ?? parseCursor((await db.prepare("SELECT value FROM inbox_state WHERE key = 'cursor'").first())?.value) ?? { s: 0, d: 0, r: 0 };
  const [signins, games, requests] = await Promise.all([
    db.prepare('SELECT seq, osu_id, first FROM signins WHERE seq > ? ORDER BY seq LIMIT ?').bind(from.s, INBOX_MAX).all(),
    db.prepare('SELECT seq, osu_id, day, tries, solved, finished FROM daily_game WHERE seq > ? ORDER BY seq LIMIT ?').bind(from.d, INBOX_MAX).all(),
    db.prepare('SELECT seq, id, osu_id, kind, payload, created FROM requests WHERE seq > ? ORDER BY seq LIMIT ?').bind(from.r, INBOX_MAX).all(),
  ]).then(all => all.map(a => a.results));
  const last = (rows, fallback) => (rows.length ? rows[rows.length - 1].seq : fallback);
  const events = [
    ...signins.map(r => ({ id: `s${r.seq}`, at: r.first, kind: 'signin', osuId: r.osu_id, data: {} })),
    ...games.map(r => ({ id: `d${r.seq}`, at: r.finished, kind: 'daily', osuId: r.osu_id, data: { day: r.day, tries: r.tries, solved: !!r.solved } })),
    ...requests.map(r => ({ id: `r${r.seq}`, at: r.created, kind: 'request', osuId: r.osu_id, data: { requestId: r.id, type: r.kind, payload: JSON.parse(r.payload) } })),
  ].sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || parseInt(a.id.slice(1)) - parseInt(b.id.slice(1)))
    .map(({ at, ...e }) => ({ id: e.id, t: iso(at), kind: e.kind, osuId: e.osuId, data: e.data }));
  return { cursor: cursorText({ s: last(signins, from.s), d: last(games, from.d), r: last(requests, from.r) }), events };
}

/**
 * The bot's answer: each request's outcome (only pending ones change; an unknown id is skipped), and the cursor it has
 * now handled, kept as the default `since`. Old decided requests and finished games are cleaned up here too.
 * Returns how many requests changed.
 */
export async function ack(db, { cursor, results }, now = nowSec()) {
  await ensureSchema(db);
  const updates = results.map(r => db.prepare("UPDATE requests SET status = ?, reason = ?, code = ?, decided = ? WHERE id = ? AND status = 'pending'")
    .bind(r.status, r.reason, r.code ?? null, now, r.requestId));
  const cutoff = now - KEEP_DAYS * 86400;
  const out = await db.batch([
    ...updates,
    ...(cursor ? [db.prepare("INSERT INTO inbox_state (key, value) VALUES ('cursor', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(cursor)] : []),
    db.prepare("DELETE FROM requests WHERE status != 'pending' AND decided < ?").bind(cutoff),
    // The newest finished game stays, so the next one's seq still follows the bot's cursor.
    db.prepare('DELETE FROM daily_game WHERE finished < ?1 AND seq < (SELECT MAX(seq) FROM daily_game)').bind(cutoff),
    db.prepare('DELETE FROM daily_rounds WHERE made < ?').bind(cutoff),
  ]);
  return out.slice(0, updates.length).filter(changed).length;
}
