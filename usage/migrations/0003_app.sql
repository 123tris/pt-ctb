-- Usage counts: which app drew the page an event happened on ('new', 'fallback' when an old page stood in in the new
-- app, '' for the old app), so /stats can compare the two (usage/store.js, usage/insights.js).
--
-- Run ONCE against the live database, before deploying the code that needs it (SETUP-HOSTING.md, "Usage counts"):
--   npx wrangler d1 execute ptctb-usage --remote --file=usage/migrations/0003_app.sql
-- Try it on a local copy first by leaving out --remote. A second run fails with "duplicate column name"; that's harmless.
-- The deployed code makes the same change on its first request if this was skipped (usage/store.js, ensureSchema).
--
-- Cost: no rows are rewritten (SQLite adds a column with a constant default without touching existing rows).

ALTER TABLE events ADD COLUMN app TEXT NOT NULL DEFAULT '';
