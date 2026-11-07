-- The Top 10 of the year vote (TOP10-DESIGN.md §13.2, in the bot's repo): ballots, write-ups, the score showcase,
-- endorsements and thanks, the finalized results and the mod log. top10/store.js explains every table and column.
-- Payouts need nothing new: they're rows in `requests` with kinds top10.payout and top10.thanks.
--
-- Run ONCE against the live database, before or after deploying the code that needs it:
--   npx wrangler d1 execute ptctb-economy --remote --file=economy/migrations/0003_top10.sql
-- Try it on a local copy first by leaving out --remote. Running it twice changes nothing.
-- The deployed code makes the same tables on its first request if this was skipped (top10/store.js, ensureSchema).

CREATE TABLE IF NOT EXISTS top10_ballots (
  year INTEGER NOT NULL, osu_id INTEGER NOT NULL, picks TEXT NOT NULL DEFAULT '[]', mentions TEXT NOT NULL DEFAULT '[]',
  watch TEXT NOT NULL DEFAULT '[]', skills TEXT, intro TEXT NOT NULL DEFAULT '', outro TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft', submitted_at INTEGER, updated INTEGER NOT NULL, void_reason TEXT,
  PRIMARY KEY (year, osu_id)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS top10_writeups (
  year INTEGER NOT NULL, voter INTEGER NOT NULL, subject INTEGER NOT NULL, body TEXT NOT NULL, words INTEGER NOT NULL DEFAULT 0,
  cites TEXT NOT NULL DEFAULT '[]', flags TEXT NOT NULL DEFAULT '', mod TEXT NOT NULL DEFAULT 'ok', mod_reason TEXT,
  updated INTEGER NOT NULL, PRIMARY KEY (year, voter, subject)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS top10_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, submitter INTEGER NOT NULL, player INTEGER NOT NULL,
  score_ref INTEGER, beatmap_id INTEGER, caption TEXT, clip TEXT, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ok',
  reason TEXT);
CREATE INDEX IF NOT EXISTS top10_plays_by_year ON top10_plays (year, player);
CREATE UNIQUE INDEX IF NOT EXISTS top10_plays_score ON top10_plays (year, score_ref);

CREATE TABLE IF NOT EXISTS top10_marks (
  year INTEGER NOT NULL, kind TEXT NOT NULL, osu_id INTEGER NOT NULL, target INTEGER NOT NULL, created INTEGER NOT NULL,
  PRIMARY KEY (year, kind, osu_id, target)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS top10_results (
  year INTEGER PRIMARY KEY, json TEXT NOT NULL, finalized_at INTEGER NOT NULL, "by" INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS top10_modlog (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, admin INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
  reason TEXT, at INTEGER NOT NULL);
