-- The Top 10 vote (TOP10-DESIGN.md §13.2 and §13.11, in the bot's repo): the yearly and all-time ballots (`kind`
-- 'year' or 'alltime'), write-ups, the score showcase (`scope` 'year' or 'alltime'), endorsements and thanks, the
-- finalized results and the mod log. top10/store.js explains every table and column. Payouts need nothing new: they're
-- rows in `requests` with kinds top10.payout and top10.thanks.
--
-- Run ONCE against the live database, before or after deploying the code that needs it:
--   npx wrangler d1 execute ptctb-economy --remote --file=economy/migrations/0003_top10.sql
-- Try it on a local copy first by leaving out --remote. Running it twice changes nothing.
-- The deployed code makes the same tables on its first request if this was skipped (top10/store.js, ensureSchema).
--
-- A database that has the first version of these tables (without `kind`; dev's mock season) needs them dropped first,
-- since CREATE TABLE IF NOT EXISTS leaves an existing table as it is:
--   DROP TABLE IF EXISTS top10_ballots; DROP TABLE IF EXISTS top10_writeups; DROP TABLE IF EXISTS top10_plays;
--   DROP TABLE IF EXISTS top10_marks; DROP TABLE IF EXISTS top10_results; DROP TABLE IF EXISTS top10_modlog;

CREATE TABLE IF NOT EXISTS top10_ballots (
  year INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'year', osu_id INTEGER NOT NULL, picks TEXT NOT NULL DEFAULT '[]',
  mentions TEXT NOT NULL DEFAULT '[]', watch TEXT NOT NULL DEFAULT '[]', skills TEXT, intro TEXT NOT NULL DEFAULT '',
  outro TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', submitted_at INTEGER, updated INTEGER NOT NULL,
  void_reason TEXT, PRIMARY KEY (year, kind, osu_id)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS top10_writeups (
  year INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'year', voter INTEGER NOT NULL, subject INTEGER NOT NULL, body TEXT NOT NULL,
  words INTEGER NOT NULL DEFAULT 0, cites TEXT NOT NULL DEFAULT '[]', cards TEXT NOT NULL DEFAULT '{}', flags TEXT NOT NULL DEFAULT '',
  mod TEXT NOT NULL DEFAULT 'ok', mod_reason TEXT, updated INTEGER NOT NULL, PRIMARY KEY (year, kind, voter, subject)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS top10_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, scope TEXT NOT NULL DEFAULT 'year', submitter INTEGER NOT NULL,
  player INTEGER NOT NULL, score_ref TEXT, refs TEXT NOT NULL DEFAULT '[]', beatmap_id INTEGER, card TEXT, caption TEXT, clip TEXT,
  created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ok', reason TEXT, has_replay INTEGER, played_at INTEGER, replay_sha TEXT,
  replay_name TEXT);
CREATE INDEX IF NOT EXISTS top10_plays_by_year ON top10_plays (year, scope, player);
CREATE UNIQUE INDEX IF NOT EXISTS top10_plays_score ON top10_plays (year, scope, score_ref);
CREATE UNIQUE INDEX IF NOT EXISTS top10_plays_replay ON top10_plays (year, scope, replay_sha);

CREATE TABLE IF NOT EXISTS top10_marks (
  year INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'year', mark TEXT NOT NULL, osu_id INTEGER NOT NULL, target INTEGER NOT NULL,
  created INTEGER NOT NULL, PRIMARY KEY (year, kind, mark, osu_id, target)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS top10_results (
  year INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'year', json TEXT NOT NULL, finalized_at INTEGER NOT NULL, "by" INTEGER NOT NULL,
  PRIMARY KEY (year, kind)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS top10_modlog (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, admin INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
  reason TEXT, at INTEGER NOT NULL);
