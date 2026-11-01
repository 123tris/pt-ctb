// Just enough of Cloudflare D1's API (prepare/bind/first/all/run/batch) over node:sqlite, so `npm run serve -- --usage`
// and `-- --economy` can run the usage and Bananas Functions (usage/store.js, usage/dashboard.js, economy/api.js)
// locally without wrangler, and the tests can run them too. Not for production. run() reports `meta.changes`, as D1
// does.

import { DatabaseSync } from 'node:sqlite';

export function sqliteD1(file = ':memory:') {
  const sqlite = new DatabaseSync(file);
  const meta = { rows_read: 0 };
  const run = (sql, args) => ({ success: true, meta: { ...meta, changes: Number(sqlite.prepare(sql).run(...args).changes) } });
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args), meta }),
    run: async () => run(sql, args),
    exec: () => (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql) ? { results: sqlite.prepare(sql).all(...args), meta } : { results: [], ...run(sql, args) }),
  });
  return {
    sqlite,
    prepare: sql => statement(sql),
    // D1 runs a batch as one transaction.
    batch: async stmts => {
      sqlite.exec('BEGIN');
      try { const out = stmts.map(s => s.exec()); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
}
