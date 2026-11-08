#!/usr/bin/env node
// Counts the past Top 10 editions (top10/history/*.json, TOP10-DESIGN.md §13.10) with the season's score.js, prints
// each one's ranking to check by eye, and writes the SQL that serves them from GET /api/top10/results?year=.
//
//   node top10/import-past.mjs                  check every edition and print its ranking (names from data/players.json
//                                               when there's a local export)
//   node top10/import-past.mjs --sql [file]     the same, then write the SQL (default: top10-past.sql in the temp
//                                               folder) and print the wrangler command that runs it
//
// Nothing is sent anywhere: the SQL goes to D1 only when you run the printed command. Run it again after the history
// files or their aliases change; it replaces those years.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEdition, pastResults, pastSql } from './past.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const historyDir = path.join(root, 'top10', 'history');
const args = process.argv.slice(2);
const sqlAt = args.indexOf('--sql');

const files = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).filter(f => f.endsWith('.json')).sort() : [];
if (!files.length) {
  console.error(`No editions in ${historyDir} yet.`);
  process.exit(1);
}
let names = new Map();
try {
  names = new Map(JSON.parse(fs.readFileSync(path.join(root, 'data', 'players.json'), 'utf8')).map(p => [p.id, p.name]));
} catch { /* no local export: ids only */ }
const nameOf = id => (names.has(id) ? `${names.get(id)} (${id})` : String(id));

const editions = [];
let failed = false;
for (const file of files) {
  const edition = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf8'));
  const { errors, warnings } = checkEdition(edition);
  for (const w of warnings) console.warn(`${file}: warning: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`${file}: error: ${e}`);
    failed = true;
    continue;
  }
  const results = pastResults(edition);
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
if (sqlAt !== -1) {
  const out = args[sqlAt + 1] && !args[sqlAt + 1].startsWith('--') ? path.resolve(args[sqlAt + 1]) : path.join(os.tmpdir(), 'top10-past.sql');
  fs.writeFileSync(out, pastSql(editions));
  console.log(`\nWrote ${out} (${editions.length} editions). To serve them on the release site:`);
  console.log(`  npx wrangler d1 execute ptctb-economy --remote --file="${out}"`);
}
