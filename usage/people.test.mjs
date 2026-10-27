// Tests for the per-visitor usage counts (usage/store.js version 2) and the dashboard's people, health and person
// views (usage/insights.js), against the same SQLite stand-in for D1 as usage.test.mjs. Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { recordHit, SOURCE_DAILY_CAP, DAILY_WRITE_CAP, ensureSchema, agentOf } from './store.js';
import { stats } from './dashboard.js';
import { funnels } from './insights.js';
import { makeProof } from '../signin/proof.js';

globalThis.fetch = async () => { throw new Error('offline'); }; // the dashboard's player names come from R2

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
  return { sqlite, prepare: sql => statement(sql), batch: async stmts => stmts.map(s => s.exec()) };
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0';
const post = (body, { ip = '1.2.3.4', ua = UA } = {}) => Object.assign(new Request('https://ptcatch.com/api/hit', {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', origin: 'https://ptcatch.com', 'cf-connecting-ip': ip, 'user-agent': ua },
}), { cf: { country: 'PT' } });
const DAY = Date.parse('2026-10-25T12:00:00Z');
const VID = '0123456789abcdef', SID = 'a1b2c3d4e5f6';
const v2 = (extra, ...e) => ({ id: VID, s: SID, d: 'desktop', e, ...extra });
const all = (db, sql, ...args) => db.sqlite.prepare(sql).all(...args).map(r => ({ ...r }));
const one = (db, sql, ...args) => ({ ...db.sqlite.prepare(sql).get(...args) });
const reason = async (db, body, t = DAY, opts) => (await recordHit(post(body, opts), { USAGE: db }, t)).headers.get('x-usage');
const basic = pw => `Basic ${btoa(`tris:${pw}`)}`;
const get = path => new Request(`https://ptcatch.com${path}`, { headers: { authorization: basic('pw') } });

test('a visitor id, session and chosen player are stored with each event, plus one session row and one visitor row', async () => {
  const db = fakeD1();
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605 Version/18.0 Mobile/15E148 Safari/604.1';
  assert.equal(await reason(db, v2({ f: 1, p: 4158549, w: 'claim', pn: 'Tristan', c: { vw: 390, vh: 840, sc: 'dark', ln: 'pt-PT' } },
    ['view', 'home', 'direct', 'discord.com', 120], ['view', 'player', 'page', '', 300, 'p123'], ['dwell', 'player', '', '', 5400, 'p123']), DAY, { ua }), 'ok:3');
  const [home, player, dwell] = all(db, 'SELECT * FROM events ORDER BY rowid');
  assert.deepEqual([home.visitor, home.sid, home.player, home.val, player.obj, dwell.val], [VID, SID, 4158549, 120, 'p123', 5400]);
  assert.deepEqual(one(db, 'SELECT * FROM sessions'), {
    sid: SID, env: 'prod', visitor: VID, day: '2026-10-25', start: DAY / 1000, last: DAY / 1000, batches: 1, events: 3, views: 2,
    entry: 'home', exit: 'player', ref: 'discord.com', player: 4158549, who: 'claimed', returned: 0,
    device: 'desktop', browser: 'Safari', os: 'iOS', country: 'PT', vw: 390, vh: 840, scheme: 'dark', lang: 'pt-PT',
  });
  // Later in the same session, then a new session the next day: the visitor is now a returning one.
  await reason(db, v2({}, ['view', 'compare/pair', 'page', '', 80, 'p123|p456']), DAY + 60000, { ua });
  await reason(db, { ...v2({ f: 1 }, ['view', 'home']), s: 'ffffffffffff' }, DAY + 86400000, { ua });
  assert.deepEqual(one(db, 'SELECT batches, exit, last FROM sessions WHERE sid = ?', SID), { batches: 2, exit: 'compare/pair', last: DAY / 1000 + 60 });
  assert.equal(one(db, 'SELECT returned FROM sessions WHERE sid = ?', 'ffffffffffff').returned, 1);
  const v = one(db, 'SELECT days, sessions, events, player, who, name FROM visitors');
  assert.deepEqual(v, { days: 2, sessions: 2, events: 5, player: 4158549, who: 'claimed', name: 'Tristan' });
  const everything = JSON.stringify([all(db, 'SELECT * FROM events'), all(db, 'SELECT * FROM sessions'), all(db, 'SELECT * FROM visitors')]);
  assert.ok(!everything.includes('1.2.3.4') && !everything.includes('iPhone OS'), 'no IP or user agent anywhere');
});

test('an osu! sign-in is "verified" only when its proof checks out with the app secret', async () => {
  const db = fakeD1();
  const who = async (extra, sid, env = { USAGE: db, OSU_CLIENT_SECRET: 'shh' }) => {
    await recordHit(post({ ...v2({ p: 77, ...extra }, ['view', 'home']), s: sid }), env, DAY);
    return one(db, 'SELECT who FROM sessions WHERE sid = ?', sid).who;
  };
  assert.equal(await who({ w: 'osu', pr: await makeProof('shh', 77) }, '000000000001'), 'verified');
  assert.equal(await who({ w: 'osu', pr: await makeProof('shh', 78) }, '000000000002'), 'osu');
  assert.equal(await who({ w: 'osu', pr: await makeProof('other', 77) }, '000000000003'), 'osu');
  assert.equal(await who({ w: 'claim' }, '000000000004'), 'claimed');
  assert.equal(await who({ w: 'osu', pr: await makeProof('shh', 77) }, '000000000005', { USAGE: db }), 'osu', 'no secret (dev), no check');
});

test('a session id can only be continued by the visitor that started it', async () => {
  const db = fakeD1();
  await reason(db, v2({ p: 1, w: 'claim' }, ['view', 'home']));
  await reason(db, { ...v2({ p: 2, w: 'claim' }, ['view', 'maps']), id: 'ffffffffffffffff' });
  assert.deepEqual(one(db, 'SELECT visitor, player, exit FROM sessions'), { visitor: VID, player: 1, exit: 'home' });
});

test('one source (IP) can only send SOURCE_DAILY_CAP events a day, whatever visitor ids it makes up', async () => {
  const db = fakeD1();
  await reason(db, v2({}, ['view', 'home']));
  db.sqlite.prepare('UPDATE limits SET events = ?').run(SOURCE_DAILY_CAP - 1);
  assert.equal(await reason(db, { ...v2({}, ['view', 'a'], ['view', 'b']), id: 'eeeeeeeeeeeeeeee' }), 'ok:1');
  assert.equal(await reason(db, { ...v2({}, ['view', 'c']), id: 'dddddddddddddddd' }), 'source-cap');
  assert.equal(await reason(db, v2({}, ['view', 'd']), DAY, { ip: '5.5.5.5' }), 'ok:1', 'other sources still get in');
});

test('the estimated rows written stop a flood of tiny batches (DAILY_WRITE_CAP)', async () => {
  const db = fakeD1();
  await ensureSchema(db);
  db.sqlite.prepare('INSERT INTO quota (day, writes) VALUES (?, ?)').run('2026-10-25', DAILY_WRITE_CAP - 3);
  assert.equal(await reason(db, v2({}, ['view', 'home'])), 'write-cap');
  const fresh = fakeD1();
  await reason(fresh, v2({}, ['view', 'home'], ['click', 'home', 'go']));
  assert.equal(one(fresh, 'SELECT writes FROM quota').writes, 2 * 2 + 6);
});

test('finished days are rolled up into anonymous counts, which the 365-day overview reads', async () => {
  const db = fakeD1();
  const env = { USAGE: db, STATS_PASSWORD: 'pw' };
  await recordHit(post(v2({ p: 5, w: 'claim' }, ['view', 'home', 'direct', 'discord.com'], ['view', 'records', 'nav'], ['dwell', 'records', '', '', 4000])), env, DAY);
  await recordHit(post({ e: [['view', 'home']], d: 'phone', m: 0 }, { ip: '9.9.9.9' }), env, DAY); // an old client: daily hash
  await recordHit(post(v2({}, ['view', 'maps'])), env, DAY + 86400000); // the next day's first event rolls up the 25th
  const rolled = all(db, "SELECT kind, name, detail, n, visits, total FROM rollup WHERE day = '2026-10-25'");
  assert.deepEqual(rolled.find(r => r.kind === '_day'), { kind: '_day', name: '', detail: '', n: 3, visits: 2, total: null });
  assert.deepEqual(rolled.find(r => r.kind === '_page' && r.name === 'home'), { kind: '_page', name: 'home', detail: '', n: 2, visits: 2, total: null });
  assert.equal(rolled.find(r => r.kind === 'dwell').total, 4000);
  assert.ok(!JSON.stringify(all(db, 'SELECT * FROM rollup')).includes(VID), 'no ids in the rollup');
  const page = await (await stats(get('/stats?days=365'), env, DAY + 86400000, { names: new Map() })).text();
  assert.match(page, /anonymous daily totals/);
  assert.equal(page.match(/<b>([^<]+)<\/b><span>visits/)[1], '2');
  assert.match(page, /<td>records<\/td><td class="num">1<\/td><td class="num">1<\/td><td>.*?<\/td><td class="num">4s<\/td>/);
});

test('"delete my data" drops the visitor row at once and its events and sessions at the next daily clean-up', async () => {
  const db = fakeD1();
  await reason(db, v2({}, ['view', 'home']));
  await reason(db, { ...v2({}, ['view', 'maps']), id: 'ffffffffffffffff', s: 'ffffffffffff' });
  assert.equal(await reason(db, { forget: VID }), 'forgotten');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM visitors WHERE visitor = ?', VID).n, 0);
  await reason(db, { ...v2({}, ['view', 'home']), id: 'eeeeeeeeeeeeeeee', s: 'eeeeeeeeeeee' }, DAY + 86400000);
  assert.deepEqual(all(db, 'SELECT visitor FROM events ORDER BY visitor').map(r => r.visitor), ['eeeeeeeeeeeeeeee', 'ffffffffffffffff']);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM sessions WHERE visitor = ?', VID).n, 0);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM forget').n, 0);
  assert.equal(await reason(db, { forget: 'nope' }), 'invalid');
});

test('the people, health and person views show players, funnels, errors and timings', async () => {
  const db = fakeD1();
  const env = { USAGE: db, STATS_PASSWORD: 'pw' };
  await recordHit(post(v2({ f: 1, p: 4158549, w: 'claim', pn: 'Tristan', c: { vw: 1920, vh: 1080, sc: 'dark', ln: 'en-GB' } },
    ['view', 'home', 'direct', '', 200], ['view', 'player', 'page', '', 900, 'p123'], ['view', 'compare/pair', 'page', '', 1500, 'p123|p456'],
    ['search', 'header', 'picked a player · text 3-5'], ['err', 'x is not a function', 'player.js:#'], ['perf', 'ttfb', 'home', '', 180],
    ['fetch', 'players/#.json', 'player', '', 1300])), env, DAY);
  await recordHit(post({ ...v2({ f: 1 }, ['view', 'home'], ['view', 'maps']), id: 'ffffffffffffffff', s: 'ffffffffffff' }, { ip: '8.8.8.8' }), env, DAY);
  const names = new Map([[123, 'Pinguim']]);
  const view = async path => { const res = await stats(get(path), env, DAY, { names }); assert.equal(res.status, 200, path); return res.text(); };
  const people = await view('/stats?view=people&days=7');
  assert.match(people, /Tristan<\/a> <span class="tag"[^>]*>claimed/);
  assert.match(people, /Pinguim/);
  assert.match(people, /Home → a profile → Compare<\/td><td class="small">home: <b>2<\/b><\/td><td class="small">player: <b>1<\/b> <span class="muted">50%/);
  assert.match(people, /visitor=ffffffffffffffff/);
  const health = await view('/stats?view=health&days=7');
  assert.match(health, /x is not a function/);
  assert.match(health, /Chrome Windows/);
  assert.match(health, /players\/#\.json/);
  assert.match(health, /1440 and up/);
  const person = await view('/stats?player=4158549&days=7');
  assert.match(person, /Tristan/);
  assert.match(person, /compare\/pair/);
  assert.match(person, /picked a player/);
  assert.match(await view('/stats?visitor=ffffffffffffffff'), /Visitor ffffffff/);
});

test('funnels count sessions that go through the steps in order', () => {
  const [home] = funnels(new Map([['a', ['home', 'player', 'maps', 'compare/one']], ['b', ['player', 'home']], ['c', ['home']]]));
  assert.deepEqual(home.reached, [3, 1, 1]);
});

test('browser family and system come from the user agent, which is then dropped', () => {
  assert.deepEqual(agentOf(UA), { browser: 'Chrome', os: 'Windows' });
  assert.deepEqual(agentOf('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 EdgA/130.0'), { browser: 'Edge', os: 'Android' });
  assert.deepEqual(agentOf('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'), { browser: 'Firefox', os: 'Linux' });
});
