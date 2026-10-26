// publish's R2 step against an in-memory bucket pair: what gets uploaded, in which order, what gets pruned, the
// safety caps, and restoring a fresh checkout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BUCKETS, GRACE_MS, cacheControl, readLedger, restore, upload } from './r2-sync.mjs';
import { BudgetError, budget, freshUsage, LIMITS } from './lib/r2-budget.mjs';
import { operationClass } from './lib/r2.mjs';
import { hashedName, plainName } from '../assets/js/core/data-name.js';

const md5 = s => createHash('md5').update(s).digest('hex');
const hash = s => createHash('sha256').update(s).digest('base64url').slice(0, 10);
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-26T12:00:00Z');

/** A fake R2 client: buckets of key → { body, headers, modified }, a log of writes, and every call counted like R2 bills it. */
function fakeR2(b, initial = {}) {
  const buckets = { [BUCKETS.data]: new Map(), [BUCKETS.state]: new Map() };
  for (const [bucket, files] of Object.entries(initial)) {
    for (const [k, v] of Object.entries(files)) buckets[bucket].set(k, { body: Buffer.from(v.body ?? v), headers: {}, modified: v.modified ?? NOW - HOUR });
  }
  const log = [];
  const op = (method, query) => b.spend(operationClass(method, query));
  return {
    buckets, log,
    async check() { op('GET', { 'list-type': '2' }); },
    async list(bk) { op('GET', { 'list-type': '2' }); return [...buckets[bk]].map(([key, o]) => ({ key, etag: md5(o.body), size: o.body.length, modified: o.modified })); },
    async get(bk, k) { op('GET'); return buckets[bk].get(k)?.body ?? null; },
    async put(bk, k, body, headers) { op('PUT'); log.push(`put ${bk}/${k}`); buckets[bk].set(k, { body, headers, modified: NOW }); },
    async delete(bk, k) { op('DELETE'); log.push(`delete ${bk}/${k}`); buckets[bk].delete(k); },
  };
}

/** Temp data/ and state/ folders. `files` is { name: text }; meta.json is written to list them with their hashes. */
function folders({ files = {}, state = {}, meta = true }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-sync-'));
  const dataDir = path.join(root, 'data');
  const stateDir = path.join(root, 'state');
  const write = (dir, name, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  };
  for (const [name, text] of Object.entries(files)) write(dataDir, name, text);
  if (meta) write(dataDir, 'meta.json', metaFor(files));
  for (const [name, text] of Object.entries(state)) write(stateDir, name, text);
  return { dataDir, stateDir };
}
const metaFor = files => JSON.stringify({ generatedAt: 1, files: Object.fromEntries(Object.entries(files).map(([n, t]) => [n, hash(t)])) });
/** A run's context, as the CLI builds it. */
function context(dirs, now = NOW) {
  const ledger = readLedger(dirs.stateDir, now);
  return { ledger, budget: budget(ledger.usage), now };
}
const remoteFor = files => Object.fromEntries(Object.entries(files).map(([n, t]) => [hashedName(n, hash(t)), t]));

test('data names: the content hash goes before the extension, and back', () => {
  assert.equal(hashedName('players/1.json', 'YqdZgQh-qv'), 'players/1.YqdZgQh-qv.json');
  assert.equal(hashedName('players/1-head.json', 'a_b-c1234X'), 'players/1-head.a_b-c1234X.json');
  assert.equal(plainName('data/players/1.YqdZgQh-qv.json'), 'data/players/1.json');
  assert.equal(plainName('data/players/1.json'), 'data/players/1.json');
});

test('a first upload sends every file under its hashed name, meta.json last, with the right caching, then the state and ledger', async () => {
  const files = { 'players.json': '[1]', 'players/1.json': '{}' };
  const dirs = folders({ files, state: { 'state.json': '{"a":1}', 'beatmaps.json': '{}' } });
  const ctx = context(dirs);
  const r2 = fakeR2(ctx.budget);
  await upload({ ...ctx, client: r2 }, dirs);
  const data = r2.log.filter(l => l.includes(BUCKETS.data));
  assert.deepEqual(data.slice(0, -1).sort(), [`put ${BUCKETS.data}/${hashedName('players.json', hash('[1]'))}`, `put ${BUCKETS.data}/${hashedName('players/1.json', hash('{}'))}`].sort());
  assert.equal(data.at(-1), `put ${BUCKETS.data}/meta.json`);
  assert.equal(r2.log.at(-1), `put ${BUCKETS.state}/r2.json`);
  const objects = r2.buckets[BUCKETS.data];
  assert.equal(objects.get('meta.json').headers['Cache-Control'], 'public, max-age=0, s-maxage=60');
  assert.equal(objects.get(hashedName('players.json', hash('[1]'))).headers['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(objects.get('meta.json').headers['Content-Type'], 'application/json; charset=utf-8');
  // 2 lists + 3 data puts + 2 state puts + the ledger = 8 Class A; the ledger's own copy says so too.
  assert.equal(ctx.ledger.usage.a, 8);
  assert.equal(JSON.parse(r2.buckets[BUCKETS.state].get('r2.json').body).usage.a, 8);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dirs.stateDir, 'r2.json'), 'utf8')).usage.a, 8);
});

test('an unchanged run sends nothing but the two lists and the ledger', async () => {
  const files = { 'a.json': '1' };
  const state = { 'state.json': '{}' };
  const dirs = folders({ files, state });
  const ctx = context(dirs);
  const r2 = fakeR2(ctx.budget, { [BUCKETS.data]: { ...remoteFor(files), 'meta.json': metaFor(files) }, [BUCKETS.state]: state });
  await upload({ ...ctx, client: r2 }, dirs);
  assert.deepEqual(r2.log, [`put ${BUCKETS.state}/r2.json`]);
  assert.equal(ctx.ledger.usage.a, 3);
});

test('a changed file goes up under a new name; the old one is retired, and deleted only a day later', async () => {
  const before = { 'a.json': '1', 'b.json': '2' };
  const after = { 'a.json': '1', 'b.json': '2 changed' };
  const dirs = folders({ files: after });
  const ctx = context(dirs);
  const r2 = fakeR2(ctx.budget, { [BUCKETS.data]: { ...remoteFor(before), 'meta.json': metaFor(before) } });
  await upload({ ...ctx, client: r2 }, dirs);
  const oldB = hashedName('b.json', hash('2'));
  assert.deepEqual(r2.log.filter(l => l.includes(BUCKETS.data)), [`put ${BUCKETS.data}/${hashedName('b.json', hash('2 changed'))}`, `put ${BUCKETS.data}/meta.json`]);
  assert.ok(r2.buckets[BUCKETS.data].has(oldB), 'kept for visitors still on the previous meta.json');
  assert.equal(ctx.ledger.retired[oldB], NOW);

  // Twelve hours later: still kept. A day and a bit later: deleted.
  for (const [later, kept] of [[12 * HOUR, true], [GRACE_MS + HOUR, false]]) {
    const next = context(dirs, NOW + later);
    r2.log.length = 0;
    await upload({ ...next, client: fakeR2Wrap(r2, next.budget) }, dirs);
    assert.equal(r2.buckets[BUCKETS.data].has(oldB), kept, `after ${later / HOUR}h`);
  }
  assert.ok(!(oldB in readLedger(dirs.stateDir, NOW).retired));
});
/** The same buckets with a new run's budget. */
function fakeR2Wrap(r2, b) {
  const fresh = fakeR2(b);
  fresh.buckets[BUCKETS.data] = r2.buckets[BUCKETS.data];
  fresh.buckets[BUCKETS.state] = r2.buckets[BUCKETS.state];
  fresh.log = r2.log;
  return { ...fresh, put: async (...a) => { r2.log.push(`put ${a[0]}/${a[1]}`); return fresh.put(...a); }, delete: async (...a) => { r2.log.push(`delete ${a[0]}/${a[1]}`); return fresh.delete(...a); } };
}

test('a file that comes back before its day is up is un-retired, not deleted', async () => {
  const v1 = { 'a.json': '1' };
  const v2 = { 'a.json': '2' };
  const dirs = folders({ files: v2 });
  const ctx = context(dirs);
  const r2 = fakeR2(ctx.budget, { [BUCKETS.data]: { ...remoteFor(v1), 'meta.json': metaFor(v1) } });
  await upload({ ...ctx, client: r2 }, dirs);
  const old = hashedName('a.json', hash('1'));
  assert.ok(old in ctx.ledger.retired);
  const back = folders({ files: v1, state: { 'r2.json': fs.readFileSync(path.join(dirs.stateDir, 'r2.json'), 'utf8') } });
  const later = context(back, NOW + GRACE_MS + HOUR);
  await upload({ ...later, client: fakeR2Wrap(r2, later.budget) }, back);
  assert.ok(r2.buckets[BUCKETS.data].has(old));
  assert.ok(!(old in later.ledger.retired));
});

test('nothing is sent when the export looks broken', async () => {
  const cases = [
    [folders({ files: { 'a.json': '1' }, meta: false }), /meta.json is missing/],
    [(() => { const d = folders({ files: { 'a.json': '1' } }); fs.rmSync(path.join(d.dataDir, 'a.json')); return d; })(), /names a.json, which isn't in data/],
    [(() => { const d = folders({ files: { 'a.json': '1' } }); fs.writeFileSync(path.join(d.dataDir, 'a.json'), 'edited'); return d; })(), /doesn't match its hash/],
  ];
  for (const [dirs, error] of cases) {
    const ctx = context(dirs);
    const r2 = fakeR2(ctx.budget);
    await assert.rejects(upload({ ...ctx, client: r2 }, dirs), error);
    assert.deepEqual(r2.log, []);
  }
});

test('a failed upload stops before meta.json, so the site keeps the previous manifest', async () => {
  const before = { 'a.json': '1' };
  const after = { 'a.json': '1', 'b.json': '2' };
  const dirs = folders({ files: after });
  const ctx = context(dirs);
  const r2 = fakeR2(ctx.budget, { [BUCKETS.data]: { ...remoteFor(before), 'meta.json': metaFor(before) } });
  const put = r2.put;
  r2.put = async (bk, k, ...rest) => { if (k.startsWith('b.')) throw new Error('R2 put: 500'); return put(bk, k, ...rest); };
  await assert.rejects(upload({ ...ctx, client: r2 }, dirs), /500/);
  assert.equal(String(r2.buckets[BUCKETS.data].get('meta.json').body), metaFor(before));
});

test('the caps: a run that would pass the monthly, daily or storage cap sends nothing at all', async () => {
  const files = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p/${i}.json`, String(i)]));
  const cases = [
    [{ a: LIMITS.classAMonth - 10, dayA: 0 }, /Class A operations this month/],
    [{ a: 0, dayA: LIMITS.classADay - 10 }, /Class A operations today/],
  ];
  for (const [usage, error] of cases) {
    const dirs = folders({ files, state: { 'r2.json': JSON.stringify({ usage: { ...freshUsage(undefined, NOW), ...usage } }) } });
    const ctx = context(dirs);
    const r2 = fakeR2(ctx.budget);
    await assert.rejects(upload({ ...ctx, client: r2 }, dirs), err => err instanceof BudgetError && error.test(err.message) && /SAFETY CAP/.test(err.message));
    assert.deepEqual(r2.log, [], 'not a single write');
  }
  // Per run: more files than any export makes.
  {
    const many = Object.fromEntries(Array.from({ length: LIMITS.uploadsPerRun + 1 }, (_, i) => [`m/${i}.json`, String(i)]));
    const dirs = folders({ files: many });
    const ctx = context(dirs);
    const r2 = fakeR2(ctx.budget);
    await assert.rejects(upload({ ...ctx, client: r2 }, dirs), new RegExp(`would upload ${LIMITS.uploadsPerRun + 1} files, over the per-run cap of ${LIMITS.uploadsPerRun}`));
    assert.deepEqual(r2.log, []);
  }
  // Storage: a bucket already near the cap takes no more.
  const dirs = folders({ files });
  const ctx = context(dirs);
  const r2 = fakeR2(ctx.budget);
  const list = r2.list;
  r2.list = async bk => [...await list(bk), { key: 'huge.json', etag: 'x', size: LIMITS.storageBytes, modified: NOW }];
  await assert.rejects(upload({ ...ctx, client: r2 }, dirs), /would hold .* GiB, over the cap/);
  assert.deepEqual(r2.log, []);
});

test('budget: counts and rolls over by UTC month and day', () => {
  const b = budget(freshUsage(undefined, NOW), { classAMonth: 3, classADay: 2, classBMonth: 1, storageBytes: 10 });
  b.spend('A'); b.spend('A'); b.spend(null); b.spend('B');
  assert.throws(() => b.spend('A'), /today/);
  assert.throws(() => b.spend('B'), /Class B/);
  assert.deepEqual({ a: b.usage.a, dayA: b.usage.dayA, b: b.usage.b }, { a: 2, dayA: 2, b: 1 });
  const nextDay = freshUsage(b.usage, NOW + 24 * HOUR);
  assert.deepEqual({ a: nextDay.a, dayA: nextDay.dayA, b: nextDay.b }, { a: 2, dayA: 0, b: 1 });
  const nextMonth = freshUsage(b.usage, Date.parse('2026-11-01T00:00:00Z'));
  assert.deepEqual({ a: nextMonth.a, dayA: nextMonth.dayA, b: nextMonth.b, month: nextMonth.month }, { a: 0, dayA: 0, b: 0, month: '2026-11' });
  assert.equal(operationClass('GET', { 'list-type': '2' }), 'A');
  assert.equal(operationClass('PUT'), 'A');
  assert.equal(operationClass('GET'), 'B');
  assert.equal(operationClass('DELETE'), null);
});

test('restore fills an empty checkout from R2: plain file names, meta.json last, the ledger carried over', async () => {
  const files = { 'history.json': '{"series":{}}', 'players/1.json': '{}' };
  const savedLedger = { usage: { ...freshUsage(undefined, NOW), a: 1234, dayA: 34, b: 5 }, retired: { 'x.json': NOW } };
  const dirs = folders({ files: {}, meta: false, state: { 'beatmaps.json': '{"local":true}' } });
  const ctx = context(dirs);
  const r2 = fakeR2(ctx.budget, {
    [BUCKETS.data]: { ...remoteFor(files), 'meta.json': metaFor(files) },
    [BUCKETS.state]: { 'state.json': '{"from":"r2"}', 'beatmaps.json': '{"from":"r2"}', 'r2.json': JSON.stringify(savedLedger) },
  });
  await restore({ ...ctx, client: r2 }, dirs);
  assert.equal(fs.readFileSync(path.join(dirs.dataDir, 'history.json'), 'utf8'), '{"series":{}}');
  assert.equal(fs.readFileSync(path.join(dirs.dataDir, 'players', '1.json'), 'utf8'), '{}');
  assert.equal(fs.readFileSync(path.join(dirs.dataDir, 'meta.json'), 'utf8'), metaFor(files));
  assert.equal(fs.readFileSync(path.join(dirs.stateDir, 'state.json'), 'utf8'), '{"from":"r2"}');
  assert.equal(fs.readFileSync(path.join(dirs.stateDir, 'beatmaps.json'), 'utf8'), '{"local":true}');
  assert.equal(ctx.ledger.usage.a, 1234);
  assert.ok(ctx.ledger.usage.b >= 5 + 4, 'the saved reads plus this restore\'s');
  assert.deepEqual(Object.keys(ctx.ledger.retired), ['x.json']);
});

test('caching headers', () => {
  assert.equal(cacheControl('meta.json'), 'public, max-age=0, s-maxage=60');
  assert.equal(cacheControl('players/1.YqdZgQh-qv.json'), 'public, max-age=31536000, immutable');
  assert.equal(cacheControl('avatars/1-64.YqdZgQh-qv.webp'), 'public, max-age=31536000, immutable');
});

test('avatar thumbnails go up as WebP images, byte for byte', async () => {
  const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0xff, 0x00, 0x80, 0x57, 0x45, 0x42, 0x50]); // not valid UTF-8
  const files = { 'players.json': '[1]', 'avatars/1-64.webp': webp };
  const dirs = folders({ files });
  const ctx = context(dirs);
  const r2 = fakeR2(ctx.budget);
  await upload({ ...ctx, client: r2 }, dirs);
  const thumb = r2.buckets[BUCKETS.data].get(hashedName('avatars/1-64.webp', hash(webp)));
  assert.equal(thumb.headers['Content-Type'], 'image/webp');
  assert.equal(thumb.headers['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.ok(Buffer.from(thumb.body).equals(webp));
  assert.equal(r2.buckets[BUCKETS.data].get(hashedName('players.json', hash('[1]'))).headers['Content-Type'], 'application/json; charset=utf-8');
});
