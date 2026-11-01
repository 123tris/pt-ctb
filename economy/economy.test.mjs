// Tests for the Bananas endpoints (economy/api.js through functions/api/*) against a real SQLite database behind the
// D1 stand-in (tools/lib/d1-sqlite.mjs), with the site's data and osu! faked (global fetch is swapped out). Run: npm test

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from '../tools/lib/d1-sqlite.mjs';
import { onRequestGet as dailyRoute } from '../functions/api/daily/index.js';
import { onRequestPost as guessRoute } from '../functions/api/daily/guess.js';
import { onRequestGet as coverRoute } from '../functions/api/daily/cover.js';
import { onRequestPost as requestRoute } from '../functions/api/wallet/request.js';
import { onRequestGet as requestsRoute } from '../functions/api/wallet/requests.js';
import { onRequestGet as inboxRoute } from '../functions/api/economy/inbox.js';
import { onRequestPost as ackRoute } from '../functions/api/economy/ack.js';
import { onRequestGet as callbackRoute } from '../functions/auth/callback.js';
import { daily, dailyGuess, walletRequest } from './api.js';
import { pickRound } from './daily.js';
import { makeSession } from '../signin/session.js';
import { PENDING_CAP, lisbonDay } from './store.js';

const SECRET = 'shh-secret';
const KEY = 'inbox-key-0123456789';
const BASE = 'https://ptcatch.com';
// 40 sets with distinct titles; set ids 9000+i, mappers named after them, so a leak is easy to spot.
const SETS = Array.from({ length: 40 }, (_, i) => [9000 + i, `Artist ${i}`, `Title ${i}`, `Mapper${9000 + i}`, 50 - i]);
let quizSets = SETS;
let fetched;

beforeEach(() => {
  fetched = [];
  quizSets = SETS;
  globalThis.fetch = async input => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith('/meta.json')) return Response.json({ files: { 'quiz.json': 'AbCdEfGhIj' } });
    if (url.endsWith('/quiz.AbCdEfGhIj.json')) return Response.json({ sets: quizSets });
    if (url.startsWith('https://assets.ppy.sh/')) return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'Content-Type': 'image/jpeg' } });
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'tok' });
    if (url.endsWith('/api/v2/me')) return Response.json({ id: 4158549, username: 'Tristan' });
    return new Response(null, { status: 204 });
  };
});

const envWith = (extra = {}) => ({ ECONOMY: sqliteD1(), OSU_CLIENT_ID: '123', OSU_CLIENT_SECRET: SECRET, DAILY_SEED: 'seed-1', ECONOMY_INBOX_KEY: KEY, DATA_URL: 'https://data.example/', ...extra });
const tokenFor = id => makeSession(SECRET, id);
const call = async (route, path, { method = 'GET', token, body, auth } = {}, env) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (auth) headers.Authorization = auth;
  const request = new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await route({ request, env });
  return { status: res.status, res, body: res.headers.get('Content-Type')?.startsWith('application/json') ? await res.json() : null };
};
const guessAt = (env, token, i) => call(guessRoute, '/api/daily/guess', { method: 'POST', token, body: { guess: i } }, env);
const bot = `Bearer ${KEY}`;

// ---- The daily game -----------------------------------------------------------------------------------------------

test('the daily game needs a sign-in, and a set-up site', async () => {
  const env = envWith();
  assert.equal((await call(dailyRoute, '/api/daily', {}, env)).status, 401);
  assert.equal((await call(dailyRoute, '/api/daily', { token: 'nope' }, env)).status, 401);
  const forged = await makeSession('another secret', 1);
  assert.equal((await guessAt(env, forged, 0)).status, 401);
  assert.equal((await call(dailyRoute, '/api/daily', { token: await tokenFor(1) }, envWith({ ECONOMY: undefined }))).status, 503);
  assert.equal((await call(dailyRoute, '/api/daily', { token: await tokenFor(1) }, envWith({ DAILY_SEED: undefined }))).status, 503);
});

test('the answer never reaches the browser before the game is over', async () => {
  const env = envWith();
  const token = await tokenFor(1);
  const round = await pickRound('seed-1', lisbonDay(Date.now() / 1000), SETS);
  const [setId, , , mapper] = round.options[round.answer];
  const leaks = text => text.includes(String(setId)) || text.includes(mapper) || /"answer"/.test(text);

  const first = await call(dailyRoute, '/api/daily', { token }, env);
  assert.equal(first.status, 200);
  assert.equal(first.body.options.length, 6);
  assert.equal(first.body.triesLeft, 3);
  assert.ok(!leaks(JSON.stringify(first.body)), JSON.stringify(first.body));
  assert.match(first.body.cover, /^\/api\/daily\/cover\?day=\d{4}-\d\d-\d\d$/);

  const wrong = [0, 1, 2, 3, 4, 5].filter(i => i !== round.answer);
  const afterOne = await guessAt(env, token, wrong[0]);
  assert.equal(afterOne.status, 200);
  assert.deepEqual([afterOne.body.tries, afterOne.body.solved, afterOne.body.done], [1, false, false]);
  assert.ok(!leaks(JSON.stringify(afterOne.body)));
  const afterTwo = await guessAt(env, token, wrong[1]);
  assert.ok(!leaks(JSON.stringify(afterTwo.body)));

  // The cover comes through the site: its address and headers name no map.
  const cover = await coverRoute({ request: new Request(BASE + first.body.cover), env });
  assert.equal(cover.status, 200);
  assert.equal(cover.headers.get('Content-Type'), 'image/jpeg');
  assert.ok(![...cover.headers].some(([, v]) => v.includes(String(setId))));
  assert.ok(fetched.includes(`https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg`));

  const last = await guessAt(env, token, wrong[2]);
  assert.deepEqual([last.body.tries, last.body.solved, last.body.done], [3, false, true]);
  assert.deepEqual(last.body.answer, { index: round.answer, setId, artist: round.options[round.answer][1], title: round.options[round.answer][2], mapper });
});

test('one game per osu! id per day: a fourth guess, a guess after solving and a repeated option are refused', async () => {
  const env = envWith();
  const token = await tokenFor(2);
  const round = await pickRound('seed-1', lisbonDay(Date.now() / 1000), SETS);
  const wrong = (round.answer + 1) % 6;
  assert.equal((await guessAt(env, token, wrong)).status, 200);
  const again = await guessAt(env, token, wrong);
  assert.equal(again.status, 409);
  assert.equal(again.body.tries, 1, 'a repeat costs nothing');
  const solved = await guessAt(env, token, round.answer);
  assert.deepEqual([solved.body.tries, solved.body.solved, solved.body.done], [2, true, true]);
  const late = await guessAt(env, token, (round.answer + 2) % 6);
  assert.equal(late.status, 409);
  assert.equal(late.body.tries, 2);
  assert.equal((await guessAt(env, token, 6)).status, 400);
  assert.equal((await guessAt(env, token, '1')).status, 400);
  // A sign-in on another device is the same player and the same game.
  const other = await call(dailyRoute, '/api/daily', { token: await makeSession(SECRET, 2, Math.floor(Date.now() / 1000) - 100) }, env);
  assert.equal(other.body.done, true);
  assert.equal(env.ECONOMY.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_game').get().n, 1);
});

test('the next Lisbon day is a new game, and a day’s round stays put when the pool changes', async () => {
  const env = envWith();
  const token = await tokenFor(3);
  const day1 = Date.parse('2026-11-01T22:00:00Z') / 1000; // 22:00 in Lisbon (WET), still the 1st
  const day2 = Date.parse('2026-11-02T00:30:00Z') / 1000;
  const viewOf = async t => (await daily(new Request(`${BASE}/api/daily`, { headers: { Authorization: `Bearer ${token}` } }), env, t)).json();
  const before = await viewOf(day1);
  quizSets = [...SETS].reverse();
  assert.deepEqual((await viewOf(day1)).options, before.options);
  const r = await dailyGuess(new Request(`${BASE}/api/daily/guess`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{"guess":0}' }), env, day1);
  assert.equal(r.status, 200);
  const next = await viewOf(day2);
  assert.equal(next.day, '2026-11-02');
  assert.equal(next.tries, 0);
});

test('the round comes from the secret seed: other seeds pick other maps, and wrong options never share its title', async () => {
  const day = '2026-11-05';
  const answers = new Set();
  for (let i = 0; i < 8; i++) {
    const round = await pickRound(`seed-${i}`, day, SETS);
    answers.add(round.options[round.answer][0]);
    const title = round.options[round.answer][2];
    assert.equal(round.options.filter(o => o[2] === title).length, 1);
    assert.equal(new Set(round.options.map(o => o[0])).size, 6);
  }
  assert.ok(answers.size >= 4, 'different seeds, different maps');
  assert.deepEqual(await pickRound('seed-0', day, SETS), await pickRound('seed-0', day, SETS));
});

// ---- Spending requests --------------------------------------------------------------------------------------------

test('requests: the shape is checked and rebuilt, then queued for the bot and listed for the player', async () => {
  const env = envWith();
  const token = await tokenFor(10);
  const send = body => call(requestRoute, '/api/wallet/request', { method: 'POST', token, body }, env);
  assert.equal((await call(requestRoute, '/api/wallet/request', { method: 'POST', body: { type: 'shield', payload: { on: true } } }, env)).status, 401);
  for (const bad of [
    { type: 'steal', payload: {} },
    { type: 'tip', payload: { to: 10, amount: 5 } }, // yourself
    { type: 'tip', payload: { to: 11, amount: -5 } },
    { type: 'bounty.create', payload: { map: 1, goal: 'fc', stake: 500, mods: null, days: 45 } },
    { type: 'bounty.create', payload: { map: 1, goal: 'fc', stake: 500, mods: 'EZ', days: 60 } },
    { type: 'bounty.create', payload: { map: 1, goal: 'fc', stake: 500, mods: 'DTNC', days: 60 } },
    { type: 'bounty.fund', payload: { bountyId: 3 } },
    { type: 'shop.buy', payload: { item: 'supporter' } },
    { type: 'shield', payload: { on: 'yes' } },
  ]) assert.equal((await send(bad)).status, 400, JSON.stringify(bad));

  const posted = await send({ type: 'bounty.create', payload: { map: 1234, goal: 'fc', stake: 600, mods: 'HDHR', days: 60, extra: 'dropped' } });
  assert.equal(posted.status, 202);
  assert.match(posted.body.requestId, /^[0-9a-f]{24}$/);
  await send({ type: 'tip', payload: { to: 11, amount: 20, reason: '  nice <b>FC</b>\n' } });
  const list = await call(requestsRoute, '/api/wallet/requests', { token }, env);
  assert.equal(list.body.requests.length, 2);
  assert.deepEqual(list.body.requests[1].payload, { map: 1234, goal: 'fc', stake: 600, mods: 'HDHR', days: 60 });
  assert.deepEqual(list.body.requests[0].payload, { to: 11, amount: 20, reason: 'nice bFC/b' });
  assert.equal(list.body.requests[0].status, 'pending');
  // Someone else's list is their own.
  assert.equal((await call(requestsRoute, '/api/wallet/requests', { token: await tokenFor(11) }, env)).body.requests.length, 0);
});

test(`requests: at most ${PENDING_CAP} waiting at once`, async () => {
  const env = envWith();
  const token = await tokenFor(12);
  for (let i = 0; i < PENDING_CAP; i++) assert.equal((await call(requestRoute, '/api/wallet/request', { method: 'POST', token, body: { type: 'shield', payload: { on: i % 2 === 0 } } }, env)).status, 202);
  const over = await call(requestRoute, '/api/wallet/request', { method: 'POST', token, body: { type: 'shield', payload: { on: true } } }, env);
  assert.equal(over.status, 429);
  assert.match(over.body.error, /waiting/);
});

// ---- The inbox ----------------------------------------------------------------------------------------------------

test('the inbox and the ack need the bot’s key', async () => {
  const env = envWith();
  assert.equal((await call(inboxRoute, '/api/economy/inbox', {}, env)).status, 401);
  assert.equal((await call(inboxRoute, '/api/economy/inbox', { token: await tokenFor(1) }, env)).status, 401, 'a player’s session is not the key');
  assert.equal((await call(inboxRoute, '/api/economy/inbox', { auth: `Bearer ${KEY}x` }, env)).status, 401);
  assert.equal((await call(inboxRoute, '/api/economy/inbox', { auth: bot }, envWith({ ECONOMY_INBOX_KEY: undefined }))).status, 401, 'no key set: nobody');
  assert.equal((await call(ackRoute, '/api/economy/ack', { method: 'POST', body: { cursor: '0.0.0', results: [] } }, env)).status, 401);
  assert.equal((await call(inboxRoute, '/api/economy/inbox', { auth: bot }, env)).status, 200);
});

test('the inbox: the first sign-in, finished daily games and requests, after a cursor; the ack decides requests', async () => {
  const env = envWith();
  // A sign-in through /auth/callback is noted, and hands back a session token.
  const res = await callbackRoute({ request: new Request(`${BASE}/auth/callback?code=c&state=p.AbCdEfGhIjKlMnOpQrStUv`), env });
  const answer = new URLSearchParams(new URL(res.headers.get('Location')).hash.slice('#signin?'.length));
  assert.match(answer.get('token'), /^4158549\.\d+\./);
  await callbackRoute({ request: new Request(`${BASE}/auth/callback?code=c&state=p.AbCdEfGhIjKlMnOpQrStUv`), env }); // again: no new event
  const token = answer.get('token');

  const round = await pickRound('seed-1', lisbonDay(Date.now() / 1000), SETS);
  await guessAt(env, token, round.answer);
  const req = (await call(requestRoute, '/api/wallet/request', { method: 'POST', token, body: { type: 'bounty.fund', payload: { bountyId: 4, amount: 50 } } }, env)).body.requestId;
  await guessAt(env, await tokenFor(77), (round.answer + 1) % 6); // unfinished: not in the inbox yet

  const pull = await call(inboxRoute, '/api/economy/inbox', { auth: bot }, env);
  assert.equal(pull.status, 200);
  const day = lisbonDay(Date.now() / 1000);
  assert.deepEqual(pull.body.events.map(({ t, ...e }) => e), [
    { id: 's1', kind: 'signin', osuId: 4158549, data: {} },
    { id: 'd1', kind: 'daily', osuId: 4158549, data: { day, tries: 1, solved: true } },
    { id: 'r1', kind: 'request', osuId: 4158549, data: { requestId: req, type: 'bounty.fund', payload: { bountyId: 4, amount: 50 } } },
  ]);
  assert.match(pull.body.events[0].t, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(pull.body.cursor, '1.1.1');

  // Nothing new after the cursor; the same events again until it's acked.
  assert.deepEqual((await call(inboxRoute, '/api/economy/inbox?since=1.1.1', { auth: bot }, env)).body, { cursor: '1.1.1', events: [] });
  assert.equal((await call(inboxRoute, '/api/economy/inbox', { auth: bot }, env)).body.events.length, 3);
  assert.equal((await call(inboxRoute, '/api/economy/inbox?since=nope', { auth: bot }, env)).status, 400);

  const acked = await call(ackRoute, '/api/economy/ack', { method: 'POST', auth: bot, body: { cursor: '1.1.1', results: [{ requestId: req, status: 'rejected', reason: 'not enough bananas' }, { requestId: 'f'.repeat(24), status: 'accepted' }] } }, env);
  assert.deepEqual(acked.body, { ok: true, updated: 1 });
  assert.equal((await call(inboxRoute, '/api/economy/inbox', { auth: bot }, env)).body.events.length, 0, 'acked: the default since moves on');
  const mine = (await call(requestsRoute, '/api/wallet/requests', { token }, env)).body.requests[0];
  assert.deepEqual([mine.status, mine.reason], ['rejected', 'not enough bananas']);
  // A decided request stays decided.
  await call(ackRoute, '/api/economy/ack', { method: 'POST', auth: bot, body: { cursor: '1.1.1', results: [{ requestId: req, status: 'accepted', reason: null }] } }, env);
  assert.equal((await call(requestsRoute, '/api/wallet/requests', { token }, env)).body.requests[0].status, 'rejected');
  assert.equal((await call(ackRoute, '/api/economy/ack', { method: 'POST', auth: bot, body: { cursor: 'x', results: [] } }, env)).status, 400);
});

test('sign-in still works where the economy isn’t set up', async () => {
  const env = envWith({ ECONOMY: undefined });
  const res = await callbackRoute({ request: new Request(`${BASE}/auth/callback?code=c&state=p.AbCdEfGhIjKlMnOpQrStUv`), env });
  assert.ok(new URL(res.headers.get('Location')).hash.includes('token='));
  assert.equal((await walletRequest(new Request(`${BASE}/api/wallet/request`, { method: 'POST', body: '{}' }), env)).status, 503);
});
