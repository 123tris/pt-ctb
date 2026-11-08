#!/usr/bin/env node
// Counts the past Top 10 editions (top10/history/*.json, TOP10-DESIGN.md §13.10) with the season's score.js, prints
// each one's ranking to check by eye, and writes the SQL that serves them from GET /api/top10/results?year=.
//
//   node top10/import-past.mjs                  check every edition and print its ranking
//   node top10/import-past.mjs --sql [file]     the same, then write the SQL (default: top10-past.sql in the temp
//                                               folder) and print the wrangler command that runs it
//   --dir <folder>                              read the editions from another folder (default: top10/history)
//
// Names (the results' `names`, which the pages show for players the site's index doesn't have): data/players.json
// when there's a local export, then ALIASES.md's current names, next to the editions. An id with neither is warned
// about and shown as its number.
//
// Nothing is sent anywhere: the SQL goes to D1 only when you run the printed command. Run it again after the history
// files or their aliases change; it replaces those years. The results are cached at the edge for up to a day.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEdition, editionIds, namesFromAliases, pastResults, pastSql } from './past.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : null;
};
const historyDir = path.resolve(option('--dir') ?? path.join(root, 'top10', 'history'));
const sqlOut = option('--sql');

const files = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).filter(f => /^\d{4}.*\.json$/.test(f)).sort() : [];
if (!files.length) {
  console.error(`No editions in ${historyDir} yet.`);
  process.exit(1);
}
const names = new Map();
try {
  for (const p of JSON.parse(fs.readFileSync(path.join(root, 'data', 'players.json'), 'utf8'))) if (p?.id && p.name) names.set(p.id, p.name);
} catch { /* no local export */ }
try {
  for (const [id, name] of namesFromAliases(fs.readFileSync(path.join(historyDir, 'ALIASES.md'), 'utf8'))) if (!names.has(id)) names.set(id, name);
} catch { /* no alias table */ }
const nameOf = id => (names.has(id) ? `${names.get(id)} (${id})` : String(id));

const editions = [];
let failed = false;
for (const file of files) {
  const edition = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf8'));
  const { errors, warnings } = checkEdition(edition);
  for (const w of warnings) console.warn(`${file}: warning: ${w}`);
  const unnamed = editionIds(edition).filter(id => !names.has(id));
  if (unnamed.length) console.warn(`${file}: warning: no name for ${unnamed.join(', ')} (shown as the number)`);
  if (errors.length) {
    for (const e of errors) console.error(`${file}: error: ${e}`);
    failed = true;
    continue;
  }
  const results = pastResults(edition, { names });
  editions.push(results);
  console.log(`\n${results.label} (year ${results.year}): ${results.ballots} lists`);
  for (const r of results.ranking) {
    console.log(`  ${String(r.rank).padStart(3)}. ${r.score.toFixed(2).padStart(5)}  ${nameOf(r.id)}  on ${r.lists} of ${r.eligible} lists, ${r.firsts} #1s`);
  }
}
if (failed) {
  console.error('\nFix the errors above first; nothing was written.');
  process.exit(1);
}
if (sqlOut !== undefined) {
  const out = sqlOut ? path.resolve(sqlOut) : path.join(os.tmpdir(), 'top10-past.sql');
  fs.writeFileSync(out, pastSql(editions));
  console.log(`\nWrote ${out} (${editions.length} editions). To serve them on the release site:`);
  console.log(`  npx wrangler d1 execute ptctb-economy --remote --file="${out}"`);
}
