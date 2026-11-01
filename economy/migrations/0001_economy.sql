-- Bananas 🍌, the site side: sign-ins, the paying daily game, spending requests and the bot's inbox cursor
-- (economy/store.js explains every table and column).
--
-- Run ONCE against the new database, before deploying the code that needs it (SETUP-HOSTING.md, "Bananas"):
--   npx wrangler d1 execute ptctb-economy --remote --file=economy/migrations/0001_economy.sql
-- Try it on a local copy first by leaving out --remote. Running it twice changes nothing.
-- The deployed code makes the same tables on its first request if this was skipped (economy/store.js, ensureSchema).

CREATE TABLE IF NOT EXISTS signins (
  osu_id INTEGER PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, first INTEGER NOT NULL, last INTEGER NOT NULL, times INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS daily_rounds (
  day TEXT PRIMARY KEY, options TEXT NOT NULL, answer INTEGER NOT NULL, made INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS daily_game (
  day TEXT NOT NULL, osu_id INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, guesses TEXT NOT NULL DEFAULT '',
  solved INTEGER NOT NULL DEFAULT 0, finished INTEGER, seq INTEGER UNIQUE, PRIMARY KEY (day, osu_id)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS requests (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, osu_id INTEGER NOT NULL, kind TEXT NOT NULL,
  payload TEXT NOT NULL, created INTEGER NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT, decided INTEGER);
CREATE INDEX IF NOT EXISTS requests_by_player ON requests (osu_id, seq);

CREATE TABLE IF NOT EXISTS inbox_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
