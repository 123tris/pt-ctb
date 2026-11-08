// Storage for the Top 10 vote (TOP10-DESIGN.md §13.2 and §13.11), in the ECONOMY database next to Bananas, so the
// payouts go through the one inbox the bot already pulls (economy/store.js). Two ballots share the season: `kind` is
// 'year' (the top 10 of the year) or 'alltime' (of all time); wherever it's left out it's 'year'.
//
//   top10_ballots   one per (year, kind, osu! id): the ranked picks [{ id, spot }], honourable mentions and ones to
//                   watch [id] (none on an all-time ballot), skills (null for now), intro and outro, and status:
//                   'draft' (private), 'submitted' (public, counts) or 'void' (a mod's, with void_reason). `updated`
//                   is the last save; submitted_at the submit.
//   top10_writeups  one per (year, kind, voter, subject): the text, its words and flags (top10/words.js; a comma
//                   list), cites (score refs, top10/refs.js) and `cards`, what each cited play looked like when it was
//                   cited ({ [ref]: card }, so reads never look anything up), and the mods' word: mod 'ok' (the
//                   default) or 'struck', with mod_reason.
//   top10_plays     the score showcase, in two scopes: 'year' (plays set in the season's year) and 'alltime'
//                   ("Legendary plays", any year). score_ref is the play's canonical ref (osu:<id>, legacy:<id> or
//                   map:<beatmap>:<player>; null for a replay file or a clip), `refs` every ref it's known by (for
//                   duplicates, within a scope; also osr:<sha256> for an .osr sent with a score whose replay osu!
//                   keeps, which isn't stored), `card` its score as shown (resolved once, at submit), caption, clip
//                   link, status 'ok' or 'hidden' (with the mod's reason). From the osu! API check (§13.9): has_replay
//                   (null when osu! wasn't asked) and played_at. From an uploaded .osr the site stores: replay_sha
//                   (its SHA-256, the R2 key replays/<sha>.osr) and replay_name (the file name it downloads as).
//   top10_marks     `mark` 'endorse' (osu_id endorses play `target`; kind is the play's scope) or 'thanks' (osu_id, the
//                   subject, thanks the write-up on voter `target`'s ballot of that kind). The primary key is the "once
//                   per person" rule.
//   top10_results   the results JSON per (year, kind) (top10/score.js): a finalized season's, once only, or a past
//                   edition's (top10/past.js, "by" 0). When and by whom.
//   top10_modlog    every mod action: who, what, on what ("writeup:<voter>:<subject>", "play:<id>", "ballot:<voter>",
//                   "results:<year>"; an all-time ballot's say so: "writeup:alltime:<voter>:<subject>",
//                   "ballot:alltime:<voter>"), why and when. Writers see the entries about their own things.
//
// What this hands on uses the columns' names (submitted_at, void_reason, mod_reason, score_ref, beatmap_id…); top10/api.js
// shapes the answers from them.
//
// Payouts and thanks are rows in economy's `requests` (kinds top10.payout and top10.thanks, with the ballot's kind in
// the payload), inserted only here, so the bot reads them through /api/economy/inbox like any other request (§13.6).
//
// Free plan: a ballot save is one statement batch of up to 3 (the ballot row, deleted write-ups, upserted write-ups,
// with only the write-ups that changed written); finalize is one batch of 3 whatever the turnout (the requests go in
// as one INSERT … SELECT over a JSON array, since D1 counts each statement against its 50 queries per call).

import { ensureSchema as ensureEconomy, iso, lisbonDay } from '../economy/store.js';

export const KINDS = ['year', 'alltime'];
export const SCOPES = ['year', 'alltime'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS top10_ballots (
    year INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'year', osu_id INTEGER NOT NULL, picks TEXT NOT NULL DEFAULT '[]',
    mentions TEXT NOT NULL DEFAULT '[]', watch TEXT NOT NULL DEFAULT '[]', skills TEXT, intro TEXT NOT NULL DEFAULT '',
    outro TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', submitted_at INTEGER, updated INTEGER NOT NULL,
    void_reason TEXT, PRIMARY KEY (year, kind, osu_id)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS top10_writeups (
    year INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'year', voter INTEGER NOT NULL, subject INTEGER NOT NULL, body TEXT NOT NULL,
    words INTEGER NOT NULL DEFAULT 0, cites TEXT NOT NULL DEFAULT '[]', cards TEXT NOT NULL DEFAULT '{}', flags TEXT NOT NULL DEFAULT '',
    mod TEXT NOT NULL DEFAULT 'ok', mod_reason TEXT, updated INTEGER NOT NULL, PRIMARY KEY (year, kind, voter, subject)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS top10_plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, scope TEXT NOT NULL DEFAULT 'year', submitter INTEGER NOT NULL,
    player INTEGER NOT NULL, score_ref TEXT, refs TEXT NOT NULL DEFAULT '[]', beatmap_id INTEGER, card TEXT, caption TEXT, clip TEXT,
    created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ok', reason TEXT, has_replay INTEGER, played_at INTEGER, replay_sha TEXT,
    replay_name TEXT)`,
  'CREATE INDEX IF NOT EXISTS top10_plays_by_year ON top10_plays (year, scope, player)',
  'CREATE UNIQUE INDEX IF NOT EXISTS top10_plays_score ON top10_plays (year, scope, score_ref)',
  'CREATE UNIQUE INDEX IF NOT EXISTS top10_plays_replay ON top10_plays (year, scope, replay_sha)',
  `CREATE TABLE IF NOT EXISTS top10_marks (
    year INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'year', mark TEXT NOT NULL, osu_id INTEGER NOT NULL, target INTEGER NOT NULL,
    created INTEGER NOT NULL, PRIMARY KEY (year, kind, mark, osu_id, target)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS top10_results (
    year INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'year', json TEXT NOT NULL, finalized_at INTEGER NOT NULL, "by" INTEGER NOT NULL,
    PRIMARY KEY (year, kind)) WITHOUT ROWID`,
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

/** A mod log target for a ballot's things: the yearly ballot's as before, an all-time one's with "alltime:" in it. */
export const writeupTarget = (kind, voter, subject) => `writeup:${kind === 'alltime' ? 'alltime:' : ''}${voter}:${subject}`;
export const ballotTarget = (kind, voter) => `ballot:${kind === 'alltime' ? 'alltime:' : ''}${voter}`;
const targetKind = target => (/^(writeup|ballot):alltime:/.test(target) ? 'alltime' : 'year');

// ---- Ballots and write-ups ------------------------------------------------------------------------------------------

/** A ballot row as the API shows it (without write-ups). */
function ballotOf(row) {
  return {
    year: row.year, kind: row.kind, voter: row.osu_id, status: row.status,
    picks: parse(row.picks, []), mentions: parse(row.mentions, []), watch: parse(row.watch, []), skills: parse(row.skills, null),
    intro: row.intro, outro: row.outro,
    submitted_at: row.submitted_at ? iso(row.submitted_at) : null, updated: iso(row.updated),
    void_reason: row.void_reason ?? null,
  };
}

/** A write-up row: { kind, voter, subject, body, words, cites, cards, flags: [...], mod, mod_reason, updated (unix seconds) }. */
const writeupOf = row => ({
  kind: row.kind, voter: row.voter, subject: row.subject, body: row.body, words: row.words, cites: parse(row.cites, []), cards: parse(row.cards, {}),
  flags: flagList(row.flags), mod: row.mod, mod_reason: row.mod_reason ?? null, updated: row.updated,
});

/** A player's ballot of a kind for a year with all its write-ups (the owner's view; `thanks` is 0 or 1 on each), or null. */
export async function readBallot(db, year, osuId, kind = 'year') {
  await ensureSchema(db);
  const [row, { results }, { results: thanks }] = await Promise.all([
    db.prepare('SELECT * FROM top10_ballots WHERE year = ? AND kind = ? AND osu_id = ?').bind(year, kind, osuId).first(),
    db.prepare('SELECT * FROM top10_writeups WHERE year = ? AND kind = ? AND voter = ?').bind(year, kind, osuId).all(),
    db.prepare("SELECT osu_id FROM top10_marks WHERE year = ? AND kind = ? AND mark = 'thanks' AND target = ?").bind(year, kind, osuId).all(),
  ]);
  if (!row) return null;
  const thanked = new Set(thanks.map(t => t.osu_id));
  return { ...ballotOf(row), writeups: results.map(r => ({ ...writeupOf(r), thanks: thanked.has(r.subject) ? 1 : 0 })) };
}

/**
 * The bodies of every write-up of a year but the ones on this ballot, for the copy check: [{ kind, voter, subject,
 * body }]. The voter's other ballot is included: the same text on both ballots doesn't pay twice.
 */
export async function otherBodies(db, year, voter, kind = 'year') {
  await ensureSchema(db);
  const { results } = await db.prepare('SELECT kind, voter, subject, body FROM top10_writeups WHERE year = ?1 AND NOT (voter = ?2 AND kind = ?3)')
    .bind(year, voter, kind).all();
  return results;
}

/**
 * Saves a ballot: the lists and texts (a new ballot is a draft; an existing one keeps its status, so a submitted
 * ballot's edits are live), the write-ups that changed (`upserts`: [{ subject, body, words, cites, cards, flags, mod,
 * mod_reason }]), and drops the write-ups on anyone no longer listed (`keep`: the listed ids). A void ballot isn't
 * touched. Returns false when it was void.
 */
export async function saveBallot(db, { year, kind = 'year', voter, picks, mentions, watch, intro, outro }, { upserts = [], keep }, now) {
  await ensureSchema(db);
  const statements = [
    db.prepare(`INSERT INTO top10_ballots (year, kind, osu_id, picks, mentions, watch, intro, outro, status, updated)
      VALUES (?1, ?9, ?2, ?3, ?4, ?5, ?6, ?7, 'draft', ?8)
      ON CONFLICT (year, kind, osu_id) DO UPDATE SET picks = excluded.picks, mentions = excluded.mentions, watch = excluded.watch,
        intro = excluded.intro, outro = excluded.outro, updated = excluded.updated
      WHERE top10_ballots.status != 'void'`)
      .bind(year, voter, JSON.stringify(picks), JSON.stringify(mentions), JSON.stringify(watch), intro, outro, now, kind),
    db.prepare(`DELETE FROM top10_writeups WHERE year = ?1 AND kind = ?4 AND voter = ?2 AND subject NOT IN (SELECT value FROM json_each(?3))
      AND EXISTS (SELECT 1 FROM top10_ballots WHERE year = ?1 AND kind = ?4 AND osu_id = ?2 AND status != 'void')`)
      .bind(year, voter, JSON.stringify(keep), kind),
  ];
  if (upserts.length) {
    const rows = upserts.map(w => ({
      subject: w.subject, body: w.body, words: w.words, cites: JSON.stringify(w.cites), cards: JSON.stringify(w.cards ?? {}),
      flags: w.flags.join(','), mod: w.mod, reason: w.mod_reason ?? null,
    }));
    statements.push(db.prepare(`INSERT INTO top10_writeups (year, kind, voter, subject, body, words, cites, cards, flags, mod, mod_reason, updated)
      SELECT ?1, ?5, ?2, json_extract(value, '$.subject'), json_extract(value, '$.body'), json_extract(value, '$.words'),
        json_extract(value, '$.cites'), json_extract(value, '$.cards'), json_extract(value, '$.flags'), json_extract(value, '$.mod'),
        json_extract(value, '$.reason'), ?4
      FROM json_each(?3) WHERE EXISTS (SELECT 1 FROM top10_ballots WHERE year = ?1 AND kind = ?5 AND osu_id = ?2 AND status != 'void')
      ON CONFLICT (year, kind, voter, subject) DO UPDATE SET body = excluded.body, words = excluded.words, cites = excluded.cites,
        cards = excluded.cards, flags = excluded.flags, mod = excluded.mod, mod_reason = excluded.mod_reason, updated = excluded.updated`)
      .bind(year, voter, JSON.stringify(rows), now, kind));
  }
  const [ballot] = await db.batch(statements);
  return changed(ballot);
}

/** Submits a draft (now public and counted). False if it isn't a draft. */
export async function submitBallot(db, year, voter, now, kind = 'year') {
  const r = await db.prepare("UPDATE top10_ballots SET status = 'submitted', submitted_at = ?3, updated = ?3 WHERE year = ?1 AND kind = ?4 AND osu_id = ?2 AND status = 'draft'")
    .bind(year, voter, now, kind).run();
  return changed(r);
}

/** Takes a submitted ballot back to draft. False if it wasn't submitted. */
export async function withdrawBallot(db, year, voter, now, kind = 'year') {
  const r = await db.prepare("UPDATE top10_ballots SET status = 'draft', submitted_at = NULL, updated = ?3 WHERE year = ?1 AND kind = ?4 AND osu_id = ?2 AND status = 'submitted'")
    .bind(year, voter, now, kind).run();
  return changed(r);
}

/** How many ballots of each kind are submitted for a year: { year, alltime } (whole numbers; void ballots and drafts don't count). */
export async function turnouts(db, year) {
  await ensureSchema(db);
  const { results } = await db.prepare("SELECT kind, COUNT(*) AS n FROM top10_ballots WHERE year = ? AND status = 'submitted' GROUP BY kind").bind(year).all();
  const out = Object.fromEntries(KINDS.map(k => [k, 0]));
  for (const r of results) if (r.kind in out) out[r.kind] = Number(r.n);
  return out;
}

/** How many ballots of a kind are submitted for a year. */
export const turnout = async (db, year, kind = 'year') => (await turnouts(db, year))[kind] ?? 0;

/**
 * Every submitted ballot of a kind for a year, first submitted first, with its write-ups that aren't struck: [{ voter,
 * kind, picks, mentions, watch, skills, intro, outro, submitted_at, updated, thanks, writeups: { [subject]: { body,
 * words, cites, thanks, updated } }, scores: { [ref]: card } }]. `thanks` is 0 or 1 on a write-up (only its subject
 * can thank it), and the ballot's total. Flags and mod notes are the writer's and the mods' business, so they aren't
 * here; who's looking isn't either, so this can be cached (the API adds `thanked` for a signed-in viewer).
 */
export async function publicBallots(db, year, kind = 'year') {
  await ensureSchema(db);
  const [{ results: rows }, { results: writeups }, { results: thanks }] = await Promise.all([
    db.prepare("SELECT * FROM top10_ballots WHERE year = ? AND kind = ? AND status = 'submitted' ORDER BY submitted_at, osu_id").bind(year, kind).all(),
    db.prepare(`SELECT w.voter, w.subject, w.body, w.words, w.cites, w.cards, w.updated FROM top10_writeups w
      JOIN top10_ballots b ON b.year = w.year AND b.kind = w.kind AND b.osu_id = w.voter
      WHERE w.year = ? AND w.kind = ? AND b.status = 'submitted' AND w.mod = 'ok'`).bind(year, kind).all(),
    db.prepare("SELECT osu_id, target FROM top10_marks WHERE year = ? AND kind = ? AND mark = 'thanks'").bind(year, kind).all(),
  ]);
  const thanked = new Set(thanks.map(t => `${t.target}:${t.osu_id}`));
  const byVoter = new Map();
  for (const w of writeups) {
    if (!byVoter.has(w.voter)) byVoter.set(w.voter, { writeups: {}, scores: {} });
    const mine = byVoter.get(w.voter);
    const cites = parse(w.cites, []);
    mine.writeups[w.subject] = { body: w.body, words: w.words, cites, thanks: thanked.has(`${w.voter}:${w.subject}`) ? 1 : 0, updated: iso(w.updated) };
    const cards = parse(w.cards, {});
    for (const ref of cites) if (cards[ref]) mine.scores[ref] = cards[ref];
  }
  return rows.map(row => {
    const { year: _, status, void_reason, ...ballot } = ballotOf(row);
    const { writeups: written, scores } = byVoter.get(row.osu_id) ?? { writeups: {}, scores: {} };
    return { ...ballot, thanks: Object.values(written).reduce((n, w) => n + w.thanks, 0), writeups: written, scores };
  });
}

/** The voters whose write-up about `subject` (on a ballot of that kind) that subject has thanked, in a year. */
export async function thankedBy(db, year, subject, kind = 'year') {
  await ensureSchema(db);
  const { results } = await db.prepare("SELECT target FROM top10_marks WHERE year = ? AND kind = ? AND mark = 'thanks' AND osu_id = ?").bind(year, kind, subject).all();
  return new Set(results.map(r => r.target));
}

// ---- Thanks and endorsements ----------------------------------------------------------------------------------------

/** Whether osu_id has marked `target` (`mark`: 'endorse' a play, 'thanks' a voter's write-up on a ballot of `kind`). */
export async function hasMark(db, year, mark, osuId, target, kind = 'year') {
  await ensureSchema(db);
  return Boolean(await db.prepare('SELECT 1 AS y FROM top10_marks WHERE year = ? AND kind = ? AND mark = ? AND osu_id = ? AND target = ?').bind(year, kind, mark, osuId, target).first());
}

/** Sets or clears a mark. Returns true when that changed anything. */
export async function setMark(db, year, mark, osuId, target, on, now, kind = 'year') {
  await ensureSchema(db);
  const r = on
    ? await db.prepare('INSERT OR IGNORE INTO top10_marks (year, kind, mark, osu_id, target, created) VALUES (?, ?, ?, ?, ?, ?)').bind(year, kind, mark, osuId, target, now).run()
    : await db.prepare('DELETE FROM top10_marks WHERE year = ? AND kind = ? AND mark = ? AND osu_id = ? AND target = ?').bind(year, kind, mark, osuId, target).run();
  return changed(r);
}

/**
 * A thanks after finalize: the mark and its `top10.thanks` request ({ year, kind, subject }) in one go. The request is
 * only queued when there wasn't one for this write-up yet, so a double click can't queue two. A request without a kind
 * is a yearly one.
 */
export async function thankAfterFinalize(db, year, subject, voter, now, kind = 'year') {
  await Promise.all([ensureSchema(db), ensureEconomy(db)]);
  const payload = JSON.stringify({ year, kind, subject });
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO top10_marks (year, kind, mark, osu_id, target, created) VALUES (?, ?, 'thanks', ?, ?, ?)").bind(year, kind, subject, voter, now),
    db.prepare(`INSERT INTO requests (id, osu_id, kind, payload, created, day)
      SELECT ?1, ?2, 'top10.thanks', ?3, ?4, ?5
      WHERE NOT EXISTS (SELECT 1 FROM requests WHERE osu_id = ?2 AND kind = 'top10.thanks'
        AND json_extract(payload, '$.year') = ?6 AND json_extract(payload, '$.subject') = ?7
        AND COALESCE(json_extract(payload, '$.kind'), 'year') = ?8)`)
      .bind(requestId(), voter, payload, now, lisbonDay(now), year, subject, kind),
  ]);
}

// ---- The showcase ---------------------------------------------------------------------------------------------------

/** A play row: the columns, with created as ISO, refs and card parsed, has_replay as true / false / null. */
const playOf = row => ({
  id: row.id, year: row.year, scope: row.scope, submitter: row.submitter, player: row.player, score_ref: row.score_ref ?? null, refs: parse(row.refs, []),
  beatmap_id: row.beatmap_id ?? null, card: parse(row.card, null), caption: row.caption ?? '', clip: row.clip ?? null, created: iso(row.created),
  status: row.status, reason: row.reason ?? null, has_replay: row.has_replay === null || row.has_replay === undefined ? null : Boolean(row.has_replay),
  played_at: row.played_at ?? null, replay_sha: row.replay_sha ?? null, replay_name: row.replay_name ?? null,
});

/** How many showcase entries a player submitted in a year's scope: { all, own } (own: of their own plays). */
export async function playCounts(db, year, submitter, scope = 'year') {
  await ensureSchema(db);
  const row = await db.prepare('SELECT COUNT(*) AS n, SUM(player = submitter) AS own FROM top10_plays WHERE year = ? AND scope = ? AND submitter = ?').bind(year, scope, submitter).first();
  return { all: row?.n ?? 0, own: row?.own ?? 0 };
}

/** How many entries one submitter added for one player in a season's showcase (of a scope): one per other player. */
export async function playsFor(db, year, submitter, player, scope = 'year') {
  await ensureSchema(db);
  const row = await db.prepare('SELECT COUNT(*) AS n FROM top10_plays WHERE year = ? AND scope = ? AND submitter = ? AND player = ?').bind(year, scope, submitter, player).first();
  return row?.n ?? 0;
}

/** The entry in a year's showcase (of a scope; any scope for null) known by any of these refs (top10/refs.js), or null. */
export async function playByRefs(db, year, refs, scope = 'year') {
  await ensureSchema(db);
  if (!refs?.length) return null;
  const row = await db.prepare(`SELECT * FROM top10_plays p WHERE year = ?1 AND (?3 IS NULL OR scope = ?3)
    AND EXISTS (SELECT 1 FROM json_each(p.refs) r WHERE r.value IN (SELECT value FROM json_each(?2)))`).bind(year, JSON.stringify(refs), scope).first();
  return row ? playOf(row) : null;
}

/** The entry in a year's showcase scope with this replay file, or null. */
export async function playBySha(db, year, sha, scope = 'year') {
  await ensureSchema(db);
  const row = await db.prepare('SELECT * FROM top10_plays WHERE year = ? AND scope = ? AND replay_sha = ?').bind(year, scope, sha).first();
  return row ? playOf(row) : null;
}

/** Whether any entry (any year, any scope) still uses a replay file. */
export async function replayInUse(db, sha) {
  await ensureSchema(db);
  return Boolean(await db.prepare('SELECT 1 AS y FROM top10_plays WHERE replay_sha = ? LIMIT 1').bind(sha).first());
}

/** Adds a showcase entry; returns it (playOf's shape, with no endorsements yet). */
export async function addPlay(db, { year, scope = 'year', submitter, player, ref = null, refs = [], beatmap = null, card = null, caption = '', clip = null, hasReplay = null, playedAt = null, replaySha = null, replayName = null }, now) {
  await ensureSchema(db);
  const row = await db.prepare(`INSERT INTO top10_plays (year, scope, submitter, player, score_ref, refs, beatmap_id, card, caption, clip, created, has_replay, played_at, replay_sha, replay_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
    .bind(year, scope, submitter, player, ref, JSON.stringify(refs), beatmap, card ? JSON.stringify(card) : null, caption, clip, now,
      hasReplay === null ? null : hasReplay ? 1 : 0, playedAt, replaySha, replayName).first();
  return { ...playOf(row), endorsements: 0 };
}

/** One entry (any status), or null. */
export async function readPlay(db, id) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT * FROM top10_plays WHERE id = ?').bind(id).first();
  return row ? playOf(row) : null;
}

/** Sets an entry's caption and clip (null for none). */
export async function editPlay(db, id, { caption, clip }) {
  await db.prepare('UPDATE top10_plays SET caption = ?, clip = ? WHERE id = ?').bind(caption, clip, id).run();
}

/** Deletes an entry and its endorsements. */
export async function deletePlay(db, play) {
  await db.batch([
    db.prepare('DELETE FROM top10_plays WHERE id = ?').bind(play.id),
    db.prepare("DELETE FROM top10_marks WHERE year = ? AND mark = 'endorse' AND target = ?").bind(play.year, play.id),
  ]);
}

/** How many endorsements a play has. */
export async function endorsements(db, year, playId) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM top10_marks WHERE year = ? AND mark = 'endorse' AND target = ?").bind(year, playId).first();
  return row?.n ?? 0;
}

/**
 * A year's showcase in a scope (the `ok` entries; all of them for `all`; every scope for scope null), optionally one
 * player's, most endorsed first, with their endorsement counts, and `endorsed` (by `viewer`) when a viewer is given.
 */
export async function listPlays(db, year, { scope = 'year', player = null, viewer = null, all = false } = {}) {
  await ensureSchema(db);
  const [{ results: rows }, { results: counts }, mine] = await Promise.all([
    db.prepare(`SELECT * FROM top10_plays WHERE year = ?1 ${all ? '' : "AND status = 'ok'"} AND (?2 IS NULL OR player = ?2) AND (?3 IS NULL OR scope = ?3)`)
      .bind(year, player, scope).all(),
    db.prepare("SELECT target, COUNT(*) AS n FROM top10_marks WHERE year = ? AND mark = 'endorse' GROUP BY target").bind(year).all(),
    viewer ? db.prepare("SELECT target FROM top10_marks WHERE year = ? AND mark = 'endorse' AND osu_id = ?").bind(year, viewer).all() : null,
  ]);
  const count = new Map(counts.map(c => [c.target, c.n]));
  const endorsed = mine ? new Set(mine.results.map(m => m.target)) : null;
  return rows.map(row => ({ ...playOf(row), endorsements: count.get(row.id) ?? 0, ...(endorsed ? { endorsed: endorsed.has(row.id) } : {}) }))
    .sort((a, b) => b.endorsements - a.endorsements || a.created.localeCompare(b.created) || a.id - b.id);
}

// ---- Moderation -----------------------------------------------------------------------------------------------------

/** A write-up as the mods see it, or null. */
export async function readWriteup(db, year, voter, subject, kind = 'year') {
  await ensureSchema(db);
  const row = await db.prepare('SELECT * FROM top10_writeups WHERE year = ? AND kind = ? AND voter = ? AND subject = ?').bind(year, kind, voter, subject).first();
  return row ? writeupOf(row) : null;
}

/** A ballot row's status: { status, submitted_at, updated (unix seconds), void_reason }, or null. */
export async function ballotStatus(db, year, voter, kind = 'year') {
  await ensureSchema(db);
  const row = await db.prepare('SELECT status, submitted_at, updated, void_reason FROM top10_ballots WHERE year = ? AND kind = ? AND osu_id = ?').bind(year, kind, voter).first();
  return row ? { status: row.status, submitted_at: row.submitted_at, updated: row.updated, void_reason: row.void_reason ?? null } : null;
}

const logStatement = (db, { year, admin, action, target, reason }, now) => db.prepare('INSERT INTO top10_modlog (year, admin, action, target, reason, at) VALUES (?, ?, ?, ?, ?, ?)')
  .bind(year, admin, action, target, reason ?? null, now);

/**
 * Applies a mod action and logs it. `action` is strike / restore / hide-play / show-play / void / unvoid; `target`
 * { voter, subject } for a write-up, { play } for a showcase entry, { voter } for a ballot; `kind` the ballot's.
 * Returns false when the thing didn't change (already in that state); nothing is logged then.
 */
export async function moderate(db, { year, kind = 'year', admin, action, target, reason }, now) {
  await ensureSchema(db);
  let statement;
  let label;
  switch (action) {
    case 'strike':
    case 'restore':
      label = writeupTarget(kind, target.voter, target.subject);
      statement = action === 'strike'
        ? db.prepare("UPDATE top10_writeups SET mod = 'struck', mod_reason = ?4 WHERE year = ?1 AND kind = ?5 AND voter = ?2 AND subject = ?3 AND mod != 'struck'").bind(year, target.voter, target.subject, reason, kind)
        : db.prepare("UPDATE top10_writeups SET mod = 'ok', mod_reason = NULL, flags = '' WHERE year = ?1 AND kind = ?4 AND voter = ?2 AND subject = ?3 AND (mod != 'ok' OR flags != '')").bind(year, target.voter, target.subject, kind);
      break;
    case 'hide-play':
    case 'show-play':
      label = `play:${target.play}`;
      statement = action === 'hide-play'
        ? db.prepare("UPDATE top10_plays SET status = 'hidden', reason = ?2 WHERE id = ?1 AND status != 'hidden'").bind(target.play, reason)
        : db.prepare("UPDATE top10_plays SET status = 'ok', reason = NULL WHERE id = ?1 AND status != 'ok'").bind(target.play);
      break;
    case 'void':
      label = ballotTarget(kind, target.voter);
      statement = db.prepare("UPDATE top10_ballots SET status = 'void', void_reason = ?3 WHERE year = ?1 AND kind = ?4 AND osu_id = ?2 AND status != 'void'").bind(year, target.voter, reason, kind);
      break;
    case 'unvoid':
      label = ballotTarget(kind, target.voter);
      statement = db.prepare(`UPDATE top10_ballots SET status = CASE WHEN submitted_at IS NULL THEN 'draft' ELSE 'submitted' END, void_reason = NULL
        WHERE year = ?1 AND kind = ?3 AND osu_id = ?2 AND status = 'void'`).bind(year, target.voter, kind);
      break;
    default:
      throw new Error(`Unknown mod action ${action}.`);
  }
  if (!changed(await statement.run())) return false;
  await logStatement(db, { year, admin, action, target: label, reason }, now).run();
  return true;
}

const logOf = row => ({
  seq: row.seq, year: row.year, kind: targetKind(row.target), admin: row.admin, action: row.action, target: row.target,
  reason: row.reason ?? null, at: iso(row.at),
});

/** The mod log entries about a player's own things (both ballots, their write-ups, their showcase entries). */
export async function modlogAbout(db, year, osuId) {
  await ensureSchema(db);
  // The target strings are made here: a bound number can reach SQL as a REAL, and 'ballot:' || 4.0 isn't 'ballot:4'.
  const { results } = await db.prepare(`SELECT * FROM top10_modlog WHERE year = ?1 AND (target IN (?3, ?5) OR target LIKE ?4 OR target LIKE ?6
      OR target IN (SELECT 'play:' || id FROM top10_plays WHERE year = ?1 AND submitter = ?2))
    ORDER BY seq DESC LIMIT 100`)
    .bind(year, osuId, ballotTarget('year', osuId), writeupTarget('year', osuId, '%'), ballotTarget('alltime', osuId), writeupTarget('alltime', osuId, '%')).all();
  return results.map(logOf);
}

/**
 * The admin queue (of one kind, or both for null): every write-up on a ballot that isn't a draft (flagged first, then
 * the newest; `ranked` when it's about a pick, so it pays), every showcase entry of both scopes (playOf rows), the
 * ballots (a draft's content stays private: only that it exists), and the latest mod log.
 */
export async function adminQueue(db, year, kind = null) {
  await ensureSchema(db);
  const [{ results: ballots }, { results: writeups }, plays, { results: log }] = await Promise.all([
    db.prepare('SELECT * FROM top10_ballots WHERE year = ?1 AND (?2 IS NULL OR kind = ?2) ORDER BY updated DESC').bind(year, kind).all(),
    db.prepare(`SELECT w.*, b.status AS ballot_status, b.picks AS ballot_picks FROM top10_writeups w
      JOIN top10_ballots b ON b.year = w.year AND b.kind = w.kind AND b.osu_id = w.voter
      WHERE w.year = ?1 AND (?2 IS NULL OR w.kind = ?2) AND b.status != 'draft' ORDER BY (w.flags != '') DESC, w.updated DESC`).bind(year, kind).all(),
    listPlays(db, year, { scope: null, all: true }),
    db.prepare('SELECT * FROM top10_modlog WHERE year = ? ORDER BY seq DESC LIMIT 300').bind(year).all(),
  ]);
  return {
    writeups: writeups.map(r => {
      const { cards, ...w } = writeupOf(r);
      return {
        ...w, updated: iso(r.updated), ranked: parse(r.ballot_picks, []).some(p => p.id === r.subject), ballot_status: r.ballot_status,
        target: writeupTarget(r.kind, r.voter, r.subject),
      };
    }),
    plays,
    ballots: ballots.map(r => (r.status === 'draft'
      ? { voter: r.osu_id, kind: r.kind, status: r.status, updated: iso(r.updated), target: ballotTarget(r.kind, r.osu_id) }
      : { ...ballotOf(r), target: ballotTarget(r.kind, r.osu_id) })),
    log: log.map(logOf),
  };
}

// ---- Results and finalize -------------------------------------------------------------------------------------------

/** A year's saved results of a kind: { results (the JSON), finalizedAt, by }, or null. */
export async function readResults(db, year, kind = 'year') {
  await ensureSchema(db);
  const row = await db.prepare('SELECT json, finalized_at, "by" AS admin FROM top10_results WHERE year = ? AND kind = ?').bind(year, kind).first();
  return row ? { results: parse(row.json, null), finalizedAt: iso(row.finalized_at), by: row.admin } : null;
}

/** The editions with saved results (past ones included), newest first, the yearly before the all-time: [{ year, kind, label }]. */
export async function resultYears(db) {
  await ensureSchema(db);
  const { results } = await db.prepare("SELECT year, kind, json_extract(json, '$.label') AS label FROM top10_results ORDER BY year DESC, kind = 'alltime'").all();
  return results.map(r => ({ year: r.year, kind: r.kind, label: r.label ?? String(r.year) }));
}

/** When a year was finalized (ISO; a kind's, or the season's for null: any kind), or null. */
export async function finalizedAt(db, year, kind = null) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT MIN(finalized_at) AS at FROM top10_results WHERE year = ?1 AND (?2 IS NULL OR kind = ?2)').bind(year, kind).first();
  return row?.at ? iso(row.at) : null;
}

/**
 * What finalize counts for a kind: the counted ballots (submitted, not void, last saved by `closes`), every write-up
 * on them, and the year's thanks on that kind's write-ups.
 */
export async function finalizeInputs(db, year, closes, kind = 'year') {
  await ensureSchema(db);
  const [{ results: rows }, { results: writeups }, { results: thanks }] = await Promise.all([
    db.prepare("SELECT * FROM top10_ballots WHERE year = ? AND kind = ? AND status = 'submitted' AND updated <= ? ORDER BY submitted_at, osu_id").bind(year, kind, closes).all(),
    db.prepare(`SELECT w.* FROM top10_writeups w JOIN top10_ballots b ON b.year = w.year AND b.kind = w.kind AND b.osu_id = w.voter
      WHERE w.year = ? AND w.kind = ? AND b.status = 'submitted' AND b.updated <= ?`).bind(year, kind, closes).all(),
    db.prepare("SELECT osu_id AS subject, target AS voter FROM top10_marks WHERE year = ? AND kind = ? AND mark = 'thanks'").bind(year, kind).all(),
  ]);
  return {
    ballots: rows.map(r => ({ voter: r.osu_id, picks: parse(r.picks, []), mentions: parse(r.mentions, []), watch: parse(r.watch, []) })),
    writeups: writeups.map(writeupOf),
    thanks,
  };
}

/**
 * Saves the results of each published kind (`published`: [{ kind, results }]) and queues the payouts (from score.js
 * payoutsFor, both kinds) as requests for the bot, all in one batch: if the year was already finalized, a results
 * row's primary key refuses it and nothing at all is written. Returns the payouts with their requestIds, or null when
 * the year was already finalized.
 */
export async function saveFinal(db, { year, published, payouts, admin }, now) {
  await Promise.all([ensureSchema(db), ensureEconomy(db)]);
  const queued = payouts.map(p => ({ ...p, requestId: requestId() }));
  const rows = queued.map(p => ({ id: p.requestId, osu: p.osuId, kind: p.type, payload: JSON.stringify(p.payload) }));
  const summary = published.map(p => `${p.kind} ${p.results.ballots} ballots`).join(', ');
  try {
    await db.batch([
      ...published.map(p => db.prepare('INSERT INTO top10_results (year, kind, json, finalized_at, "by") VALUES (?, ?, ?, ?, ?)')
        .bind(year, p.kind, JSON.stringify(p.results), now, admin)),
      db.prepare(`INSERT INTO requests (id, osu_id, kind, payload, created, day)
        SELECT json_extract(value, '$.id'), json_extract(value, '$.osu'), json_extract(value, '$.kind'), json_extract(value, '$.payload'), ?2, ?3
        FROM json_each(?1) ORDER BY key`).bind(JSON.stringify(rows), now, lisbonDay(now)),
      logStatement(db, { year, admin, action: 'finalize', target: `results:${year}`, reason: `${summary}; ${payouts.length} requests` }, now),
    ]);
  } catch (e) {
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(e?.message))) return null;
    throw e;
  }
  return queued;
}
