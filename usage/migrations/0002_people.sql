-- Usage counts, version 2: visitor and session ids, the osu! player a visitor chose to give, timings, and the
-- anonymous daily rollup (usage/store.js explains every table and column).
--
-- Run ONCE against the live database, before deploying the code that needs it (SETUP-HOSTING.md, "Usage counts"):
--   npx wrangler d1 execute ptctb-usage --remote --file=usage/migrations/0002_people.sql
-- Try it on a local copy first by leaving out --remote. The ALTERs fail with "duplicate column name" if run twice;
-- that's harmless (nothing else in the file changes anything a second time).
-- The deployed code makes the same changes on its first request if this was skipped (usage/store.js, ensureSchema).
--
-- Cost: no rows are rewritten (SQLite adds a column with a constant default without touching existing rows), so this
-- reads and writes almost nothing.

ALTER TABLE events ADD COLUMN sid TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN player INTEGER;
ALTER TABLE events ADD COLUMN val INTEGER;
ALTER TABLE events ADD COLUMN obj TEXT NOT NULL DEFAULT '';
ALTER TABLE quota ADD COLUMN writes INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY, env TEXT NOT NULL, visitor TEXT NOT NULL, day TEXT NOT NULL, start INTEGER NOT NULL, last INTEGER NOT NULL,
  batches INTEGER NOT NULL DEFAULT 1, events INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0,
  entry TEXT NOT NULL DEFAULT '', exit TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '',
  player INTEGER, who TEXT NOT NULL DEFAULT '', returned INTEGER NOT NULL DEFAULT 0,
  device TEXT NOT NULL DEFAULT '', browser TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '',
  vw INTEGER, vh INTEGER, scheme TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS sessions_by_day ON sessions (env, day);

CREATE TABLE IF NOT EXISTS visitors (
  visitor TEXT PRIMARY KEY, env TEXT NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL, first_day TEXT NOT NULL, last_day TEXT NOT NULL,
  days INTEGER NOT NULL DEFAULT 1, sessions INTEGER NOT NULL DEFAULT 1, events INTEGER NOT NULL DEFAULT 0,
  player INTEGER, who TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS rollup (
  day TEXT NOT NULL, env TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, detail TEXT NOT NULL,
  n INTEGER NOT NULL, visits INTEGER NOT NULL, total INTEGER, PRIMARY KEY (day, env, kind, name, detail)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS limits (day TEXT NOT NULL, source TEXT NOT NULL, events INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, source)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS forget (visitor TEXT PRIMARY KEY, day TEXT NOT NULL);
