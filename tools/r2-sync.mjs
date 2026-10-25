#!/usr/bin/env node
// Keeps the site's data on Cloudflare R2 (served at https://data.ptcatch.com) and the exporter's memory (state/) in a
// private bucket, for publish.ps1. No dependencies; credentials from R2_ACCOUNT_ID / R2_ACCESS_KEY_ID /
// R2_SECRET_ACCESS_KEY (tools/lib/r2.mjs).
//
//   node tools/r2-sync.mjs check     both buckets exist and the keys can use them
//   node tools/r2-sync.mjs restore   fill in a missing data/ or state/ from R2 (a fresh checkout, or after git
//                                    stopped tracking them), so the export carries on from where the last one left off
//   node tools/r2-sync.mjs upload    send the new files, then meta.json, then prune; then state/ to the private bucket
//   node tools/r2-sync.mjs status    this month's usage against the caps, and the bucket's size
//
// On R2 every data file is stored under a name with the hash of its content (players/1.<hash>.json, core/data-name.js),
// so an object never changes once written: it's cached for a year, and a new export never overwrites what a visitor
// with the previous meta.json is still reading. Each upload sends only names that aren't there yet, then meta.json
// (the one fixed name, cached for a minute) last, so a fresh manifest never points at a missing file. If anything
// fails before that, the site keeps serving the previous manifest. Files the new manifest no longer names are
// "retired" with a timestamp in state/r2.json and deleted (deletes are free) once nothing has used them for a day, so
// the bucket holds about one day of history. Every request is counted against hard caps first (tools/lib/r2-budget.mjs);
// one that would pass a cap is never sent, and the run exits with code 3.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { credentialsFromEnv, r2Client } from './lib/r2.mjs';
import { BudgetError, LIMITS, budget, freshUsage } from './lib/r2-budget.mjs';
import { hashedName } from '../assets/js/core/data-name.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUCKETS = { data: process.env.R2_DATA_BUCKET || 'ptcatch-data', state: process.env.R2_STATE_BUCKET || 'ptcatch-state' };
export const DIRS = { dataDir: path.join(root, 'data'), stateDir: path.join(root, 'state') };
/** The exporter's memory, kept in the private bucket. */
const STATE_FILES = ['state.json', 'beatmaps.json'];
/** This tool's own record: usage counts and retired files. Also kept in the private bucket, uploaded last. */
const LEDGER = 'r2.json';
/** How long a file the manifest stopped naming stays, for visitors who loaded the previous manifest (open tabs). */
export const GRACE_MS = 24 * 60 * 60 * 1000;
const JSON_TYPE = 'application/json; charset=utf-8';

/**
 * meta.json: browsers always revalidate it (max-age=0); Cloudflare's edge keeps it a minute (s-maxage=60), so however
 * many visitors there are it costs R2 at most one read a minute per edge location. Everything else never changes.
 */
export const cacheControl = key => (key === 'meta.json' ? 'public, max-age=0, s-maxage=60' : 'public, max-age=31536000, immutable');

const md5 = buf => createHash('md5').update(buf).digest('hex');
/** The exporter's content hash (tools/export.mjs): sha256, base64url, first 10 characters. */
const contentHash = buf => createHash('sha256').update(buf).digest('base64url').slice(0, 10);

/** The ledger in `stateDir`: { usage, retired: { key: ms } }, rolled over to the current month and day. */
export function readLedger(stateDir, nowMs) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(path.join(stateDir, LEDGER), 'utf8')); } catch { /* none yet */ }
  return { usage: freshUsage(saved.usage, nowMs), retired: saved.retired ?? {} };
}
export function writeLedger(stateDir, ledger) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, LEDGER), JSON.stringify(ledger));
}

/** Runs `tasks` (functions returning promises) `width` at a time; stops taking new ones after the first failure. */
async function pool(tasks, width = 8) {
  let next = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, async () => {
    while (!failed && next < tasks.length) {
      try { await tasks[next++](); } catch (e) { failed = true; throw e; }
    }
  }));
}

/**
 * The local export as R2 objects: meta.json plus one { key: hashed name, file, size } per file meta.json names. Throws,
 * before anything is sent, when the export looks wrong: no meta.json, or a named file missing or not matching its hash.
 */
export function localExport(dataDir) {
  const metaFile = path.join(dataDir, 'meta.json');
  if (!fs.existsSync(metaFile)) throw new Error('data/meta.json is missing: export first. Nothing was uploaded.');
  const metaBody = fs.readFileSync(metaFile);
  const files = Object.entries(JSON.parse(metaBody).files ?? {}).map(([name, hash]) => {
    const file = path.join(dataDir, name);
    if (!fs.existsSync(file)) throw new Error(`meta.json names ${name}, which isn't in data/. Nothing was uploaded.`);
    const body = fs.readFileSync(file);
    if (contentHash(body) !== hash) throw new Error(`data/${name} doesn't match its hash in meta.json. Nothing was uploaded.`);
    return { key: hashedName(name, hash), file, size: body.length };
  });
  return { meta: { key: 'meta.json', body: metaBody }, files };
}

export async function check({ client }) {
  await client.check(BUCKETS.data);
  await client.check(BUCKETS.state);
  console.log(`R2: buckets ${BUCKETS.data} and ${BUCKETS.state} are reachable.`);
}

export async function restore({ client, budget: b, ledger, now = Date.now() }, { dataDir, stateDir } = DIRS) {
  for (const name of [LEDGER, ...STATE_FILES]) {
    if (fs.existsSync(path.join(stateDir, name))) continue;
    const body = await client.get(BUCKETS.state, name);
    if (!body) continue;
    if (name === LEDGER) {
      // Carry on counting from the saved record (zeroed if it's from an earlier month or day), plus this run so far.
      const saved = JSON.parse(body);
      const usage = freshUsage(saved.usage, now);
      for (const k of ['a', 'b', 'dayA']) ledger.usage[k] += usage[k];
      ledger.retired = { ...saved.retired, ...ledger.retired };
      writeLedger(stateDir, ledger);
    } else {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, name), body);
    }
    console.log(`R2: restored state/${name}.`);
  }
  if (!fs.existsSync(path.join(dataDir, 'meta.json'))) {
    const metaBody = await client.get(BUCKETS.data, 'meta.json');
    if (!metaBody) return;
    const files = Object.entries(JSON.parse(metaBody).files ?? {});
    b.need(0, files.length);
    await pool(files.map(([name, hash]) => async () => {
      const body = await client.get(BUCKETS.data, hashedName(name, hash));
      if (!body) throw new Error(`R2 is missing ${hashedName(name, hash)}, which meta.json names.`);
      fs.mkdirSync(path.dirname(path.join(dataDir, name)), { recursive: true });
      fs.writeFileSync(path.join(dataDir, name), body);
    }));
    fs.writeFileSync(path.join(dataDir, 'meta.json'), metaBody); // last, so a half-finished restore is retried
    console.log(`R2: restored ${files.length} data files into data/.`);
  }
}

export async function upload({ client, budget: b, ledger, now = Date.now() }, { dataDir, stateDir } = DIRS) {
  const local = localExport(dataDir);
  const remote = await client.list(BUCKETS.data);
  const remoteByKey = new Map(remote.map(o => [o.key, o]));
  const named = new Set([local.meta.key, ...local.files.map(f => f.key)]);

  // Prune: files retired over a day ago that the new manifest doesn't bring back. Deletes are free.
  const prune = remote.filter(o => !named.has(o.key) && ledger.retired[o.key] && now - ledger.retired[o.key] > GRACE_MS);
  const uploads = local.files.filter(f => !remoteByKey.has(f.key));
  const metaChanged = remoteByKey.get('meta.json')?.etag !== md5(local.meta.body);

  // Check the whole run against the caps before sending anything: these uploads, meta.json, the state bucket's list,
  // up to three state files and the ledger.
  b.uploads(uploads.length);
  b.need(uploads.length + (metaChanged ? 1 : 0) + 5);
  const bytes = remote.reduce((n, o) => n + o.size, 0) - prune.reduce((n, o) => n + o.size, 0) + uploads.reduce((n, f) => n + f.size, 0);
  b.storage(bytes);

  await pool(uploads.map(f => () => client.put(BUCKETS.data, f.key, fs.readFileSync(f.file), { 'Content-Type': JSON_TYPE, 'Cache-Control': cacheControl(f.key) })));
  if (metaChanged) await client.put(BUCKETS.data, 'meta.json', local.meta.body, { 'Content-Type': JSON_TYPE, 'Cache-Control': cacheControl('meta.json') });
  await pool(prune.map(o => () => client.delete(BUCKETS.data, o.key)));

  // Bookkeeping for the next prunes: what's on R2 now and not named is retired from now (if it wasn't already).
  const retired = {};
  for (const o of remote) {
    if (named.has(o.key) || prune.includes(o)) continue;
    retired[o.key] = ledger.retired[o.key] ?? now;
  }
  ledger.retired = retired;

  const remoteState = new Map((await client.list(BUCKETS.state)).map(o => [o.key, o.etag]));
  const stateUploads = STATE_FILES.filter(name => fs.existsSync(path.join(stateDir, name)))
    .map(name => ({ name, body: fs.readFileSync(path.join(stateDir, name)) }))
    .filter(f => remoteState.get(f.name) !== md5(f.body));
  await pool(stateUploads.map(f => () => client.put(BUCKETS.state, f.name, f.body, { 'Content-Type': JSON_TYPE })));

  console.log(uploads.length || metaChanged || prune.length || stateUploads.length
    ? `R2: ${uploads.length} new data file(s)${metaChanged ? ', then meta.json' : ''}; ${prune.length} pruned, ${Object.keys(retired).length} retired; `
      + `state: ${stateUploads.map(f => f.name).join(', ') || 'unchanged'}; bucket ${(bytes / 1024 ** 2).toFixed(1)} MiB.`
    : 'R2: nothing changed.');
  await saveLedger({ client, budget: b, ledger }, stateDir);
}

/** Writes the ledger to the private bucket and locally; the uploaded copy already counts its own upload. */
async function saveLedger({ client, ledger }, stateDir) {
  const usage = { ...ledger.usage, a: ledger.usage.a + 1, dayA: ledger.usage.dayA + 1 };
  await client.put(BUCKETS.state, LEDGER, Buffer.from(JSON.stringify({ ...ledger, usage })), { 'Content-Type': JSON_TYPE });
  writeLedger(stateDir, ledger);
}

export async function status({ client, ledger }) {
  const objects = await client.list(BUCKETS.data);
  const bytes = objects.reduce((n, o) => n + o.size, 0);
  const u = ledger.usage;
  const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;
  console.log([
    `R2 usage counted by publish, ${u.month} (UTC):`,
    `  Class A: ${u.a} this month (${pct(u.a, LIMITS.classAMonth)} of the cap ${LIMITS.classAMonth}; free tier 1,000,000), ${u.dayA} today (cap ${LIMITS.classADay})`,
    `  Class B: ${u.b} this month (cap ${LIMITS.classBMonth}; free tier 10,000,000; visitors' reads are extra but mostly cached)`,
    `  Storage: ${objects.length} objects, ${(bytes / 1024 ** 2).toFixed(1)} MiB (cap ${LIMITS.storageBytes / 1024 ** 3} GiB; free tier 10 GB); ${Object.keys(ledger.retired).length} retired`,
  ].join('\n'));
}

const COMMANDS = { check, restore, upload, status };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = COMMANDS[process.argv[2]];
  if (!command) {
    console.error(`Usage: node tools/r2-sync.mjs ${Object.keys(COMMANDS).join('|')}`);
    process.exit(2);
  }
  const now = Date.now();
  const ledger = readLedger(DIRS.stateDir, now);
  const b = budget(ledger.usage);
  let code = 0;
  try {
    const client = r2Client(credentialsFromEnv(), { onOperation: cls => b.spend(cls) });
    await command({ client, budget: b, ledger, now });
  } catch (e) {
    console.error(e.message);
    code = e instanceof BudgetError ? 3 : 1;
  } finally {
    writeLedger(DIRS.stateDir, ledger); // the counts are kept even when a run fails
  }
  process.exit(code);
}
