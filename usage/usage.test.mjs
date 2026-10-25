// Tests for the usage counts (usage/store.js) and the owner's dashboard (usage/dashboard.js), against a real SQLite
// database behind a small stand-in for Cloudflare D1's API. Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequestPost as hit } from '../functions/api/hit.js';
import { onRequestGet as statsRoute } from '../functions/stats.js';
import { recordHit, parseBatch, KEEP_DAYS } from './store.js';
import { stats } from './dashboard.js';

/** Just enough of D1 (prepare/bind/first/all/run/batch) over node:sqlite. */
function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const statement = (sql, args = []) => ({
    sql,
    bind: (...next) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => { sqlite.prepare(sql).run(...args); return { success: true }; },
    exec: () => (/^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...args) } : (sqlite.prepare(sql).run(...args), { results: [] })),
  });
  return {
    sqlite,
    prepare: sql => statement(sql),
    batch: async stmts => stmts.map(s => s.exec()),
  };
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0';
const post = (body, { origin = 'https://ptcatch.com', ip = '1.2.3.4', ua = UA, host = 'https://ptcatch.com' } = {}) =>
  Object.assign(new Request(`${host}/api/hit`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin, 'cf-connecting-ip': ip, 'user-agent': ua },
  }), { cf: { country: 'PT' } });

const batch = (...e) => ({ e, d: 'phone', m: 1 });
const DAY = Date.parse('2026-10-25T12:00:00Z');
const rows = db => { try { return db.sqlite.prepare('SELECT * FROM events ORDER BY rowid').all(); } catch { return []; } }; // no table until the first valid batch

test('a batch is stored with a daily visitor hash and no IP or user agent', async () => {
  const db = fakeD1();
  const res = await recordHit(post(batch(['view', 'player/loved', 'search', 'discord.com'], ['click', 'player/loved', 'this is me'])), { USAGE: db }, DAY);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('x-usage'), 'ok:2');
  const [view, click] = rows(db);
  assert.deepEqual({ ...view, visitor: typeof view.visitor }, {
    ts: DAY / 1000, day: '2026-10-25', env: 'prod', visitor: 'string', kind: 'view', name: 'player/loved', detail: 'search',
    device: 'phone', country: 'PT', ref: 'discord.com', me: 1,
  });
  assert.match(view.visitor, /^[0-9a-f]{16}$/);
  assert.equal(click.visitor, view.visitor);
  const everything = JSON.stringify(db.sqlite.prepare('SELECT * FROM events').all());
  assert.ok(!everything.includes('1.2.3.4') && !everything.includes('Chrome'));
});

test('the hash is stable within a day, differs between visitors, and changes the next day (old salt deleted)', async () => {
  const db = fakeD1();
  const env = { USAGE: db };
  await recordHit(post(batch(['view', 'home'])), env, DAY);
  await recordHit(post(batch(['view', 'maps'])), env, DAY + 3600000);
  await recordHit(post(batch(['view', 'home']), { ip: '5.6.7.8' }), env, DAY);
  await recordHit(post(batch(['view', 'home'])), env, DAY + 86400000);
  const [a, b, other, tomorrow] = rows(db).map(r => r.visitor);
  assert.equal(a, b);
  assert.notEqual(a, other);
  assert.notEqual(a, tomorrow);
  assert.deepEqual(db.sqlite.prepare('SELECT day FROM salts').all().map(r => r.day), ['2026-10-26']);
});

test('requests from other sites, bots, junk and oversized batches are ignored', async () => {
  const db = fakeD1();
  const env = { USAGE: db };
  const reason = async req => (await recordHit(req, env, DAY)).headers.get('x-usage');
  assert.equal(await reason(post(batch(['view', 'home']), { origin: 'https://evil.example' })), 'foreign-origin');
  assert.equal(await reason(post(batch(['view', 'home']), { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' })), 'bot');
  assert.equal(await reason(post('not json')), 'invalid');
  assert.equal(await reason(post({ e: Array(51).fill(['view', 'home']) })), 'invalid');
  assert.equal(await reason(post(batch(['hack', 'home'], ['view', '']))), 'invalid');
  assert.equal(rows(db).length, 0);
  assert.equal((await recordHit(post(batch(['view', 'home'])), {}, DAY)).headers.get('x-usage'), 'no-database');
});

test('labels are cleaned: no markup, emoji or control characters, 60 characters at most', () => {
  const [r] = parseBatch(batch(['click', 'games', `<img src=x onerror=alert(1)> 🍎 Copy\u0007 result ${'x'.repeat(80)}`]));
  assert.ok(!/[<>=🍎\u0007]/u.test(r.detail));
  assert.ok(r.detail.startsWith('img srcx onerroralert(1) Copy result'));
  assert.equal(r.detail.length, 60);
  assert.equal(parseBatch(batch(['view', 'home', '', 'not a host!']))[0].ref, '');
});

test('the development site and previews are kept apart from the release site', async () => {
  const db = fakeD1();
  await recordHit(post(batch(['view', 'home']), { host: 'https://dev.ptcatch.com', origin: 'https://dev.ptcatch.com' }), { USAGE: db }, DAY);
  await recordHit(post(batch(['view', 'home']), { host: 'https://abc.pt-ctb.pages.dev', origin: 'https://abc.pt-ctb.pages.dev' }), { USAGE: db }, DAY);
  assert.deepEqual(rows(db).map(r => r.env), ['dev', 'preview']);
});

test(`events older than ${KEEP_DAYS} days are deleted when a new day starts`, async () => {
  const db = fakeD1();
  await recordHit(post(batch(['view', 'home'])), { USAGE: db }, DAY - (KEEP_DAYS + 1) * 86400000);
  await recordHit(post(batch(['view', 'maps'])), { USAGE: db }, DAY);
  assert.deepEqual(rows(db).map(r => r.name), ['maps']);
});

test('the Pages Function route stores events', async () => {
  const db = fakeD1();
  const res = await hit({ request: post(batch(['view', 'home'])), env: { USAGE: db } });
  assert.equal(res.status, 204);
  assert.equal(rows(db).length, 1);
});

const basic = pw => `Basic ${btoa(`tris:${pw}`)}`;
const get = (path, auth) => new Request(`https://ptcatch.com${path}`, { headers: auth ? { authorization: auth } : {} });

test('the dashboard needs STATS_PASSWORD set, and the right password', async () => {
  const db = fakeD1();
  assert.equal((await stats(get('/stats'), { USAGE: db })).status, 503);
  const env = { USAGE: db, STATS_PASSWORD: 'correct horse' };
  const none = await stats(get('/stats'), env);
  assert.equal(none.status, 401);
  assert.match(none.headers.get('www-authenticate'), /^Basic /);
  assert.equal((await stats(get('/stats', basic('wrong')), env)).status, 401);
  assert.equal((await stats(get('/stats', 'Basic !!!'), env)).status, 401);
  assert.equal((await stats(get('/stats', basic('correct horse')), { STATS_PASSWORD: 'correct horse' })).status, 503);
  assert.equal((await statsRoute({ request: get('/stats', basic('correct horse')), env })).status, 200);
});

test('the dashboard counts visits, pages, ways in, buttons and unopened pages', async () => {
  const db = fakeD1();
  const env = { USAGE: db, STATS_PASSWORD: 'pw' };
  await recordHit(post(batch(['view', 'home', 'direct', 'discord.com'], ['view', 'records', 'nav'], ['click', 'records', 'next →'], ['use', 'records', 'search'])), env, DAY);
  await recordHit(post({ e: [['view', 'records', 'search'], ['egg', '727'], ['pref', 'me', 'on'], ['out', 'osu.ppy.sh', 'player']], d: 'desktop', m: 0 }, { ip: '9.9.9.9' }), env, DAY);
  await recordHit(post(batch(['view', 'home', 'direct'])), { USAGE: db }, DAY + 86400000); // same person, next day
  await recordHit(post(batch(['view', 'home', 'direct']), { host: 'https://dev.ptcatch.com', origin: 'https://dev.ptcatch.com' }), env, DAY);
  const res = await stats(get('/stats?days=7', basic('pw')), env, DAY + 86400000);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'nonce-[^']+'/);
  const page = await res.text();
  const tile = label => page.match(new RegExp(`<b>([^<]+)</b><span>${label}`))?.[1];
  assert.equal(tile('visits'), '3'); // two people on day one, one on day two; the dev visit isn't counted
  assert.equal(tile('page views'), '4');
  assert.equal(tile('of visits on a phone'), '67%');
  assert.match(page, /<td>records<\/td><td class="num">2<\/td><td class="num">2<\/td>/);
  assert.match(page, /Header search/);
  assert.match(page, /next →/);
  assert.match(page, /Easter egg/);
  assert.match(page, /discord\.com/);
  assert.match(page, /Not opened at all in this period: <b>[^<]*\bplayers\b/);
  const dev = await (await stats(get('/stats?site=dev', basic('pw')), env, DAY)).text();
  assert.equal(dev.match(/<b>([^<]+)<\/b><span>visits/)[1], '1');
});
