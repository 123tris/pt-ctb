// Just enough of Cloudflare D1's API (prepare/bind/first/all/run/batch) over node:sqlite, so `npm run serve -- --usage`
// can run the usage Functions (usage/store.js, usage/dashboard.js) locally without wrangler. Not for production.

import { DatabaseSync } from 'node:sqlite';

export function sqliteD1(file = ':memory:') {
  const sqlite = new DatabaseSync(file);
  const meta = { rows_read: 0 };
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args), meta }),
    run: async () => { sqlite.prepare(sql).run(...args); return { success: true, meta }; },
    exec: () => (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql) ? { results: sqlite.prepare(sql).all(...args), meta } : (sqlite.prepare(sql).run(...args), { results: [], meta })),
  });
  return {
    prepare: sql => statement(sql),
    // D1 runs a batch as one transaction.
    batch: async stmts => {
      sqlite.exec('BEGIN');
      try { const out = stmts.map(s => s.exec()); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
}
