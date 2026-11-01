-- The admin panel (contract §8): the bot's refusal code next to its reason. Admin requests themselves need nothing
-- new: they go in `requests` with kinds starting "admin.".
--
-- Run ONCE against the live database, before or after deploying the code that needs it:
--   npx wrangler d1 execute ptctb-economy --remote --file=economy/migrations/0002_admin.sql
-- Run twice, it fails with "duplicate column name", which is harmless. If it's skipped, the code adds the column on its
-- first request (economy/store.js, ensureSchema).

ALTER TABLE requests ADD COLUMN code TEXT;
