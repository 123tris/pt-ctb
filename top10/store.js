// Storage for the Top 10 vote (TOP10-DESIGN.md §13.2), in the ECONOMY database next to Bananas, so the payouts go
// through the one inbox the bot already pulls (economy/store.js):
//
//   top10_ballots   one per (year, osu! id): the ranked picks [{ id, spot }], honourable mentions and ones to watch
//                   [id], skills (null for now), intro and outro, and status: 'draft' (private), 'submitted' (public,
//                   counts) or 'void' (a mod's, with void_reason). `updated` is the last save; submitted_at the submit.
//   top10_writeups  one per (year, voter, subject): the text, its words and flags (top10/words.js; a comma list),
//                   cited scores, and the mods' word: mod 'ok' (the default) or 'struck', with mod_reason.
//   top10_plays     the score showcase: who submitted which player's score (score_ref is its S.ID in the site's data,
//                   null for a clip), caption, clip link, status 'ok' or 'hidden' (with the mod's reason).
//   top10_marks     endorsements (osu_id endorses play `target`) and thanks (osu_id, the subject, thanks the write-up
//                   by voter `target`). The primary key is the "once per person" rule.
//   top10_results   the finalized results JSON per year (top10/score.js), when and by whom. Once only.
//   top10_modlog    every mod action: who, what, on what ("writeup:<voter>:<subject>", "play:<id>", "ballot:<voter>",
//                   "results:<year>"), why and when. Writers see the entries about their own things.
//
// Payouts and thanks are rows in economy's `requests` (kinds top10.payout and top10.thanks), inserted only here, so
// the bot reads them through /api/economy/inbox like any other request (§13.6).
//
// Free plan: a ballot save is one statement batch of up to 3 (the ballot row, deleted write-ups, upserted write-ups,
// with only the write-ups that changed written); finalize is one batch of 3 whatever the turnout (the requests go in
// as one INSERT … SELECT over a JSON array, since D1 counts each statement against its 50 queries per call).

import { ensureSchema as ensureEconomy, iso, lisbonDay } from '../economy/store.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS top10_ballots (
    year INTEGER NOT NULL, osu_id INTEGER NOT NULL, picks TEXT NOT NULL DEFAULT '[]', mentions TEXT NOT NULL DEFAULT '[]',
    watch TEXT NOT NULL DEFAULT '[]', skills TEXT, intro TEXT NOT NULL DEFAULT '', outro TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft', submitted_at INTEGER, updated INTEGER NOT NULL, void_reason TEXT,
    PRIMARY KEY (year, osu_id)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS top10_writeups (
    year INTEGER NOT NULL, voter INTEGER NOT NULL, subject INTEGER NOT NULL, body TEXT NOT NULL, words INTEGER NOT NULL DEFAULT 0,
    cites TEXT NOT NULL DEFAULT '[]', flags TEXT NOT NULL DEFAULT '', mod TEXT NOT NULL DEFAULT 'ok', mod_reason TEXT,
    updated INTEGER NOT NULL, PRIMARY KEY (year, voter, subject)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS top10_plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, submitter INTEGER NOT NULL, player INTEGER NOT NULL,
    score_ref INTEGER, beatmap_id INTEGER, caption TEXT, clip TEXT, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ok',
    reason TEXT)`,
  'CREATE INDEX IF NOT EXISTS top10_plays_by_year ON top10_plays (year, player)',
  'CREATE UNIQUE INDEX IF NOT EXISTS top10_plays_score ON top10_plays (year, score_ref)',
  `CREATE TABLE IF NOT EXISTS top10_marks (
    year INTEGER NOT NULL, kind TEXT NOT NULL, osu_id INTEGER NOT NULL, target INTEGER NOT NULL, created INTEGER NOT NULL,
    PRIMARY KEY (year, kind, osu_id, target)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS top10_results (
    year INTEGER PRIMARY KEY, json TEXT NOT NULL, finalized_at INTEGER NOT NULL, "by" INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS top10_modlog (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, admin INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
    reason TEXT, at INTEGER NOT NULL)`,
];

const ready = new WeakMap();
/**
 * Creates the tables on first use, once per worker instance. economy/migrations/0003_top10.sql has the same, to run by
 * hand; this is the safety net, as in economy/store.js.
 */
export function ensureSchema(db) {
  if (!ready.has(db)) ready.set(db, db.batch(SCHEMA.map(sql => db.prepare(sql))).catch(e => { ready.delete(db); throw e; }));
  return ready.get(db);
}

const parse = (text, fallback) => {
  if (text === null || text === undefined || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
};
const flagList = text => (text ? text.split(',').filter(Boolean) : []);
const changed = result => (result?.meta?.changes ?? 1) > 0;
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const requestId = () => hex(crypto.getRandomValues(new Uint8Array(12)));

// ---- Ballots and write-ups ------------------------------------------------------------------------------------------

/** A ballot row as the API shows it (without write-ups). */
function ballotOf(row) {
  return {
    year: row.year, voter: row.osu_id, status: row.status,
    picks: parse(row.picks, []), mentions: parse(row.mentions, []), watch: parse(row.watch, []), skills: parse(row.skills, null),
    intro: row.intro, outro: row.outro,
    submittedAt: row.submitted_at ? iso(row.submitted_at) : null, updated: iso(row.updated),
    voidReason: row.void_reason ?? null,
  };
}

/** A write-up row as the store hands it on: { subject, body, words, cites, flags: [...], mod, modReason, updated }. */
const writeupOf = row => ({
  voter: row.voter, subject: row.subject, body: row.body, words: row.words, cites: parse(row.cites, []), flags: flagList(row.flags),
  mod: row.mod, modReason: row.mod_reason ?? null, updated: row.updated,
});

/** A player's ballot for a year with all its write-ups (the owner's view), or null. */
export async function readBallot(db, year, osuId) {
  await ensureSchema(db);
  const [row, { results }, { results: thanks }] = await Promise.all([
    db.prepare('SELECT * FROM top10_ballots WHERE year = ? AND osu_id = ?').bind(year, osuId).first(),
    db.prepare('SELECT * FROM top10_writeups WHERE year = ? AND voter = ?').bind(year, osuId).all(),
    db.prepare("SELECT osu_id FROM top10_marks WHERE year = ? AND kind = 'thanks' AND target = ?").bind(year, osuId).all(),
  ]);
  if (!row) return null;
  const thanked = new Set(thanks.map(t => t.osu_id));
  return { ...ballotOf(row), writeups: results.map(r => ({ ...writeupOf(r), thanked: thanked.has(r.subject) })) };
}

/** The bodies of every write-up of a year except a voter's own, for the copy check: [{ voter, subject, body }]. */
export async function otherBodies(db, year, voter) {
  await ensureSchema(db);
  const { results } = await db.prepare('SELECT voter, subject, body FROM top10_writeups WHERE year = ? AND voter != ?').bind(year, voter).all();
  return results;
}

/**
 * Saves a ballot: the lists and texts (a new ballot is a draft; an existing one keeps its status, so a submitted
 * ballot's edits are live), the write-ups that changed (`upserts`: [{ subject, body, words, cites, flags, mod,
 * modReason }]), and drops the write-ups on anyone no longer listed (`keep`: the listed ids). A void ballot isn't
 * touched. Returns false when it was void.
 */
export async function saveBallot(db, { year, voter, picks, mentions, watch, intro, outro }, { upserts = [], keep }, now) {
  await ensureSchema(db);
  const statements = [
    db.prepare(`INSERT INTO top10_ballots (year, osu_id, picks, mentions, watch, intro, outro, status, updated)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'draft', ?8)
      ON CONFLICT (year, osu_id) DO UPDATE SET picks = excluded.picks, mentions = excluded.mentions, watch = excluded.watch,
        intro = excluded.intro, outro = excluded.outro, updated = excluded.updated
      WHERE top10_ballots.status != 'void'`)
      .bind(year, voter, JSON.stringify(picks), JSON.stringify(mentions), JSON.stringify(watch), intro, outro, now),
    db.prepare(`DELETE FROM top10_writeups WHERE year = ?1 AND voter = ?2 AND subject NOT IN (SELECT value FROM json_each(?3))
      AND EXISTS (SELECT 1 FROM top10_ballots WHERE year = ?1 AND osu_id = ?2 AND status != 'void')`)
      .bind(year, voter, JSON.stringify(keep)),
  ];
  if (upserts.length) {
    const rows = upserts.map(w => ({
      subject: w.subject, body: w.body, words: w.words, cites: JSON.stringify(w.cites), flags: w.flags.join(','), mod: w.mod, reason: w.modReason ?? null,
    }));
    statements.push(db.prepare(`INSERT INTO top10_writeups (year, voter, subject, body, words, cites, flags, mod, mod_reason, updated)
      SELECT ?1, ?2, json_extract(value, '$.subject'), json_extract(value, '$.body'), json_extract(value, '$.words'),
        json_extract(value, '$.cites'), json_extract(value, '$.flags'), json_extract(value, '$.mod'), json_extract(value, '$.reason'), ?4
      FROM json_each(?3) WHERE EXISTS (SELECT 1 FROM top10_ballots WHERE year = ?1 AND osu_id = ?2 AND status != 'void')
      ON CONFLICT (year, voter, subject) DO UPDATE SET body = excluded.body, words = excluded.words, cites = excluded.cites,
        flags = excluded.flags, mod = excluded.mod, mod_reason = excluded.mod_reason, updated = excluded.updated`)
      .bind(year, voter, JSON.stringify(rows), now));
  }
  const [ballot] = await db.batch(statements);
  return changed(ballot);
}

/** Submits a draft (now public and counted). False if it isn't a draft. */
export async function submitBallot(db, year, voter, now) {
  const r = await db.prepare("UPDATE top10_ballots SET status = 'submitted', submitted_at = ?3, updated = ?3 WHERE year = ?1 AND osu_id = ?2 AND status = 'draft'")
    .bind(year, voter, now).run();
  return changed(r);
}

/** Takes a submitted ballot back to draft. False if it wasn't submitted. */
export async function withdrawBallot(db, year, voter, now) {
  const r = await db.prepare("UPDATE top10_ballots SET status = 'draft', submitted_at = NULL, updated = ?3 WHERE year = ?1 AND osu_id = ?2 AND status = 'submitted'")
    .bind(year, voter, now).run();
  return changed(r);
}

/** How many ballots are submitted for a year. */
export async function turnout(db, year) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT COUNT(*) AS n FROM top10_ballots WHERE year = ? AND status = 'submitted'").bind(year).first();
  return row?.n ?? 0;
}

/**
 * Every submitted ballot of a year, first submitted first, with its write-ups that aren't struck and whether each was
 * thanked: [{ voter, picks, …, thanks, writeups: { [subject]: { body, words, cites, thanked, updated } } }]. Flags and
 * mod notes are the writer's and the mods' business, so they aren't here.
 */
export async function publicBallots(db, year) {
  await ensureSchema(db);
  const [{ results: rows }, { results: writeups }, { results: thanks }] = await Promise.all([
    db.prepare("SELECT * FROM top10_ballots WHERE year = ? AND status = 'submitted' ORDER BY submitted_at, osu_id").bind(year).all(),
    db.prepare(`SELECT w.voter, w.subject, w.body, w.words, w.cites, w.updated FROM top10_writeups w
      JOIN top10_ballots b ON b.year = w.year AND b.osu_id = w.voter
      WHERE w.year = ? AND b.status = 'submitted' AND w.mod = 'ok'`).bind(year).all(),
    db.prepare("SELECT osu_id, target FROM top10_marks WHERE year = ? AND kind = 'thanks'").bind(year).all(),
  ]);
  const thanked = new Set(thanks.map(t => `${t.target}:${t.osu_id}`));
  const byVoter = new Map();
  for (const w of writeups) {
    if (!byVoter.has(w.voter)) byVoter.set(w.voter, {});
    byVoter.get(w.voter)[w.subject] = { body: w.body, words: w.words, cites: parse(w.cites, []), thanked: thanked.has(`${w.voter}:${w.subject}`), updated: iso(w.updated) };
  }
  return rows.map(row => {
    const { year: _, status, voidReason, ...ballot } = ballotOf(row);
    const writeupsOf = byVoter.get(row.osu_id) ?? {};
    return { ...ballot, thanks: Object.values(writeupsOf).filter(w => w.thanked).length, writeups: writeupsOf };
  });
}

// ---- Thanks and endorsements ----------------------------------------------------------------------------------------

/** Whether osu_id has marked `target` (a play to endorse, a voter to thank). */
export async function hasMark(db, year, kind, osuId, target) {
  await ensureSchema(db);
  return Boolean(await db.prepare('SELECT 1 AS y FROM top10_marks WHERE year = ? AND kind = ? AND osu_id = ? AND target = ?').bind(year, kind, osuId, target).first());
}

/** Sets or clears a mark. Returns true when that changed anything. */
export async function setMark(db, year, kind, osuId, target, on, now) {
  await ensureSchema(db);
  const r = on
    ? await db.prepare('INSERT OR IGNORE INTO top10_marks (year, kind, osu_id, target, created) VALUES (?, ?, ?, ?, ?)').bind(year, kind, osuId, target, now).run()
    : await db.prepare('DELETE FROM top10_marks WHERE year = ? AND kind = ? AND osu_id = ? AND target = ?').bind(year, kind, osuId, target).run();
  return changed(r);
}

/**
 * A thanks after finalize: the mark and its `top10.thanks` request in one go. The request is only queued when there
 * wasn't one for this write-up yet, so a double click can't queue two.
 */
export async function thankAfterFinalize(db, year, subject, voter, now) {
  await Promise.all([ensureSchema(db), ensureEconomy(db)]);
  const payload = JSON.stringify({ year, subject });
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO top10_marks (year, kind, osu_id, target, created) VALUES (?, 'thanks', ?, ?, ?)").bind(year, subject, voter, now),
    db.prepare(`INSERT INTO requests (id, osu_id, kind, payload, created, day)
      SELECT ?1, ?2, 'top10.thanks', ?3, ?4, ?5
      WHERE NOT EXISTS (SELECT 1 FROM requests WHERE osu_id = ?2 AND kind = 'top10.thanks'
        AND json_extract(payload, '$.year') = ?6 AND json_extract(payload, '$.subject') = ?7)`)
      .bind(requestId(), voter, payload, now, lisbonDay(now), year, subject),
  ]);
}

// ---- The showcase ---------------------------------------------------------------------------------------------------

const playOf = row => ({
  id: row.id, year: row.year, submitter: row.submitter, player: row.player, score: row.score_ref ?? null, beatmap: row.beatmap_id ?? null,
  caption: row.caption ?? '', clip: row.clip ?? null, created: iso(row.created), status: row.status, reason: row.reason ?? null,
});

/** How many showcase entries a player submitted in a year: { all, own } (own: of their own scores). */
export async function playCounts(db, year, submitter) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT COUNT(*) AS n, SUM(player = submitter) AS own FROM top10_plays WHERE year = ? AND submitter = ?').bind(year, submitter).first();
  return { all: row?.n ?? 0, own: row?.own ?? 0 };
}

/** The entry for a score already in a year's showcase, or null. */
export async function playByScore(db, year, ref) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT * FROM top10_plays WHERE year = ? AND score_ref = ?').bind(year, ref).first();
  return row ? playOf(row) : null;
}

/** Adds a showcase entry; returns it. */
export async function addPlay(db, { year, submitter, player, ref = null, beatmap = null, caption = '', clip = null }, now) {
  await ensureSchema(db);
  const row = await db.prepare(`INSERT INTO top10_plays (year, submitter, player, score_ref, beatmap_id, caption, clip, created)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).bind(year, submitter, player, ref, beatmap, caption, clip, now).first();
  return { ...playOf(row), endorsements: 0 };
}

/** One entry (any status), or null. */
export async function readPlay(db, id) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT * FROM top10_plays WHERE id = ?').bind(id).first();
  return row ? playOf(row) : null;
}

/** Deletes an entry and its endorsements. */
export async function deletePlay(db, play) {
  await db.batch([
    db.prepare('DELETE FROM top10_plays WHERE id = ?').bind(play.id),
    db.prepare("DELETE FROM top10_marks WHERE year = ? AND kind = 'endorse' AND target = ?").bind(play.year, play.id),
  ]);
}

/** How many endorsements a play has. */
export async function endorsements(db, year, playId) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM top10_marks WHERE year = ? AND kind = 'endorse' AND target = ?").bind(year, playId).first();
  return row?.n ?? 0;
}

/**
 * A year's showcase (the `ok` entries; all of them for `all`), optionally one player's, most endorsed first, with
 * their endorsement counts, and `endorsed` (by `viewer`) when a viewer is given.
 */
export async function listPlays(db, year, { player = null, viewer = null, all = false } = {}) {
  await ensureSchema(db);
  const [{ results: rows }, { results: counts }, mine] = await Promise.all([
    db.prepare(`SELECT * FROM top10_plays WHERE year = ?1 ${all ? '' : "AND status = 'ok'"} AND (?2 IS NULL OR player = ?2)`).bind(year, player).all(),
    db.prepare("SELECT target, COUNT(*) AS n FROM top10_marks WHERE year = ? AND kind = 'endorse' GROUP BY target").bind(year).all(),
    viewer ? db.prepare("SELECT target FROM top10_marks WHERE year = ? AND kind = 'endorse' AND osu_id = ?").bind(year, viewer).all() : null,
  ]);
  const count = new Map(counts.map(c => [c.target, c.n]));
  const endorsed = mine ? new Set(mine.results.map(m => m.target)) : null;
  return rows.map(row => ({ ...playOf(row), endorsements: count.get(row.id) ?? 0, ...(endorsed ? { endorsed: endorsed.has(row.id) } : {}) }))
    .sort((a, b) => b.endorsements - a.endorsements || a.created.localeCompare(b.created) || a.id - b.id);
}

// ---- Moderation -----------------------------------------------------------------------------------------------------

/** A write-up as the mods see it, or null. */
export async function readWriteup(db, year, voter, subject) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT * FROM top10_writeups WHERE year = ? AND voter = ? AND subject = ?').bind(year, voter, subject).first();
  return row ? writeupOf(row) : null;
}

/** A ballot row's status and void reason, or null. */
export async function ballotStatus(db, year, voter) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT status, submitted_at, updated, void_reason FROM top10_ballots WHERE year = ? AND osu_id = ?').bind(year, voter).first();
  return row ? { status: row.status, submittedAt: row.submitted_at, updated: row.updated, voidReason: row.void_reason ?? null } : null;
}

const logStatement = (db, { year, admin, action, target, reason }, now) => db.prepare('INSERT INTO top10_modlog (year, admin, action, target, reason, at) VALUES (?, ?, ?, ?, ?, ?)')
  .bind(year, admin, action, target, reason ?? null, now);

/**
 * Applies a mod action and logs it, in one batch. `action` is strike / restore / hide-play / show-play / void /
 * unvoid; `target` { voter, subject } for a write-up, { play } for a showcase entry, { voter } for a ballot.
 * Returns false when the thing didn't change (already in that state).
 */
export async function moderate(db, { year, admin, action, target, reason }, now) {
  await ensureSchema(db);
  let statement;
  let label;
  switch (action) {
    case 'strike':
    case 'restore':
      label = `writeup:${target.voter}:${target.subject}`;
      statement = action === 'strike'
        ? db.prepare("UPDATE top10_writeups SET mod = 'struck', mod_reason = ?4 WHERE year = ?1 AND voter = ?2 AND subject = ?3 AND mod != 'struck'").bind(year, target.voter, target.subject, reason)
        : db.prepare("UPDATE top10_writeups SET mod = 'ok', mod_reason = NULL, flags = '' WHERE year = ?1 AND voter = ?2 AND subject = ?3 AND (mod != 'ok' OR flags != '')").bind(year, target.voter, target.subject);
      break;
    case 'hide-play':
    case 'show-play':
      label = `play:${target.play}`;
      statement = action === 'hide-play'
        ? db.prepare("UPDATE top10_plays SET status = 'hidden', reason = ?2 WHERE id = ?1 AND status != 'hidden'").bind(target.play, reason)
        : db.prepare("UPDATE top10_plays SET status = 'ok', reason = NULL WHERE id = ?1 AND status != 'ok'").bind(target.play);
      break;
    case 'void':
      label = `ballot:${target.voter}`;
      statement = db.prepare("UPDATE top10_ballots SET status = 'void', void_reason = ?3 WHERE year = ?1 AND osu_id = ?2 AND status != 'void'").bind(year, target.voter, reason);
      break;
    case 'unvoid':
      label = `ballot:${target.voter}`;
      statement = db.prepare(`UPDATE top10_ballots SET status = CASE WHEN submitted_at IS NULL THEN 'draft' ELSE 'submitted' END, void_reason = NULL
        WHERE year = ?1 AND osu_id = ?2 AND status = 'void'`).bind(year, target.voter);
      break;
    default:
      throw new Error(`Unknown mod action ${action}.`);
  }
  if (!changed(await statement.run())) return false;
  await logStatement(db, { year, admin, action, target: label, reason }, now).run();
  return true;
}

const logOf = row => ({ seq: row.seq, year: row.year, admin: row.admin, action: row.action, target: row.target, reason: row.reason ?? null, at: iso(row.at) });

/** The mod log entries about a player's own things (their ballot, their write-ups, their showcase entries). */
export async function modlogAbout(db, year, osuId) {
  await ensureSchema(db);
  // The target strings are made here: a bound number can reach SQL as a REAL, and 'ballot:' || 4.0 isn't 'ballot:4'.
  const { results } = await db.prepare(`SELECT * FROM top10_modlog WHERE year = ?1 AND (target = ?3 OR target LIKE ?4
      OR target IN (SELECT 'play:' || id FROM top10_plays WHERE year = ?1 AND submitter = ?2))
    ORDER BY seq DESC LIMIT 100`).bind(year, osuId, `ballot:${osuId}`, `writeup:${osuId}:%`).all();
  return results.map(logOf);
}

/**
 * The admin queue: every write-up on a ballot that isn't a draft (flagged first, then the newest), every showcase
 * entry, the ballots (a draft's content stays private: only that it exists), and the latest mod log.
 */
export async function adminQueue(db, year) {
  await ensureSchema(db);
  const [{ results: ballots }, { results: writeups }, plays, { results: log }] = await Promise.all([
    db.prepare('SELECT * FROM top10_ballots WHERE year = ? ORDER BY updated DESC').bind(year).all(),
    db.prepare(`SELECT w.*, b.status AS ballot_status, b.picks AS ballot_picks FROM top10_writeups w
      JOIN top10_ballots b ON b.year = w.year AND b.osu_id = w.voter
      WHERE w.year = ? AND b.status != 'draft' ORDER BY (w.flags != '') DESC, w.updated DESC`).bind(year).all(),
    listPlays(db, year, { all: true }),
    db.prepare('SELECT * FROM top10_modlog WHERE year = ? ORDER BY seq DESC LIMIT 300').bind(year).all(),
  ]);
  return {
    writeups: writeups.map(r => ({
      ...writeupOf(r), updated: iso(r.updated), target: `writeup:${r.voter}:${r.subject}`, ballotStatus: r.ballot_status,
      pick: parse(r.ballot_picks, []).some(p => p.id === r.subject),
    })),
    plays: plays.map(p => ({ ...p, target: `play:${p.id}` })),
    ballots: ballots.map(r => (r.status === 'draft'
      ? { voter: r.osu_id, status: r.status, updated: iso(r.updated), target: `ballot:${r.osu_id}` }
      : { ...ballotOf(r), target: `ballot:${r.osu_id}` })),
    modlog: log.map(logOf),
  };
}

// ---- Results and finalize -------------------------------------------------------------------------------------------

/** A year's finalized results: { results (the JSON), finalizedAt, by }, or null. */
export async function readResults(db, year) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT json, finalized_at, "by" AS admin FROM top10_results WHERE year = ?').bind(year).first();
  return row ? { results: parse(row.json, null), finalizedAt: iso(row.finalized_at), by: row.admin } : null;
}

/** When a year was finalized (ISO), or null: readResults without reading the JSON. */
export async function finalizedAt(db, year) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT finalized_at FROM top10_results WHERE year = ?').bind(year).first();
  return row ? iso(row.finalized_at) : null;
}

/**
 * What finalize counts: the counted ballots (submitted, not void, last saved by `closes`), every write-up on them,
 * and the year's thanks.
 */
export async function finalizeInputs(db, year, closes) {
  await ensureSchema(db);
  const [{ results: rows }, { results: writeups }, { results: thanks }] = await Promise.all([
    db.prepare("SELECT * FROM top10_ballots WHERE year = ? AND status = 'submitted' AND updated <= ? ORDER BY submitted_at, osu_id").bind(year, closes).all(),
    db.prepare(`SELECT w.* FROM top10_writeups w JOIN top10_ballots b ON b.year = w.year AND b.osu_id = w.voter
      WHERE w.year = ? AND b.status = 'submitted' AND b.updated <= ?`).bind(year, closes).all(),
    db.prepare("SELECT osu_id AS subject, target AS voter FROM top10_marks WHERE year = ? AND kind = 'thanks'").bind(year).all(),
  ]);
  return {
    ballots: rows.map(r => ({ voter: r.osu_id, picks: parse(r.picks, []), mentions: parse(r.mentions, []), watch: parse(r.watch, []) })),
    writeups: writeups.map(writeupOf),
    thanks,
  };
}

/**
 * Saves the results and queues the payouts (from score.js payoutsFor) as requests for the bot, all in one batch: if
 * the year was already finalized, the results row's primary key refuses it and nothing at all is written. Returns the
 * payouts with their requestIds, or null when the year was already finalized.
 */
export async function saveFinal(db, { year, results, payouts, admin }, now) {
  await Promise.all([ensureSchema(db), ensureEconomy(db)]);
  const queued = payouts.map(p => ({ ...p, requestId: requestId() }));
  const rows = queued.map(p => ({ id: p.requestId, osu: p.osuId, kind: p.type, payload: JSON.stringify(p.payload) }));
  try {
    await db.batch([
      db.prepare('INSERT INTO top10_results (year, json, finalized_at, "by") VALUES (?, ?, ?, ?)').bind(year, JSON.stringify(results), now, admin),
      db.prepare(`INSERT INTO requests (id, osu_id, kind, payload, created, day)
        SELECT json_extract(value, '$.id'), json_extract(value, '$.osu'), json_extract(value, '$.kind'), json_extract(value, '$.payload'), ?2, ?3
        FROM json_each(?1) ORDER BY key`).bind(JSON.stringify(rows), now, lisbonDay(now)),
      logStatement(db, { year, admin, action: 'finalize', target: `results:${year}`, reason: `${results.ballots} ballots, ${payouts.length} requests` }, now),
    ]);
  } catch (e) {
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(e?.message))) return null;
    throw e;
  }
  return queued;
}
