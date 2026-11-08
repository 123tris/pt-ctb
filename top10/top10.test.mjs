// Tests for the Top 10 vote (top10/*.js, through functions/api/top10/* where it matters) against a real SQLite
// database behind the D1 stand-in (tools/lib/d1-sqlite.mjs), with the site's exported data faked (global fetch is
// swapped out). Run: npm test

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from '../tools/lib/d1-sqlite.mjs';
import { makeSession } from '../signin/session.js';
import { hashedName } from '../assets/js/core/data-name.js';
import { parseRequest } from '../economy/store.js';
import { onRequestPost as walletRoute } from '../functions/api/wallet/request.js';
import { onRequestGet as inboxRoute } from '../functions/api/economy/inbox.js';
import { onRequestPost as ackRoute } from '../functions/api/economy/ack.js';
import { onRequestGet as hubRoute } from '../functions/api/top10/index.js';
import { onRequestGet as ballotGetRoute, onRequestPut as ballotPutRoute } from '../functions/api/top10/ballot/index.js';
import { onRequestPost as submitRoute } from '../functions/api/top10/ballot/submit.js';
import { onRequestDelete as playDeleteRoute } from '../functions/api/top10/plays/[id]/index.js';
import { onRequestPost as endorseRoute } from '../functions/api/top10/plays/[id]/endorse.js';
import * as api from './api.js';
import { SEASON, seasonOf, phaseOf, showcaseOf, normalizeSeason } from './season.js';
import { tokens, countWords, analyse, shingles, overlap, bananasFor } from './words.js';
import { spotPoints, spotsValid, listPoints, computeResults, payoutsFor } from './score.js';
import { forgetData, tuplesWithId, tuplesOnMap, bestOnMap, mapTuple, ptPlayers } from './data.js';
import { parseRef, refSid, scoreUrl, sidRef } from './refs.js';
import { forgetOsuToken, scoreFromApi } from './osu.js';
import { MAX_REPLAY_BYTES, attachment, modNames, parseOsr, replayFileName } from './osr.js';
import { lzmaDecode } from './lzma.js';
import { checkEdition, editionYear, namesFromAliases, pastResults, pastSql } from './past.js';
import fs from 'node:fs';

const SECRET = 'top10-secret';
const KEY = 'inbox-key-0123456789';
const BASE = 'https://ptcatch.com';
const DATA = 'https://data.example/';
const at = text => Math.floor(Date.parse(text) / 1000);
const BEFORE = at('2026-11-20T12:00:00Z');
const OPEN = at('2026-12-10T12:00:00Z');
const LAST_SECOND = at('2026-12-31T23:59:59Z');
const CLOSED = at('2027-01-01T10:00:00Z');
const REVEALED = at('2027-01-02T12:00:00Z');
const LATE = at('2027-02-01T00:00:00Z');

// ---- The fake data ------------------------------------------------------------------------------------------------

// PT players 1–20; 999 is someone from elsewhere.
const PLAYERS = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Player${i + 1}`, pp: 5000 - i }));
// A score tuple (S in assets/js/core/model.js): map, pp, acc, combo, misses, mods, grade, score, time, hits, pos, id.
const score = (map, time, id) => [map, 120.5, 99.1, 800, 1, 0, 'S', 9000000, at(time), 1200, null, ...(id === undefined ? [] : [id])];
const FILES = {
  'players.json': PLAYERS,
  // Player 2's file: a map tuple that ends with the same number as a score id comes first, and must be skipped.
  'players/2.json': {
    id: 2, name: 'Player2',
    maps: { 111: ['Artist', 'Title', 'Hard', 77, 5.1, 9, 4, 8, 6, 180, 120, 900, 1, 2, 'mapper', 1700000000, 5000000001] },
    scores: {
      c: [score(110, '2026-02-01T10:00:00Z')],
      u: [],
      r: [score(111, '2026-03-01T10:00:00Z', 5000000001), score(112, '2026-05-01T10:00:00Z', -77), score(113, '2025-12-31T23:00:00Z', 5000000002)],
    },
    top: [], dan: [],
  },
  'players/3.json': { id: 3, name: 'Player3', scores: { c: [], u: [], r: [score(121, '2026-07-01T10:00:00Z', -88)] }, top: [], dan: [], maps: {} },
  'players/4.json': { id: 4, name: 'Player4', scores: { c: [], u: [], r: Array.from({ length: 20 }, (_, i) => score(400 + i, '2026-08-01T10:00:00Z', 4000000000 + i)) }, top: [], dan: [], maps: {} },
  'activity.json': { events: [{ t: at('2026-07-01T10:00:00Z'), k: 'snipe', u: 3, v: 2, c: 'r', s: score(121, '2026-07-01T10:00:00Z', -88) }], recent: [], maps: {} },
};
let served;
let fetched;
function serve(files) {
  served = new Map();
  const meta = { generatedAt: 1, files: {} };
  Object.entries(files).forEach(([path, content], i) => {
    const hash = `h${String(i).padStart(9, '0')}`;
    meta.files[path] = hash;
    served.set(DATA + hashedName(path, hash), JSON.stringify(content));
  });
  served.set(`${DATA}meta.json`, JSON.stringify(meta));
}

// A fake osu!: the token endpoint, and API paths → a body, or a status to answer with. Every call is kept.
const OSU = 'https://osu.example';
let osuRoutes;
let osuCalls;

beforeEach(() => {
  forgetData();
  forgetOsuToken();
  delete globalThis.caches;
  serve(FILES);
  fetched = [];
  osuRoutes = {};
  osuCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    fetched.push(url);
    if (url.startsWith(OSU)) {
      const path = url.slice(OSU.length);
      osuCalls.push({ path, headers: new Headers(init.headers), body: init.body ? String(init.body) : null });
      if (path === '/oauth/token') return Response.json({ token_type: 'Bearer', expires_in: 86400, access_token: 'app-token' });
      const hit = osuRoutes[path];
      if (typeof hit === 'number') return new Response('{}', { status: hit });
      return hit ? Response.json(hit) : Response.json({ error: null }, { status: 404 });
    }
    return served.has(url) ? new Response(served.get(url), { headers: { 'Content-Type': 'application/json' } }) : new Response('not here', { status: 404 });
  };
});

// ---- Calling the endpoints ----------------------------------------------------------------------------------------

const envWith = (extra = {}) => ({ ECONOMY: sqliteD1(), OSU_CLIENT_SECRET: SECRET, ECONOMY_INBOX_KEY: KEY, DATA_URL: DATA, ADMIN_OSU_IDS: '1,2', ...extra });

/** Calls an api.js handler at `now` (signed in as `as`, with a token made then), with `id` for the :id routes. */
async function call(fn, env, { as, now = OPEN, method = 'GET', path = '/api/top10', body, id } = {}) {
  const headers = {};
  if (as) headers.Authorization = `Bearer ${await makeSession(SECRET, as, now)}`;
  const request = new Request(BASE + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const res = id === undefined ? await fn(request, env, now) : await fn(request, env, id, now);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, res };
}
const picks = (...ids) => ids.map((id, i) => ({ id, spot: i + 1 }));
const save = (env, as, body, now = OPEN) => call(api.saveBallot, env, { as, now, method: 'PUT', path: '/api/top10/ballot', body });
const submit = (env, as, now = OPEN) => call(api.submitBallot, env, { as, now, method: 'POST', path: '/api/top10/ballot/submit' });
const withdraw = (env, as, now = OPEN) => call(api.withdrawBallot, env, { as, now, method: 'POST', path: '/api/top10/ballot/withdraw' });
const feed = (env, now = OPEN) => call(api.ballots, env, { now, path: '/api/top10/ballots' });
const mine = (env, as, now = OPEN) => call(api.myBallot, env, { as, now, path: '/api/top10/ballot' });
const act = (env, as, body, now = CLOSED) => call(api.adminAction, env, { as, now, method: 'POST', path: '/api/top10/admin/action', body });
const finalize = (env, as, body, now = CLOSED) => call(api.adminFinalize, env, { as, now, method: 'POST', path: '/api/top10/admin/finalize', body });
const thank = (env, as, body, now = OPEN) => call(api.thank, env, { as, now, method: 'POST', path: '/api/top10/thanks', body });
const addPlay = (env, as, body, now = OPEN) => call(api.addPlay, env, { as, now, method: 'POST', path: '/api/top10/plays', body });

/** A text of `n` distinct words (none repeated, all with vowels), different for each `seed`. */
const VOCAB = ['catch', 'fruit', 'banana', 'plate', 'dash', 'hyper', 'stream', 'jump', 'combo', 'slider'];
const letters = n => (n < 26 ? String.fromCharCode(97 + n) : letters(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26)));
const essay = (n, seed) => Array.from({ length: n }, (_, i) => `${VOCAB[i % VOCAB.length]}${letters(i)}${letters(seed + 3)}`).join(' ');

// ---- The season ---------------------------------------------------------------------------------------------------

test('the season: the built-in 2026 dates, the phases and their edges', () => {
  const season = seasonOf({});
  assert.deepEqual({ ...season, at: undefined }, { ...SEASON, at: undefined });
  assert.equal(phaseOf(season, BEFORE), 'before');
  assert.equal(phaseOf(season, at('2026-12-01T00:00:00Z')), 'open');
  assert.equal(phaseOf(season, LAST_SECOND), 'open', '23:59:59 on the 31st still counts');
  assert.equal(phaseOf(season, LAST_SECOND + 1), 'closed');
  assert.equal(phaseOf(season, REVEALED - 1), 'closed');
  assert.equal(phaseOf(season, REVEALED), 'revealed');
});

test('TOP10_SEASON overrides the dates, for a mock season; a bad value is ignored', async () => {
  const mock = { year: 2026, opens: '2026-11-20T00:00:00Z', closes: '2026-11-26T23:59:59Z', reveal: '2026-11-28T12:00:00Z', thanksUntil: '2026-11-30T23:59:59Z' };
  const season = seasonOf({ TOP10_SEASON: JSON.stringify(mock) });
  assert.equal(season.opens, mock.opens);
  assert.equal(phaseOf(season, at('2026-11-21T00:00:00Z')), 'open');
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const bad of ['{nope', JSON.stringify({ ...mock, closes: undefined }), JSON.stringify({ ...mock, reveal: '2026-11-25T00:00:00Z' }), JSON.stringify({ ...mock, year: 'x' })]) {
      assert.equal(seasonOf({ TOP10_SEASON: bad }).opens, SEASON.opens, bad);
    }
  } finally { console.warn = warn; }
  assert.equal(normalizeSeason({ ...mock, opens: 'whenever' }), null);

  // Through the Function, with a season around the real time, as dev.ptcatch.com would run one.
  const now = Date.now();
  const around = { year: 2031, opens: new Date(now - 3600e3).toISOString(), closes: new Date(now + 3600e3).toISOString(), reveal: new Date(now + 7200e3).toISOString(), thanksUntil: new Date(now + 9000e3).toISOString() };
  const env = envWith({ TOP10_SEASON: JSON.stringify(around) });
  const res = await hubRoute({ request: new Request(`${BASE}/api/top10`), env });
  const body = await res.json();
  assert.equal(body.season.year, 2031);
  assert.equal(body.season.phase, 'open');
  assert.equal(body.turnout, 0);
  assert.equal(body.me, undefined, 'signed out: no me');
});

// ---- Words and flags ----------------------------------------------------------------------------------------------

test('words: 2+ letters, no links, emoji or bare numbers, at most 30 characters; punctuation stripped at the ends', () => {
  assert.deepEqual(tokens('  "6 miss HR" on   Uncontrollable!! '), ['6', 'miss', 'HR', 'on', 'Uncontrollable']);
  assert.equal(countWords('6 miss HR on Uncontrollable!'), 4);
  assert.equal(countWords('🔥🔥 GOAT 🍌 #1 123 1st x2 a'), 2, 'GOAT and 1st; #1, 123, x2 and "a" have under 2 letters');
  assert.equal(countWords('see https://osu.ppy.sh/scores/123 and osu.ppy.sh/b/77 or www.youtube.com/watch or youtu.be'), 4);
  assert.equal(countWords(`${'a'.repeat(30)} ${'b'.repeat(31)}`), 1);
  assert.equal(countWords("full-combo don't (really) e.g. ...!?"), 4);
  assert.equal(countWords(''), 0);
  assert.equal(countWords(null), 0);
});

test('words: Portuguese counts the same way, accents included', () => {
  const text = 'O Hiroto- teve um ano incrível: o FC no mapa mais difícil do país, e ainda subiu 3 lugares!';
  assert.equal(countWords(text), 15);
  assert.equal(countWords('Não há ninguém como ele. Fantástico, é o nº 1 — sem dúvida.'), 9);
  // Decomposed accents (e + ́) count as the composed letter.
  assert.equal(countWords('café pão'), 2);
  assert.deepEqual(analyse('Fantástico jogador, o melhor de Portugal sem dúvida nenhuma: ritmo, precisão e coração.').flags, []);
});

test('flags: repetitive needs 8+ words with under half unique', () => {
  assert.deepEqual(analyse('gg gg gg gg gg gg gg').flags, [], '7 words is too short to judge');
  assert.deepEqual(analyse('gg gg gg gg gg gg gg gg').flags, ['repetitive']);
  assert.deepEqual(analyse('Very good player, very GOOD player. Very good!').flags, ['repetitive'], 'case-folded: 8 words, 3 unique');
  assert.deepEqual(analyse('one two three four five six seven eight').flags, []);
  assert.deepEqual(analyse('muito bom jogador muito bom jogador muito bom').flags, ['repetitive']);
});

test('flags: copy is 70%+ of its 3-shingles found in another write-up', () => {
  const original = essay(20, 1);
  assert.deepEqual(analyse(`${original} plus three more`, [original]).flags, ['copy'], '18 of 21 shingles');
  assert.deepEqual(analyse(original, [essay(20, 2)]).flags, []);
  // Half copied, half new: under 70%.
  const half = `${original.split(' ').slice(0, 11).join(' ')} ${essay(10, 5)}`;
  assert.ok(overlap(shingles(half), shingles(original)) < 0.7);
  assert.deepEqual(analyse(half, [original]).flags, []);
  // Others can be passed as shingle sets; Portuguese copies are caught too.
  const pt = 'Jogou o ano inteiro a um nível incrível e conseguiu o primeiro FC português daquele mapa impossível';
  assert.deepEqual(analyse(`${pt}!`, [shingles(pt)]).flags, ['copy']);
  assert.deepEqual(analyse('too short', ['too short']).flags, [], 'no shingles under 3 words');
});

test('flags: mash is over 20% of words with no vowel and 6+ characters', () => {
  assert.deepEqual(analyse('sdfghj zxcvbn hjklmn good player').flags, ['mash']);
  assert.deepEqual(analyse('rhythm player nice combo good catch').flags, [], 'y is a vowel');
  assert.deepEqual(analyse('sdfghj is one word among many other real normal words here').flags, [], '1 of 10 is under 20%');
  assert.deepEqual(analyse('nth pls thx').flags, [], 'short words without vowels are fine');
  assert.deepEqual(analyse('gg gg gg gg gg gg gg gg sdfghj qwrtpk zxcvbn').flags, ['repetitive', 'mash']);
  // 1 banana a word, up to 40 (§9, since 2026-11-08). The bot pays it; this is the ballot page's counter.
  assert.equal(bananasFor(9), 9);
  assert.equal(bananasFor(40), 40);
  assert.equal(bananasFor(400), 40);
  assert.equal(bananasFor(0), 0);
});

// ---- Scoring ------------------------------------------------------------------------------------------------------

test('points: 10 for #1 to 1 for #10; a tie splits the positions it covers', () => {
  assert.equal(spotPoints(1), 10);
  assert.equal(spotPoints(10), 1);
  assert.equal(spotPoints(6, 2), 4.5, 'two at 6: (5 + 4) / 2');
  assert.equal(spotPoints(9, 2), 1.5, 'two at 9 cover 9 and 10');
  assert.equal(spotPoints(10, 2), 0.5, 'two at 10 cover 10 and 11, which gives 0');
  assert.equal(spotPoints(3, 3), 7);
  const list = listPoints([{ id: 7, spot: 1 }, { id: 8, spot: 2 }, { id: 9, spot: 2 }, { id: 10, spot: 4 }, { id: 11, spot: 5 }]);
  assert.deepEqual([...list].map(([id, p]) => [id, p.points]), [[7, 10], [8, 8.5], [9, 8.5], [10, 7], [11, 6]]);
  // The spots rule: start at 1, a tie repeats, the next one skips.
  assert.ok(spotsValid([]));
  assert.ok(spotsValid([1, 2, 3, 3, 5].map((spot, i) => ({ id: i + 1, spot }))));
  assert.ok(spotsValid([1, 1, 1, 4, 5, 6, 7, 8, 9, 9].map((spot, i) => ({ id: i + 1, spot }))));
  for (const bad of [[2, 3, 4, 5, 6], [1, 2, 3, 3, 4], [1, 1, 2, 4, 5], [1, 3, 4, 5, 6], [1, 2, 2, 1, 5]]) {
    assert.ok(!spotsValid(bad.map((spot, i) => ({ id: i + 1, spot }))), String(bad));
  }
});

test('results: a voter is only scored on the ballots that could list them', () => {
  // Five voters, each ranking the other four in order and then player 6.
  const ballots = [1, 2, 3, 4, 5].map(voter => ({ voter, picks: picks(...[1, 2, 3, 4, 5].filter(id => id !== voter), 6), mentions: [], watch: [] }));
  const { results } = computeResults({ year: 2026, ballots, finalizedAt: 'x' });
  const of = id => results.ranking.find(r => r.id === id);
  assert.deepEqual([of(1).points, of(1).eligible, of(1).score, of(1).lists, of(1).firsts], [40, 4, 10, 4, 4], 'a perfect 10 despite voting');
  assert.deepEqual([of(2).points, of(2).eligible, of(2).score], [37, 4, 9.25]);
  assert.deepEqual([of(6).points, of(6).eligible, of(6).score], [30, 5, 6], 'player 6 never voted: all 5 ballots count');
  assert.deepEqual(of(1).positions, [4, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([of(2).best, of(2).worst], [1, 2]);
  assert.deepEqual(results.ranking.map(r => [r.id, r.rank]), [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]]);
  assert.equal(results.ballots, 5);
});

test('results: fewer than 5 counted ballots are refused', () => {
  const ballots = [1, 2, 3, 4].map(voter => ({ voter, picks: picks(10, 11, 12, 13, 14), mentions: [], watch: [] }));
  assert.deepEqual(computeResults({ year: 2026, ballots }), { error: 'turnout', ballots: 4 });
});

test('results: tie-breaks are lists, then #1s, then the median spot, then mentions; still equal shares the rank', () => {
  // Five ballots by 101–105; fillers (900+) take the other spots so every list is a real one.
  const run = (lists, mentions = [[], [], [], [], []]) => {
    const ballots = lists.map((entries, i) => {
      const taken = new Map(entries);
      const filled = [];
      let filler = 900 + i * 20;
      for (let spot = 1; spot <= 10; spot++) filled.push(taken.has(spot) ? { id: taken.get(spot), spot } : { id: filler++, spot });
      return { voter: 101 + i, picks: filled, mentions: mentions[i], watch: [] };
    });
    const { results } = computeResults({ year: 2026, ballots });
    return id => results.ranking.find(r => r.id === id);
  };
  // Lists: X at 6 on two lists (5 + 5), Y at 1 on one (10): same score, X on more lists.
  let r = run([[[6, 'X']], [[6, 'X']], [[1, 'Y']], [], []]);
  assert.equal(r('X').score, r('Y').score);
  assert.ok(r('X').rank < r('Y').rank);
  // #1s: A at 1 and 10 (11), B at 2 and 9 (11), both on 2 lists: A has a #1.
  r = run([[[1, 'A'], [9, 'B']], [[10, 'A'], [2, 'B']], [], [], []]);
  assert.deepEqual([r('A').score, r('A').lists], [r('B').score, r('B').lists]);
  assert.ok(r('A').rank < r('B').rank);
  // Median: C at 2, 6, 6 (median 6), D at 3, 4, 7 (median 4): both 19 points on 3 lists, no #1s; D's is better.
  r = run([[[2, 'C'], [3, 'D']], [[6, 'C'], [4, 'D']], [[6, 'C'], [7, 'D']], [], []]);
  assert.deepEqual([r('C').points, r('C').firsts], [r('D').points, r('D').firsts]);
  assert.ok(r('D').rank < r('C').rank);
  // Mentions: E and F placed alike; F has a mention more.
  r = run([[[4, 'E'], [5, 'F']], [[5, 'E'], [4, 'F']], [], [], []], [[], [], ['F'], [], []]);
  assert.equal(r('F').mentions, 1);
  assert.ok(r('F').rank < r('E').rank);
  // Still equal: the same rank, and the next one skips.
  r = run([[[4, 'G'], [5, 'H']], [[5, 'G'], [4, 'H']], [[1, 'I']], [], []]);
  assert.equal(r('G').rank, r('H').rank);
});

test('results: a tie at 10 shares 10th, and the next player is 12th', () => {
  const list = last => [...picks(1, 2, 3, 4, 5, 6, 7, 8, 9), { id: last, spot: 10 }];
  const ballots = [10, 10, 11, 11, 12].map((last, i) => ({ voter: 101 + i, picks: list(last), mentions: [], watch: [] }));
  const { results } = computeResults({ year: 2026, ballots });
  assert.deepEqual(results.ranking.slice(8).map(r => [r.id, r.rank, r.score]), [[9, 9, 2], [10, 10, 0.4], [11, 10, 0.4], [12, 12, 0.2]]);
});

test('results: mentions, ones to watch and the writing stats', () => {
  const ballots = [1, 2, 3, 4, 5].map(voter => ({ voter, picks: picks(...[6, 7, 8, 9, 10]), mentions: voter < 3 ? [11, 12] : [11], watch: voter === 5 ? [13] : [] }));
  const writeups = [{ voter: 1, subject: 6, words: 40 }, { voter: 2, subject: 6, words: 12 }, { voter: 3, subject: 11, words: 5 }, { voter: 4, subject: 7, words: 0 }];
  const { results } = computeResults({ year: 2026, ballots, writeups, finalizedAt: '2027-01-01T10:00:00Z' });
  assert.deepEqual(results.mentions, [{ id: 11, count: 5 }, { id: 12, count: 2 }]);
  assert.deepEqual(results.watch, [{ id: 13, count: 1 }]);
  assert.deepEqual(results.stats, { writeups: 3, words: 57, subjects: 2 });
  assert.equal(results.ranking.find(r => r.id === 6).mentions, 0);
  assert.deepEqual(Object.keys(results), ['year', 'kind', 'ballots', 'finalizedAt', 'ranking', 'mentions', 'watch', 'stats']);
  assert.deepEqual(Object.keys(results.ranking[0]), ['id', 'rank', 'score', 'points', 'lists', 'eligible', 'firsts', 'positions', 'best', 'worst', 'mentions', 'watch']);
});

test('payouts: approved unflagged write-ups on picks; a strike costs the ballot its write-up bananas', () => {
  const ballots = [{ voter: 1, picks: picks(5, 6) }, { voter: 2, picks: picks(5, 6) }, { voter: 3, picks: picks(5, 6) }];
  const w = (voter, subject, words, extra = {}) => ({ voter, subject, words, flags: [], mod: 'ok', ...extra });
  const writeups = [
    w(1, 6, 45), w(1, 5, 41), w(1, 9, 50), // 9 is a mention: never paid
    w(2, 5, 12), w(2, 6, 60, { flags: ['copy'] }),
    w(3, 5, 40), w(3, 9, 10, { mod: 'struck' }),
  ];
  const thanks = [{ subject: 5, voter: 1 }, { subject: 5, voter: 3 }, { subject: 9, voter: 3 }, { subject: 6, voter: 7 }];
  assert.deepEqual(payoutsFor({ year: 2026, ballots, writeups, thanks }), [
    { osuId: 1, type: 'top10.payout', payload: { year: 2026, kind: 'year', ballot: true, writeups: [{ subject: 5, words: 41 }, { subject: 6, words: 45 }], allFull: true } },
    { osuId: 2, type: 'top10.payout', payload: { year: 2026, kind: 'year', ballot: true, writeups: [{ subject: 5, words: 12 }], allFull: false } },
    { osuId: 3, type: 'top10.payout', payload: { year: 2026, kind: 'year', ballot: true, writeups: [], allFull: false } },
    { osuId: 1, type: 'top10.thanks', payload: { year: 2026, kind: 'year', subject: 5 } },
    { osuId: 3, type: 'top10.thanks', payload: { year: 2026, kind: 'year', subject: 5 } },
  ]);
});

// ---- Ballots through the API --------------------------------------------------------------------------------------

test('the hub: season, turnout, and for a signed-in player whether they can vote', async () => {
  const env = envWith();
  const out = await call(api.hub, env, { now: OPEN });
  assert.deepEqual(out.body, { season: { ...SEASON, phase: 'open', showcase: 'open' }, turnout: 0, turnouts: { year: 0, alltime: 0 }, finalized: false, editions: [] });
  assert.ok(Number.isInteger(out.body.turnout), 'turnout is a plain whole number, for the bot');
  const pt = await call(api.hub, env, { as: 3, now: OPEN });
  assert.deepEqual(pt.body.me, { osuId: 3, eligible: true, ballot: null, ballots: { year: null, alltime: null } });
  const outsider = await call(api.hub, env, { as: 999, now: OPEN });
  assert.equal(outsider.body.me.eligible, false);
  assert.equal(outsider.body.me.code, 'not_pt');
  assert.match(outsider.body.me.reason, /PT players/);
  // The data can't be read: not eligible, with a reason that says so (and the hub still answers).
  served.clear();
  forgetData();
  const down = await call(api.hub, env, { as: 3, now: OPEN });
  assert.equal(down.status, 200);
  assert.equal(down.body.me.code, 'data_unavailable');
  // No database: 503.
  assert.equal((await call(api.hub, envWith({ ECONOMY: undefined }))).status, 503);
});

test('only signed-in PT players save ballots, and only while voting is open', async () => {
  const env = envWith();
  const body = { picks: picks(4, 5, 6, 7, 8) };
  assert.equal((await save(env, undefined, body)).status, 401);
  assert.equal((await save(env, 999, body)).status, 403);
  assert.equal((await save(envWith({ OSU_CLIENT_SECRET: undefined }), 3, body)).status, 503);
  for (const [now, code] of [[BEFORE, 'not_open'], [CLOSED, 'closed'], [REVEALED, 'closed']]) {
    const out = await save(env, 3, body, now);
    assert.deepEqual([out.status, out.body.code], [409, code], code);
    assert.equal((await submit(env, 3, now)).status, 409);
    assert.equal((await withdraw(env, 3, now)).status, 409);
    // The showcase has its own window, which is open before voting is (see the showcase window's test).
    assert.equal((await addPlay(env, 3, { player: 4, clip: `https://youtu.be/${now}` }, now)).status, now === BEFORE ? 201 : 409);
  }
  assert.equal((await save(env, 3, body, LAST_SECOND)).status, 200, 'the last second still saves');
  assert.equal((await mine(env, 3)).body.ballot.status, 'draft');
});

test('ballot rules: 5–10 distinct PT players, never yourself, spots in order; mentions and watch up to 5, apart from picks', async () => {
  const env = envWith();
  const refused = async (body, code) => {
    const out = await save(env, 3, body);
    assert.deepEqual([out.status, out.body.code], [400, code], `${JSON.stringify(body).slice(0, 80)} → ${out.body.error}`);
  };
  await refused({ picks: picks(4, 5, 3, 6, 7) }, 'self');
  await refused({ picks: picks(4, 5, 5, 6, 7) }, 'duplicate');
  await refused({ picks: picks(4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14) }, 'too_many');
  await refused({ picks: [4, 5, 6, 7, 8].map((id, i) => ({ id, spot: [1, 1, 2, 4, 5][i] })) }, 'spots');
  await refused({ picks: [4, 5, 6, 7, 8].map((id, i) => ({ id, spot: i + 2 })) }, 'spots');
  await refused({ picks: picks(4, 5, 6, 7, 999) }, 'not_pt');
  await refused({ picks: [{ id: 4 }] }, 'shape');
  await refused({ picks: 'Hiroto-' }, 'shape');
  await refused({ picks: picks(4, 5, 6, 7, 8), mentions: [9, 10, 11, 12, 13, 14] }, 'too_many');
  await refused({ picks: picks(4, 5, 6, 7, 8), mentions: [8] }, 'overlap');
  await refused({ picks: picks(4, 5, 6, 7, 8), watch: [3] }, 'self');
  await refused({ picks: picks(4, 5, 6, 7, 8), watch: [9, 9] }, 'duplicate');
  await refused({ picks: picks(4, 5, 6, 7, 8), writeups: { 12: { body: 'not on my list at all' } } }, 'not_listed');
  await refused({ picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: 'x'.repeat(4001) } } }, 'too_long');
  await refused({ picks: picks(4, 5, 6, 7, 8), intro: 'x'.repeat(2001) }, 'too_long');
  await refused({ picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: 'ok', cites: ['nope'] } } }, 'cite');
  await refused({ picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: 'ok', cites: ['osu:1', 'osu:2', 'osu:3', 'osu:4', 'osu:5', 'osu:6'] } } }, 'cite');
  await refused({ picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: 'ok', cites: ['osu:123456'] } } }, 'cite');
  await refused({ picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: 'ok', cites: ['map:999'] } } }, 'cite');
  await refused({ picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: 'ok', cites: ['play:3'] } } }, 'cite');
  assert.equal((await save(env, 3, '[1,2]')).status, 400);
  assert.equal((await save(env, 3, `{"intro":"${'x'.repeat(70000)}"}`)).status, 413);

  // A tie, mentions and ones to watch that overlap each other, write-ups on all three lists, and a draft under 5.
  const ok = await save(env, 3, {
    picks: [4, 5, 6, 7, 8].map((id, i) => ({ id, spot: [1, 2, 3, 3, 5][i] })), mentions: [9, 10], watch: [10, 11],
    intro: '  Olá a todos!\r\nAqui vai.  ', outro: 'Até para o ano.',
    writeups: { 4: { body: 'What a year: 9 first PT FCs.', cites: [4000000001, 'map:405', 'osu:4000000002'] }, 10: { body: 'Ones to watch!' } },
  });
  assert.equal(ok.status, 200, ok.body.error);
  assert.equal(ok.body.ballot.intro, 'Olá a todos!\nAqui vai.');
  // Cites come back canonical (a map ref without a player is the subject's), each with its card from the data.
  assert.deepEqual(ok.body.ballot.writeups[4].cites, ['osu:4000000001', 'map:405:4', 'osu:4000000002']);
  assert.deepEqual(Object.keys(ok.body.ballot.scores), ['osu:4000000001', 'map:405:4', 'osu:4000000002']);
  assert.deepEqual(ok.body.ballot.scores['map:405:4'], {
    ref: 'map:405:4', player: 4, map: 405, set: null, artist: null, title: null, version: null, stars: null, pp: 120.5, acc: 99.1, miss: 1,
    combo: 800, mods: 'NM', grade: 'S', time: at('2026-08-01T10:00:00Z'), url: 'https://osu.ppy.sh/scores/4000000005',
  });
  assert.deepEqual([ok.body.ballot.writeups[4].words, ok.body.ballot.writeups[4].flags, ok.body.ballot.writeups[4].mod], [5, [], 'ok']);
  assert.equal((await save(env, 5, { picks: picks(4, 6) })).status, 200, 'a draft can be short');
});

test('submit makes a ballot public; edits stay live and must keep it complete; withdraw takes it back', async () => {
  const env = envWith();
  await save(env, 5, { picks: picks(4, 6) });
  const short = await submit(env, 5);
  assert.deepEqual([short.status, short.body.code], [400, 'too_few']);
  assert.equal((await submit(env, 6)).status, 400, 'nothing saved yet');

  await save(env, 5, { picks: picks(4, 6, 7, 8, 9), writeups: { 4: { body: 'A first write-up about four.' } } });
  const sent = await submit(env, 5);
  assert.equal(sent.status, 200);
  assert.equal(sent.body.ballot.status, 'submitted');
  assert.ok(sent.body.ballot.submitted_at);
  assert.equal((await submit(env, 5)).body.ballot.status, 'submitted', 'submitting twice is fine');
  assert.equal((await call(api.hub, env)).body.turnout, 1);

  // Edits of a submitted ballot are live, and it stays submitted.
  const edited = await save(env, 5, { picks: picks(4, 6, 7, 8, 9, 10), writeups: { 10: { body: 'Ten is new here.' } } });
  assert.equal(edited.body.ballot.status, 'submitted');
  let public5 = (await feed(env)).body.ballots[0];
  assert.deepEqual(public5.picks.map(p => p.id), [4, 6, 7, 8, 9, 10]);
  assert.deepEqual(Object.keys(public5.writeups), ['4', '10']);
  assert.equal(public5.writeups[4].flags, undefined, 'flags are not public');
  // …but it can't drop under 5.
  const dropped = await save(env, 5, { picks: picks(4, 6, 7, 8) });
  assert.deepEqual([dropped.status, dropped.body.code], [400, 'too_few']);
  assert.match(dropped.body.error, /withdraw/);

  // A write-up on someone no longer listed goes with them; an empty body deletes one.
  await save(env, 5, { picks: picks(6, 7, 8, 9, 10), writeups: { 10: { body: '' } } });
  public5 = (await feed(env)).body.ballots[0];
  assert.deepEqual(Object.keys(public5.writeups), []);

  const back = await withdraw(env, 5);
  assert.deepEqual([back.body.ballot.status, back.body.ballot.submitted_at], ['draft', null]);
  assert.deepEqual((await feed(env)).body.ballots, [], 'drafts are never public');
  assert.equal((await call(api.hub, env)).body.turnout, 0);
});

test('saving the same ballot again writes nothing', async () => {
  const env = envWith();
  const body = { picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: 'Steady all year long.' } } };
  await save(env, 3, body);
  const first = env.ECONOMY.sqlite.prepare('SELECT updated FROM top10_ballots').get().updated;
  await save(env, 3, body, OPEN + 60);
  assert.equal(env.ECONOMY.sqlite.prepare('SELECT updated FROM top10_ballots').get().updated, first);
  await save(env, 3, { intro: 'Hi' }, OPEN + 120);
  assert.equal(env.ECONOMY.sqlite.prepare('SELECT updated FROM top10_ballots').get().updated, OPEN + 120);
  assert.equal((await mine(env, 3)).body.ballot.writeups[4].body, 'Steady all year long.', 'a field left out is kept');
});

test('copy flags: the same text on your own ballot (the later one) or on another ballot', async () => {
  const env = envWith();
  const text = essay(30, 1);
  const own = await save(env, 3, { picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: text }, 5: { body: `${text}!` }, 6: { body: essay(30, 2) } } });
  assert.deepEqual([own.body.ballot.writeups[4].flags, own.body.ballot.writeups[5].flags, own.body.ballot.writeups[6].flags], [[], ['copy'], []]);
  const other = await save(env, 9, { picks: picks(4, 5, 6, 7, 8), writeups: { 7: { body: `Honestly: ${essay(30, 2)}` }, 8: { body: essay(45, 9) } } });
  assert.deepEqual(other.body.ballot.writeups[7].flags, ['copy']);
  assert.deepEqual([other.body.ballot.writeups[8].flags, other.body.ballot.writeups[8].words], [[], 45]);
});

test('the public feed: submitted ballots only, struck write-ups and void ballots left out, thanks shown', async () => {
  const env = envWith();
  for (const voter of [3, 4, 5]) {
    await save(env, voter, { picks: picks(...[6, 7, 8, 9, 10].map(id => id + voter)), writeups: { [6 + voter]: { body: `About my number one, says ${voter}.` }, [7 + voter]: { body: 'Second place, honestly.' } } });
  }
  await submit(env, 3);
  await submit(env, 4, OPEN + 10);
  assert.deepEqual((await feed(env)).body.ballots.map(b => b.voter), [3, 4], 'first submitted first; 5 is a draft');
  assert.deepEqual((await thank(env, 9, { voter: 3 })).body, { thanked: true, thanks: 1 });
  assert.equal((await act(env, 1, { action: 'strike', target: { voter: 3, subject: 10 }, reason: 'filler' }, OPEN)).body.changed, true);
  assert.equal((await act(env, 1, { action: 'void', target: 4, reason: 'alt account' }, OPEN)).body.changed, true);
  const ballots = (await feed(env)).body.ballots;
  assert.equal(ballots.length, 1);
  assert.deepEqual(Object.keys(ballots[0].writeups), ['9']);
  assert.deepEqual([ballots[0].thanks, ballots[0].writeups[9].thanks, ballots[0].writeups[9].thanked], [1, 1, undefined], 'signed out: no thanked');
  // Signed in, `thanked` says whether you did: the subject sees their own, anyone else false.
  assert.equal((await call(api.ballots, env, { as: 9, path: '/api/top10/ballots' })).body.ballots[0].writeups[9].thanked, true);
  assert.equal((await call(api.ballots, env, { as: 5, path: '/api/top10/ballots' })).body.ballots[0].writeups[9].thanked, false);
  // The voided voter sees why, and can't edit it.
  const four = await mine(env, 4);
  assert.deepEqual([four.body.ballot.status, four.body.ballot.void_reason], ['void', 'alt account']);
  assert.equal(four.body.log[0].action, 'void');
  assert.equal((await save(env, 4, { intro: 'hi' })).status, 403);
  assert.equal((await withdraw(env, 4)).status, 403);
  // The struck writer sees the strike; editing the text is their fix.
  const three = await mine(env, 3);
  assert.deepEqual([three.body.ballot.writeups[10].mod, three.body.ballot.writeups[10].mod_reason], ['struck', 'filler']);
  assert.deepEqual([three.body.ballot.writeups[9].thanks, three.body.ballot.writeups[10].thanks], [1, 0]);
  assert.deepEqual(three.body.log.map(l => [l.action, l.target, l.reason]), [['strike', 'writeup:3:10', 'filler']]);
  const fixed = await save(env, 3, { writeups: { 10: { body: 'Second place: the most consistent player all year.' } } });
  assert.equal(fixed.body.ballot.writeups[10].mod, 'ok');
  assert.ok((await feed(env)).body.ballots[0].writeups[10]);
  assert.equal((await call(api.ballots, env, { path: '/api/top10/ballots?year=20x6' })).status, 400);
  assert.deepEqual((await call(api.ballots, env, { path: '/api/top10/ballots?year=2025' })).body, { year: 2025, kind: 'year', ballots: [] });
});

test('the Functions answer for the ballot routes', async () => {
  const now = Date.now();
  const around = { year: 2026, opens: new Date(now - 3600e3).toISOString(), closes: new Date(now + 3600e3).toISOString(), reveal: new Date(now + 7200e3).toISOString(), thanksUntil: new Date(now + 9000e3).toISOString() };
  const env = envWith({ TOP10_SEASON: JSON.stringify(around) });
  const headers = { Authorization: `Bearer ${await makeSession(SECRET, 3)}` };
  const put = await ballotPutRoute({ request: new Request(`${BASE}/api/top10/ballot`, { method: 'PUT', headers, body: JSON.stringify({ picks: picks(4, 5, 6, 7, 8) }) }), env });
  assert.equal(put.status, 200);
  assert.equal((await submitRoute({ request: new Request(`${BASE}/api/top10/ballot/submit`, { method: 'POST', headers }), env })).status, 200);
  const got = await (await ballotGetRoute({ request: new Request(`${BASE}/api/top10/ballot`, { headers }), env })).json();
  assert.equal(got.ballot.status, 'submitted');
  assert.equal(got.season.phase, 'open');
  assert.equal(got.eligible, true);
});

// ---- The showcase -------------------------------------------------------------------------------------------------

test('score refs: one grammar (osu:, legacy:, map:, play:), and the forms read into it', () => {
  const ref = (input, opts) => parseRef(input, opts)?.ref ?? parseRef(input, opts);
  // The canonical forms.
  assert.equal(ref('osu:5000000001'), 'osu:5000000001');
  assert.equal(ref('legacy:77'), 'legacy:77');
  assert.equal(ref('map:4685818:19423459'), 'map:4685818:19423459');
  assert.equal(ref('play:3'), 'play:3');
  // What's read into them: score links as /addscore reads them, bare numbers, S.IDs, a map with the player apart, p<id>.
  assert.equal(ref('https://osu.ppy.sh/scores/5000000001'), 'osu:5000000001');
  assert.equal(ref('https://osu.ppy.sh/scores/fruits/77/'), 'legacy:77');
  assert.deepEqual(parseRef('https://osu.ppy.sh/scores/osu/77'), { error: 'mode' });
  assert.deepEqual(parseRef(' 77 '), { kind: 'osu', id: 77, ref: 'osu:77', bare: true });
  assert.equal(ref(77), 'osu:77');
  assert.equal(ref(-77), 'legacy:77');
  assert.equal(ref('-77'), 'legacy:77');
  assert.equal(ref('map:405', { player: 4 }), 'map:405:4');
  assert.equal(ref('MAP:405:4', { player: 9 }), 'map:405:4', 'a player in the ref wins');
  assert.equal(ref('p3'), 'play:3');
  for (const bad of ['map:405', 'https://osu.ppy.sh/beatmapsets/1#fruits/2', 'https://evil.example/scores/1', 'scores/1', '0', 'osu:0', '', null, 'javascript:alert(1)', 'play:x']) {
    assert.equal(parseRef(bad), null, String(bad));
  }
  assert.deepEqual([sidRef(5), sidRef(-5), sidRef(0), refSid('legacy:5'), refSid('map:1:2')], ['osu:5', 'legacy:5', null, -5, null]);
  assert.deepEqual([scoreUrl('osu:5'), scoreUrl('legacy:5'), scoreUrl('map:1:2')], ['https://osu.ppy.sh/scores/5', 'https://osu.ppy.sh/scores/fruits/5', null]);
  // The tuple scans: by id (skipping a map tuple that ends with the same number), and by map (a title with brackets).
  const text = JSON.stringify(FILES['players/2.json']);
  assert.equal(tuplesWithId(text, 5000000001).length, 1);
  assert.equal(tuplesWithId(text, 5000000001)[0][0], 111);
  assert.deepEqual(tuplesWithId(text, 123), []);
  assert.equal(tuplesOnMap(text, 112)[0][11], -77);
  assert.equal(bestOnMap(text, 113, 2026), null, 'its only play on 113 is from 2025');
  assert.deepEqual(mapTuple(JSON.stringify({ maps: { 9: ['A [B]', 'T]"[', 'V', 1, 2] } }), 9), ['A [B]', 'T]"[', 'V', 1, 2]);
});

test('showcase: a PT player’s score set this year, checked against the exported data', async () => {
  const env = envWith();
  const mineScore = await addPlay(env, 2, { score: 'https://osu.ppy.sh/scores/5000000001', caption: '  First PT FC\non this one  ' });
  assert.equal(mineScore.status, 201);
  // osu! isn't set up in this env, so the exported data is checked (and gives the card), and there's no replay to link.
  assert.deepEqual({ ...mineScore.body.play, created: undefined }, {
    id: 1, year: 2026, scope: 'year', submitter: 2, player: 2, score_ref: 'osu:5000000001', beatmap_id: 111, caption: 'First PT FC on this one', clip: null,
    created: undefined, played: '2026-03-01T10:00:00Z', endorsements: 0,
    score: {
      ref: 'osu:5000000001', player: 2, map: 111, set: 77, artist: 'Artist', title: 'Title', version: 'Hard', stars: 5.1, pp: 120.5, acc: 99.1,
      miss: 1, combo: 800, mods: 'NM', grade: 'S', time: at('2026-03-01T10:00:00Z'), url: 'https://osu.ppy.sh/scores/5000000001',
    },
    replay: null,
  });
  // Someone else's: from the recent plays, or named.
  const theirs = await addPlay(env, 5, { score: 'https://osu.ppy.sh/scores/fruits/88' });
  assert.deepEqual([theirs.status, theirs.body.play.player, theirs.body.play.score_ref], [201, 3, 'legacy:88']);
  const named = await addPlay(env, 5, { score: '77', player: 2 });
  assert.deepEqual([named.status, named.body.play.score_ref], [201, 'legacy:77'], 'a bare id matches the legacy one');
  // A map ref: that player's best play on the map this season, for plays the export has no score id for.
  const byMap = await addPlay(env, 9, { score: 'map:110', player: 2 });
  assert.deepEqual([byMap.status, byMap.body.play.score_ref, byMap.body.play.score.ref, byMap.body.play.score.url, byMap.body.play.beatmap_id], [201, 'map:110:2', 'map:110:2', null, 110]);
  assert.equal((await addPlay(env, 5, { score: 'map:112:2' })).body.code, 'duplicate', 'map:112:2 is the play already in as legacy:77');

  const refused = async (body, status, code, as = 5) => {
    const out = await addPlay(env, as, body);
    assert.deepEqual([out.status, out.body.code], [status, code], `${JSON.stringify(body)} → ${out.body.error}`);
    return out;
  };
  const wrongYear = await refused({ score: 'https://osu.ppy.sh/scores/5000000002', player: 2 }, 422, 'wrong_year');
  assert.equal(wrongYear.body.year, 2025);
  const missing = await refused({ score: 'https://osu.ppy.sh/scores/123456' }, 422, 'not_in_data');
  assert.match(missing.body.error, /\/addscore first, or attach its replay \(\.osr\) or a clip/);
  await refused({ score: 'https://osu.ppy.sh/scores/123456', player: 2 }, 422, 'not_in_data');
  await refused({ score: 'https://osu.ppy.sh/scores/osu/1' }, 400, 'mode');
  await refused({ score: 'not a score' }, 400, 'score');
  await refused({ score: '4000000001', player: 999 }, 422, 'not_pt');
  await refused({ score: 'https://osu.ppy.sh/scores/5000000001', player: 2 }, 409, 'duplicate');
  await refused({ score: 'map:113:2' }, 422, 'not_in_data');
  await refused({ score: 'map:110:2', player: 3 }, 422, 'not_theirs');
  await refused({ score: 'map:110:999' }, 422, 'not_pt');
  await refused({ score: 'play:1' }, 400, 'score');
  // A clip instead: allowed sites only, for a PT player.
  const clip = await addPlay(env, 5, { player: 6, clip: 'http://www.youtube.com/watch?v=abc', caption: 'offline ScoreV2 run' });
  assert.deepEqual([clip.status, clip.body.play.clip, clip.body.play.score_ref, clip.body.play.score], [201, 'https://www.youtube.com/watch?v=abc', null, null]);
  for (const [i, ok] of ['https://youtu.be/x', 'https://clips.twitch.tv/x', 'https://streamable.com/x'].entries()) assert.equal((await addPlay(env, [7, 8, 10][i], { player: 6, clip: ok })).status, 201, ok);
  await refused({ player: 6, clip: 'https://evil.example/youtube.com' }, 400, 'clip');
  await refused({ player: 6, clip: 'javascript:alert(1)//youtube.com' }, 400, 'clip');
  await refused({ player: 999, clip: 'https://youtu.be/x' }, 422, 'not_pt');
  await refused({ player: 6 }, 400, 'shape');
  await refused({ player: 6, clip: 'https://youtu.be/x', caption: 'x'.repeat(281) }, 400, 'too_long');
  assert.equal((await addPlay(env, 999, { player: 6, clip: 'https://youtu.be/x' })).status, 403, 'non-PT players can’t submit');
});

test('showcase: 15 entries a year each, at most 5 of your own', async () => {
  const env = envWith();
  for (let i = 0; i < 5; i++) assert.equal((await addPlay(env, 4, { score: String(4000000000 + i) })).status, 201);
  const sixth = await addPlay(env, 4, { score: String(4000000005) });
  assert.deepEqual([sixth.status, sixth.body.code], [429, 'own_limit']);
  // One entry for each other player: a second of player 6's is refused, another player's isn't.
  assert.equal((await addPlay(env, 4, { player: 6, clip: 'https://youtu.be/a' })).status, 201);
  const again = await addPlay(env, 4, { player: 6, clip: 'https://youtu.be/b' });
  assert.deepEqual([again.status, again.body.code, again.body.player], [429, 'other_limit', 6]);
  for (let i = 1; i < 10; i++) assert.equal((await addPlay(env, 4, { player: 6 + i, clip: `https://youtu.be/${i}` })).status, 201);
  const over = await addPlay(env, 4, { player: 16, clip: 'https://youtu.be/more' });
  assert.deepEqual([over.status, over.body.code], [429, 'limit']);
  // The Legendary plays count apart: player 6 again there is fine, once.
  assert.equal((await addPlay(env, 4, { scope: 'alltime', player: 6, clip: 'https://youtu.be/c' })).status, 201);
  assert.equal((await addPlay(env, 4, { scope: 'alltime', player: 6, clip: 'https://youtu.be/d' })).body.code, 'other_limit');
  // Another player can still add player 4's other scores.
  assert.equal((await addPlay(env, 5, { score: String(4000000005), player: 4 })).status, 201);
});

test('showcase: the list, endorsements (one each, toggled) and removing your own entry', async () => {
  const env = envWith();
  await addPlay(env, 2, { score: 'https://osu.ppy.sh/scores/5000000001' });
  await addPlay(env, 5, { player: 6, clip: 'https://youtu.be/x' });
  const endorse = async (as, id, body) => {
    const request = new Request(`${BASE}/api/top10/plays/${id}/endorse`, { method: 'POST', headers: { Authorization: `Bearer ${await makeSession(SECRET, as)}` }, body: body && JSON.stringify(body) });
    const res = await endorseRoute({ request, env, params: { id: String(id) } });
    return { status: res.status, body: await res.json() };
  };
  assert.deepEqual((await endorse(7, 2)).body, { endorsed: true, endorsements: 1 });
  assert.deepEqual((await endorse(8, 2, { endorsed: true })).body, { endorsed: true, endorsements: 2 });
  assert.deepEqual((await endorse(8, 2, { endorsed: true })).body, { endorsed: true, endorsements: 2 }, 'one per person');
  assert.deepEqual((await endorse(7, 2)).body, { endorsed: false, endorsements: 1 }, 'toggled back');
  assert.equal((await endorse(999, 2)).status, 403);
  assert.equal((await endorse(7, 99)).status, 404);

  const list = await call(api.plays, env, { path: '/api/top10/plays?year=2026' });
  assert.deepEqual(list.body.plays.map(p => [p.id, p.endorsements]), [[2, 1], [1, 0]], 'most endorsed first');
  assert.equal(list.body.plays[0].endorsed, undefined, 'signed out: no endorsed');
  const signed = await call(api.plays, env, { as: 8, path: '/api/top10/plays?player=6' });
  assert.deepEqual(signed.body.plays.map(p => [p.id, p.endorsed]), [[2, true]]);
  assert.equal((await call(api.plays, env, { path: '/api/top10/plays?player=abc' })).status, 400);

  // Hidden entries leave the list (and can't be endorsed); only the submitter can delete one.
  assert.equal((await act(env, 1, { action: 'hide-play', target: 'play:2', reason: 'clip spam' }, OPEN)).body.changed, true);
  assert.deepEqual((await call(api.plays, env, { path: '/api/top10/plays' })).body.plays.map(p => p.id), [1]);
  assert.equal((await endorse(7, 2)).status, 404);
  assert.deepEqual((await mine(env, 5)).body.log.map(l => [l.action, l.target, l.reason]), [['hide-play', 'play:2', 'clip spam']]);
  const del = async (as, id) => (await playDeleteRoute({ request: new Request(`${BASE}/api/top10/plays/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await makeSession(SECRET, as)}` } }), env, params: { id: String(id) } })).status;
  assert.equal(await del(5, 1), 403);
  assert.equal(await del(2, 1), 200);
  assert.equal(await del(2, 1), 404);
  assert.equal(env.ECONOMY.sqlite.prepare("SELECT COUNT(*) AS n FROM top10_marks WHERE mark = 'endorse' AND target = 1").get().n, 0);
});

test('the showcase has its own window: from showcaseOpens, before voting, to the close; ballots keep voting’s', async () => {
  const season = seasonOf({});
  assert.equal(season.showcaseOpens, '2026-11-08T00:00:00Z');
  assert.deepEqual([at('2026-11-07T23:59:59Z'), at('2026-11-08T00:00:00Z'), BEFORE, OPEN, LAST_SECOND, LAST_SECOND + 1, REVEALED].map(t => showcaseOf(season, t)),
    ['before', 'open', 'open', 'open', 'open', 'closed', 'closed']);
  const env = envWith();
  const hub = (await call(api.hub, env, { now: BEFORE })).body;
  assert.deepEqual([hub.season.phase, hub.season.showcase, hub.season.showcaseOpens], ['before', 'open', '2026-11-08T00:00:00Z']);

  // In the window, before voting: adding (both scopes), endorsing, removing and the mods' actions work…
  const added = await addPlay(env, 2, { score: 'https://osu.ppy.sh/scores/5000000001' }, BEFORE);
  assert.equal(added.status, 201, added.body.error);
  assert.equal((await addPlay(env, 5, { player: 6, clip: 'https://youtu.be/early' }, BEFORE)).status, 201);
  assert.equal((await addPlay(env, 5, { scope: 'alltime', score: '5000000002', player: 2 }, BEFORE)).status, 201, 'Legendary plays too');
  const endorsed = await call(api.endorse, env, { as: 7, now: BEFORE, method: 'POST', path: '/api/top10/plays/1/endorse', id: '1' });
  assert.deepEqual(endorsed.body, { endorsed: true, endorsements: 1 });
  assert.deepEqual((await act(env, 1, { action: 'hide-play', target: 'play:2', reason: 'not a play' }, BEFORE)).body, { ok: true, changed: true });
  assert.deepEqual((await act(env, 1, { action: 'show-play', target: 'play:2' }, BEFORE)).body, { ok: true, changed: true });
  assert.equal((await call(api.deletePlay, env, { as: 5, now: BEFORE, method: 'DELETE', path: '/api/top10/plays/2', id: '2' })).status, 200);
  // …while ballots still wait for voting.
  const ballot = await save(env, 3, { picks: picks(4, 5, 6, 7, 8) }, BEFORE);
  assert.deepEqual([ballot.status, ballot.body.code], [409, 'not_open']);

  // Before the showcase opens, and after the close: no adding.
  const early = await addPlay(env, 5, { player: 6, clip: 'https://youtu.be/too-early' }, at('2026-11-07T12:00:00Z'));
  assert.deepEqual([early.status, early.body.code, early.body.showcase], [409, 'not_open', 'before']);
  assert.match(early.body.error, /The showcase opens on 2026-11-08/);
  for (const now of [LAST_SECOND + 1, CLOSED, REVEALED]) {
    const late = await addPlay(env, 5, { player: 6, clip: `https://youtu.be/late${now}` }, now);
    assert.deepEqual([late.status, late.body.code, late.body.showcase], [409, 'closed', 'closed'], String(now));
  }
  assert.equal((await addPlay(env, 5, { player: 6, clip: 'https://youtu.be/last' }, LAST_SECOND)).status, 201, 'the last second still adds');
});

test('a season without showcaseOpens opens the showcase with voting, as before; one after opens is refused', async () => {
  const mock = { year: 2026, opens: '2026-11-20T00:00:00Z', closes: '2026-11-26T23:59:59Z', reveal: '2026-11-28T12:00:00Z', thanksUntil: '2026-11-30T23:59:59Z' };
  const season = seasonOf({ TOP10_SEASON: JSON.stringify(mock) });
  assert.equal(season.showcaseOpens, mock.opens);
  const env = envWith({ TOP10_SEASON: JSON.stringify(mock) });
  const before = await addPlay(env, 5, { player: 6, clip: 'https://youtu.be/a' }, at('2026-11-19T23:59:59Z'));
  assert.deepEqual([before.status, before.body.code], [409, 'not_open']);
  assert.equal((await addPlay(env, 5, { player: 6, clip: 'https://youtu.be/a' }, at('2026-11-20T00:00:00Z'))).status, 201);
  assert.equal((await addPlay(env, 5, { player: 6, clip: 'https://youtu.be/b' }, at('2026-11-27T00:00:00Z'))).body.code, 'closed');
  // showcaseOpens may be earlier than opens, never later, and must be a time.
  assert.equal(seasonOf({ TOP10_SEASON: JSON.stringify({ ...mock, showcaseOpens: '2026-11-10T00:00:00Z' }) }).showcaseOpens, '2026-11-10T00:00:00Z');
  assert.equal(normalizeSeason({ ...mock, showcaseOpens: '2026-11-21T00:00:00Z' }), null);
  assert.equal(normalizeSeason({ ...mock, showcaseOpens: 'soon' }), null);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(seasonOf({ TOP10_SEASON: JSON.stringify({ ...mock, showcaseOpens: '2026-11-21T00:00:00Z' }) }).opens, SEASON.opens, 'out of order: the built-in season');
  } finally { console.warn = warn; }
});

test('the PT list and player files come from the Cache API when there is one', async () => {
  const kept = new Map();
  globalThis.caches = { default: { match: async url => (kept.has(url) ? new Response(kept.get(url)) : undefined), put: async (url, res) => { kept.set(url, await res.text()); } } };
  const env = envWith();
  assert.ok((await ptPlayers(env)).has(3));
  forgetData();
  fetched = [];
  assert.ok((await ptPlayers(env)).has(3));
  assert.deepEqual(fetched, [`${DATA}meta.json`], 'players.json came from the cache');
  await addPlay(env, 2, { score: 'https://osu.ppy.sh/scores/5000000001' });
  fetched = [];
  forgetData();
  assert.equal((await addPlay(env, 2, { score: 'https://osu.ppy.sh/scores/fruits/77' })).status, 201);
  assert.ok(!fetched.some(url => url.includes('players/2.')), 'the player file came from the cache');
});

// ---- Thanks, moderation and finalize ------------------------------------------------------------------------------

test('thanks: only the subject, only on a public ballot, until thanksUntil; toggles until finalize', async () => {
  const env = envWith();
  await save(env, 3, { picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: 'The best year anyone had.' } } });
  assert.equal((await thank(env, 4, { voter: 3 })).status, 404, 'a draft isn’t public yet');
  await submit(env, 3);
  assert.equal((await thank(env, 5, { voter: 3 })).status, 404, 'no write-up about 5');
  assert.equal((await thank(env, 4, { voter: 'x' })).status, 400);
  assert.deepEqual((await thank(env, 4, { voter: 3 })).body, { thanked: true, thanks: 1 });
  assert.deepEqual((await thank(env, 4, { voter: 3 })).body, { thanked: false, thanks: 0 }, 'toggled back before finalize');
  assert.deepEqual((await thank(env, 4, { voter: 3, thanked: true }, CLOSED)).body, { thanked: true, thanks: 1 }, 'still open after voting closes');
  const late = await thank(env, 4, { voter: 3 }, LATE);
  assert.deepEqual([late.status, late.body.code], [409, 'thanks_closed']);
  assert.equal((await call(api.thank, env, { method: 'POST', path: '/api/top10/thanks', body: { voter: 3 } })).status, 401);
});

test('moderation: admins only; no mod acts on write-ups about themselves (or their own), or on their own ballot', async () => {
  const env = envWith();
  await save(env, 3, { picks: picks(1, 2, 4, 5, 6), writeups: { 1: { body: 'About admin one.' }, 2: { body: 'About admin two.' }, 4: { body: 'About four.' } } });
  await save(env, 1, { picks: picks(2, 4, 5, 6, 7), writeups: { 4: { body: 'Admin one on four.' } } });
  await submit(env, 3);
  await submit(env, 1);
  assert.equal((await act(env, 5, { action: 'strike', target: { voter: 3, subject: 4 }, reason: 'x' }, OPEN)).status, 403);
  assert.equal((await call(api.adminQueue, env, { as: 5, path: '/api/top10/admin/queue' })).status, 403);
  const self = await act(env, 1, { action: 'strike', target: { voter: 3, subject: 1 }, reason: 'x' }, OPEN);
  assert.deepEqual([self.status, self.body.code], [403, 'self']);
  assert.equal((await act(env, 1, { action: 'restore', target: '1:4' }, OPEN)).status, 403, 'nor their own write-up');
  assert.equal((await act(env, 1, { action: 'void', target: 1, reason: 'x' }, OPEN)).status, 403, 'nor their own ballot');
  assert.equal((await act(env, 2, { action: 'strike', target: 'writeup:3:1', reason: 'mean' }, OPEN)).body.changed, true, 'the other mod can');
  assert.equal((await act(env, 2, { action: 'strike', target: { voter: 3, subject: 1 }, reason: 'mean' }, OPEN)).body.changed, false, 'already struck');
  assert.equal((await act(env, 1, { action: 'strike', target: { voter: 3, subject: 4 } }, OPEN)).body.code, 'reason');
  assert.equal((await act(env, 1, { action: 'strike', target: { voter: 3, subject: 9 }, reason: 'x' }, OPEN)).status, 404);
  assert.equal((await act(env, 1, { action: 'nuke', target: 3 }, OPEN)).body.code, 'action');
  assert.equal((await act(env, 1, { action: 'void', target: 'ballot:x', reason: 'x' }, OPEN)).body.code, 'target');

  const queue = await call(api.adminQueue, env, { as: 1, path: '/api/top10/admin/queue' });
  assert.equal(queue.status, 200);
  assert.deepEqual(queue.body.writeups.find(w => w.target === 'writeup:3:1').own, true);
  assert.deepEqual(queue.body.writeups.find(w => w.target === 'writeup:3:4').own, false);
  assert.deepEqual(queue.body.ballots.find(b => b.voter === 1).own, true);
  assert.deepEqual(queue.body.log.map(l => [l.admin, l.action, l.target]), [[2, 'strike', 'writeup:3:1']]);
  assert.deepEqual([queue.body.phase, queue.body.year, queue.body.finalized], ['open', 2026, false]);
  // ranked: a write-up about a pick, which pays. Every one here is.
  assert.ok(queue.body.writeups.every(w => w.ranked === true && w.ballot_status === 'submitted' && 'mod_reason' in w));
});

test('moderation: flagged write-ups come first; restore clears the flags until the text changes', async () => {
  const env = envWith();
  await save(env, 3, { picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: 'sdfghj zxcvbn hjklmn ok nice' }, 5: { body: 'A normal write-up with real words.' } } });
  await submit(env, 3);
  await save(env, 6, { picks: picks(4, 5, 7, 8, 9) }); // a draft: not in the queue
  await save(env, 3, { mentions: [9], writeups: { 9: { body: 'A mention: worth a line, pays nothing.' } } }, OPEN + 60);
  const queue = (await call(api.adminQueue, env, { as: 1, path: '/api/top10/admin/queue' })).body;
  assert.deepEqual(queue.writeups.map(w => [w.subject, w.flags, w.ranked]), [[4, ['mash'], true], [9, [], false], [5, [], true]]);
  assert.deepEqual(queue.ballots.find(b => b.voter === 6), { voter: 6, kind: 'year', status: 'draft', updated: queue.ballots.find(b => b.voter === 6).updated, target: 'ballot:6', own: false });
  assert.equal((await act(env, 1, { action: 'restore', target: { voter: 3, subject: 4 } }, OPEN)).body.changed, true);
  assert.deepEqual((await mine(env, 3)).body.ballot.writeups[4].flags, []);
  await save(env, 3, { picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: 'sdfghj zxcvbn hjklmn ok nice' } } });
  assert.deepEqual((await mine(env, 3)).body.ballot.writeups[4].flags, [], 'the same text keeps the mod’s word');
  await save(env, 3, { writeups: { 4: { body: 'sdfghj zxcvbn hjklmn ok nice!!' } } });
  assert.deepEqual((await mine(env, 3)).body.ballot.writeups[4].flags, ['mash'], 'a new text is checked again');
});

test('finalize: admins once voting closed, a dry run first, then once only, with the exact requests for the bot', async () => {
  const env = envWith();
  const full = (seed, ...ids) => Object.fromEntries(ids.map((id, i) => [id, { body: essay(40 + i, seed * 10 + i) }]));
  // 3: a mixed ballot; 4: everyone on it with 40+ words; 5: a struck write-up; 6: none; 7 and 8: lists only.
  await save(env, 3, { picks: picks(1, 2, 4, 5, 6), mentions: [9], writeups: { 1: { body: essay(44, 1) }, 2: { body: 'Twelve words exactly, because the counter says that this is now twelve.' }, 4: { body: 'sdfghj zxcvbn hjklmn real' }, 5: { body: essay(40, 2) }, 9: { body: essay(50, 3) } } });
  await save(env, 4, { picks: picks(1, 2, 3, 5, 6), writeups: full(5, 1, 2, 3, 5, 6) });
  await save(env, 5, { picks: picks(1, 2, 3, 4, 6), writeups: { 1: { body: essay(40, 70) }, 3: { body: 'just filler filler words here' } } });
  await save(env, 6, { picks: picks(1, 2, 3, 4, 5) });
  await save(env, 7, { picks: picks(1, 2, 3, 4, 5) });
  await save(env, 8, { picks: picks(1, 2, 3, 4, 5) });
  for (const voter of [3, 4, 5, 6, 7]) await submit(env, voter);
  // 8 submits and then withdraws: not counted.
  await submit(env, 8);
  await withdraw(env, 8);
  const words = (await mine(env, 3)).body.ballot.writeups;
  assert.equal(words[2].words, 12);
  assert.deepEqual(words[4].flags, ['mash']);
  // Thanks before finalize: 1 thanks 3 (paid), 3 thanks 5 (struck below: not paid), 9 thanks 3 (a mention: paid).
  await thank(env, 1, { voter: 3 });
  await thank(env, 3, { voter: 5 });
  await thank(env, 9, { voter: 3 });
  await act(env, 2, { action: 'strike', target: { voter: 5, subject: 3 }, reason: 'filler' }, OPEN);

  assert.equal((await finalize(env, 5, { year: 2026, dryRun: true })).status, 403);
  assert.equal((await finalize(env, 1, { year: 2026, dryRun: true }, OPEN)).body.code, 'not_closed');
  assert.equal((await finalize(env, 1, { year: 2026 })).body.code, 'shape', 'dryRun must be said');
  assert.equal((await finalize(env, 1, { year: 2025, dryRun: true })).body.code, 'year');

  const dry = await finalize(env, 1, { year: 2026, dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.dryRun, true);
  assert.equal(dry.body.results.year.ballots, 5);
  assert.equal(env.ECONOMY.sqlite.prepare('SELECT COUNT(*) AS n FROM top10_results').get().n, 0, 'a dry run saves nothing');
  assert.equal(env.ECONOMY.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'requests'").get().n === 0
    || env.ECONOMY.sqlite.prepare('SELECT COUNT(*) AS n FROM requests').get().n === 0, true, 'and queues nothing');
  const payload = (writeups, allFull) => ({ year: 2026, kind: 'year', ballot: true, writeups, allFull });
  const expected = [
    { osuId: 3, type: 'top10.payout', payload: payload([{ subject: 1, words: 44 }, { subject: 2, words: 12 }, { subject: 5, words: 40 }], false) },
    { osuId: 4, type: 'top10.payout', payload: payload([{ subject: 1, words: 40 }, { subject: 2, words: 41 }, { subject: 3, words: 42 }, { subject: 5, words: 43 }, { subject: 6, words: 44 }], true) },
    { osuId: 5, type: 'top10.payout', payload: payload([], false) },
    { osuId: 6, type: 'top10.payout', payload: payload([], false) },
    { osuId: 7, type: 'top10.payout', payload: payload([], false) },
    { osuId: 3, type: 'top10.thanks', payload: { year: 2026, kind: 'year', subject: 1 } },
    { osuId: 3, type: 'top10.thanks', payload: { year: 2026, kind: 'year', subject: 9 } },
  ];
  // The answer lists the payouts and the thanks apart; the bot gets them in this order.
  assert.deepEqual(dry.body.payouts, expected.slice(0, 5));
  assert.deepEqual(dry.body.thanks, expected.slice(5));

  // Results stay hidden until the reveal, even once finalized.
  assert.equal((await call(api.results, env, { now: CLOSED, path: '/api/top10/results' })).status, 404);
  const real = await finalize(env, 1, { year: 2026, dryRun: false });
  assert.equal(real.status, 200);
  assert.deepEqual([...real.body.payouts, ...real.body.thanks].map(({ requestId, ...p }) => p), expected);
  assert.ok([...real.body.payouts, ...real.body.thanks].every(p => /^[0-9a-f]{24}$/.test(p.requestId)));
  assert.deepEqual(real.body.results.year, { ...dry.body.results.year, finalizedAt: real.body.results.year.finalizedAt });
  const again = await finalize(env, 2, { year: 2026, dryRun: false });
  assert.deepEqual([again.status, again.body.code], [409, 'already']);
  assert.equal((await finalize(env, 2, { year: 2026, dryRun: true })).status, 409, 'not even a dry run');
  assert.equal(env.ECONOMY.sqlite.prepare('SELECT COUNT(*) AS n FROM requests').get().n, expected.length, 'queued once');
  assert.equal((await call(api.hub, env, { now: CLOSED })).body.finalized, true);

  // After finalize: no more strikes or voids, thanks can't be taken back, and a new one is paid at once (once).
  assert.equal((await act(env, 1, { action: 'strike', target: { voter: 3, subject: 5 }, reason: 'late' })).body.code, 'final');
  assert.equal((await thank(env, 1, { voter: 3, thanked: false }, REVEALED)).body.code, 'final');
  assert.deepEqual((await thank(env, 4, { voter: 3 }, REVEALED)).body, { thanked: true, thanks: 1 });
  assert.deepEqual((await thank(env, 4, { voter: 3, thanked: true }, REVEALED)).body, { thanked: true, thanks: 1 }, 'already thanked: nothing new');
  assert.deepEqual((await thank(env, 2, { voter: 4 }, REVEALED)).body, { thanked: true, thanks: 1 });

  // The bot reads them all through the inbox, unchanged, and acks them.
  const pull = await inboxRoute({ request: new Request(`${BASE}/api/economy/inbox`, { headers: { Authorization: `Bearer ${KEY}` } }), env });
  const { events, cursor } = await pull.json();
  assert.deepEqual(events.map(e => [e.kind, e.osuId, e.data.type, e.data.payload]), [
    ...expected.map(p => ['request', p.osuId, p.type, p.payload]),
    ['request', 3, 'top10.thanks', { year: 2026, kind: 'year', subject: 4 }],
    ['request', 4, 'top10.thanks', { year: 2026, kind: 'year', subject: 2 }],
  ]);
  assert.deepEqual(events[0].data.requestId, real.body.payouts[0].requestId);
  const ack = await ackRoute({ request: new Request(`${BASE}/api/economy/ack`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ cursor, results: [{ requestId: events[0].data.requestId, status: 'accepted' }] }) }), env });
  assert.deepEqual(await ack.json(), { ok: true, updated: 1 });

  // The results: hidden before the reveal, then the finalized JSON.
  const shown = await call(api.results, env, { now: REVEALED, path: '/api/top10/results?year=2026' });
  assert.equal(shown.status, 200);
  assert.match(shown.res.headers.get('Cache-Control'), /public/);
  assert.deepEqual(shown.body, real.body.results.year);
  assert.deepEqual(shown.body.ranking.slice(0, 2).map(r => [r.id, r.rank, r.lists]), [[1, 1, 5], [2, 2, 5]]);
  assert.equal((await call(api.results, env, { now: REVEALED, path: '/api/top10/results?year=2027' })).status, 404);
  assert.equal((await call(api.results, env, { now: REVEALED, path: '/api/top10/results?year=2024' })).status, 404, 'no results that year');
});

test('finalize refuses a turnout under 5, and leaves the year open for a later try', async () => {
  const env = envWith();
  for (const voter of [3, 4, 5, 6]) {
    await save(env, voter, { picks: picks(...[7, 8, 9, 10, 11]) });
    await submit(env, voter);
  }
  const out = await finalize(env, 1, { year: 2026, dryRun: false });
  assert.deepEqual([out.status, out.body.code, out.body.ballots], [409, 'turnout', { year: 4, alltime: 0 }]);
  assert.equal(env.ECONOMY.sqlite.prepare('SELECT COUNT(*) AS n FROM top10_results').get().n, 0);
  assert.equal((await call(api.results, env, { now: REVEALED, path: '/api/top10/results' })).body.code, 'not_published');
});

// ---- Players can't queue top10.* ----------------------------------------------------------------------------------

test('players can never queue top10.* requests themselves', async () => {
  for (const type of ['top10.payout', 'top10.thanks', 'TOP10.payout', 'top10.anything']) {
    assert.match(parseRequest({ type, payload: { year: 2026, ballot: true, writeups: [], allFull: true } }, 3).error, /Top 10/, type);
  }
  const env = envWith();
  const res = await walletRoute({ request: new Request(`${BASE}/api/wallet/request`, { method: 'POST', headers: { Authorization: `Bearer ${await makeSession(SECRET, 3)}` }, body: JSON.stringify({ type: 'top10.payout', payload: { year: 2026 } }) }), env });
  assert.equal(res.status, 400);
  assert.equal(env.ECONOMY.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'requests'").get().n === 0
    || env.ECONOMY.sqlite.prepare('SELECT COUNT(*) AS n FROM requests').get().n === 0, true);
});

test('the site’s top10.* requests don’t count against a player’s own request caps', async () => {
  const env = envWith();
  const spend = async () => (await walletRoute({ request: new Request(`${BASE}/api/wallet/request`, { method: 'POST', headers: { Authorization: `Bearer ${await makeSession(SECRET, 3)}` }, body: JSON.stringify({ type: 'shield', payload: { on: true } }) }), env })).status;
  assert.equal(await spend(), 202);
  // Finalize day for a voter with a payout and 24 thanks, all still waiting for the bot: more than both caps (5, 20).
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date());
  const insert = env.ECONOMY.sqlite.prepare("INSERT INTO requests (id, osu_id, kind, payload, created, day) VALUES (?, 3, ?, '{}', ?, ?)");
  for (let i = 0; i < 25; i++) insert.run(`t${String(i).padStart(23, '0')}`, i ? 'top10.thanks' : 'top10.payout', Math.floor(Date.now() / 1000), today);
  assert.equal(await spend(), 202, 'their own spending still goes through');
});

// ---- Replays (§13.9): the osu! API check, .osr uploads -------------------------------------------------------------

/**
 * A synthetic catch replay, written field by field as the .osr format has it (osr.js's header comment). There's no
 * real one in the repo; this one exercises the same layout, multi-byte ULEB128 lengths and UTF-8 names included.
 */
function osrFile({ mode = 2, md5 = 'c'.repeat(32), player = 'Player6', counts = [900, 20, 300, 0, 5, 2], score = 5000000, combo = 850, perfect = 0,
  mods = 24, lifeBar = '0|1,100|1,'.repeat(40), time = '2026-06-01T20:30:00Z', data = 120, onlineId = 0, version = 20240501, lazer = null, truncate = 0 } = {}) {
  const parts = [];
  const enc = new TextEncoder();
  const u8 = v => parts.push(Uint8Array.of(v));
  const le = (size, set) => { const b = new Uint8Array(size); set(new DataView(b.buffer)); parts.push(b); };
  const u16 = v => le(2, d => d.setUint16(0, v, true));
  const i32 = v => le(4, d => d.setInt32(0, v, true));
  const i64 = v => le(8, d => d.setBigInt64(0, BigInt(v), true));
  const str = s => {
    if (s === '') return u8(0);
    const b = enc.encode(s);
    u8(0x0b);
    let n = b.length;
    do { let byte = n & 0x7f; n >>>= 7; if (n) byte |= 0x80; u8(byte); } while (n);
    parts.push(b);
  };
  u8(mode); i32(version); str(md5); str(player); str('d'.repeat(32));
  counts.forEach(u16); i32(score); u16(combo); u8(perfect); i32(mods); str(lifeBar);
  i64(BigInt(Date.parse(time)) * 10000n + 621355968000000000n);
  i32(data); parts.push(new Uint8Array(data).fill(0x5d)); i64(onlineId);
  if (lazer) { i32(lazer.length); parts.push(lazer); }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return truncate ? all.subarray(0, all.length - truncate) : all;
}

/** A stand-in for an R2 bucket binding: head, put and delete over a Map, with a log. */
function fakeBucket() {
  const objects = new Map();
  const log = [];
  return {
    objects, log,
    head: async key => (objects.has(key) ? { key, size: objects.get(key).bytes.length } : null),
    put: async (key, bytes, options) => { log.push(`put ${key}`); objects.set(key, { bytes: new Uint8Array(bytes), options }); return { key }; },
    delete: async key => { log.push(`delete ${key}`); objects.delete(key); },
  };
}

/** POSTs a showcase entry as multipart/form-data, the way the UI uploads an .osr. */
async function upload(env, as, fields, now = OPEN) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Uint8Array) form.append(key, new Blob([value]), 'play.osr');
    else form.append(key, String(value));
  }
  const request = new Request(`${BASE}/api/top10/plays`, { method: 'POST', headers: { Authorization: `Bearer ${await makeSession(SECRET, as, now)}` }, body: form });
  const res = await api.addPlay(request, env, now);
  return { status: res.status, body: await res.json() };
}

/** A score as osu!'s API answers it with x-api-version 20240529. */
const apiScore = (id, { user = 6, ruleset = 2, ended = '2026-04-02T18:00:00Z', replay = true, legacy = null, beatmap = 777, checksum = 'c'.repeat(32) } = {}) => ({
  id, legacy_score_id: legacy, ruleset_id: ruleset, user_id: user, beatmap_id: beatmap, ended_at: ended, has_replay: replay, passed: true,
  pp: 812.4, accuracy: 0.99515, max_combo: 1820, statistics: { great: 1700, large_tick_hit: 90, small_tick_hit: 400, small_tick_miss: 3, miss: 2 },
  mods: [{ acronym: 'HR' }, { acronym: 'HD' }, { acronym: 'CL' }], rank: 'SH',
  user: { id: user, username: `Player${user}` }, beatmap: { id: beatmap, beatmapset_id: 4242, checksum, version: 'Insane', difficulty_rating: 8.12 },
  beatmapset: { id: 4242, artist: 'Camellia', title: 'Exit This Earth' },
});
/** The card a play made from apiScore shows. */
const apiCard = (ref, { player = 6, map = 777, time = '2026-04-02T18:00:00Z' } = {}) => ({
  ref, player, map, set: 4242, artist: 'Camellia', title: 'Exit This Earth', version: 'Insane', stars: 8.12, pp: 812.4, acc: 99.52, miss: 2,
  combo: 1820, mods: 'HDHR', grade: 'SH', time: at(time), url: scoreUrl(ref),
});
const osuEnv = (extra = {}) => envWith({ OSU_CLIENT_ID: '73866', OSU_URL: OSU, ...extra });

test('the .osr header: every field, a UTF-8 name, long strings, and junk refused', () => {
  const replay = parseOsr(osrFile({ player: 'João Ç', mods: 8 | 16 | 64 | 512, time: '2026-06-01T20:30:00Z', onlineId: 4567890123 }));
  assert.deepEqual({ ...replay, version: undefined }, {
    mode: 2, version: undefined, beatmapMd5: 'c'.repeat(32), player: 'João Ç', replayMd5: 'd'.repeat(32),
    counts: { n300: 900, n100: 20, n50: 300, geki: 0, katu: 5, miss: 2 }, score: 5000000, combo: 850, perfect: false, mods: 600,
    time: at('2026-06-01T20:30:00Z'), onlineId: 4567890123, soloId: null, userId: null, accuracy: 99.43,
  });
  assert.deepEqual(modNames(replay.mods), ['HD', 'HR', 'NC']);
  assert.equal(parseOsr(osrFile({ mode: 0 })).mode, 0, 'other rulesets parse; the API refuses them');
  assert.equal(parseOsr(osrFile({ onlineId: 0 })).onlineId, null);
  for (const [bad, why] of [
    [osrFile({ truncate: 20 }), 'cut short in the replay data'],
    [osrFile().subarray(0, 40), 'cut short in the header'],
    [osrFile({ md5: 'not an md5' }), 'a map hash that isn’t MD5'],
    [osrFile({ player: '' }), 'no player'],
    [osrFile({ time: '1990-01-01T00:00:00Z' }), 'a timestamp from before osu!'],
    [new TextEncoder().encode('{"not":"a replay"}'), 'JSON'],
    [new Uint8Array(0), 'empty'],
  ]) assert.equal(parseOsr(bad), null, why);
  assert.equal(replayFileName({ player: 'Player6', map: { artist: 'Camellia', title: 'Exit/This: Earth?', version: 'Insane' }, time: at('2026-06-01T20:30:00Z') }), 'Player6 - Camellia - ExitThis Earth [Insane] (2026-06-01).osr');
  assert.equal(replayFileName({ player: 'João', map: null, time: at('2026-06-01T20:30:00Z') }), 'João (2026-06-01).osr');
  assert.equal(attachment('João (2026-06-01).osr'), 'attachment; filename="Joao (2026-06-01).osr"; filename*=UTF-8\'\'Jo%C3%A3o%20(2026-06-01).osr');
});

test('osu!’s score answer, read in both formats', () => {
  assert.deepEqual(scoreFromApi(apiScore(9001, { legacy: 555 })), {
    solo: 9001, legacy: 555, ruleset: 2, userId: 6, username: 'Player6', beatmapId: 777, checksum: 'c'.repeat(32),
    map: { set: 4242, artist: 'Camellia', title: 'Exit This Earth', version: 'Insane', stars: 8.12 }, time: at('2026-04-02T18:00:00Z'), hasReplay: true,
    pp: 812.4, acc: 99.52, combo: 1820, miss: 2, mods: 'HDHR', grade: 'SH',
  });
  const old = { id: 555, mode: 'fruits', mode_int: 2, user_id: 6, created_at: '2026-04-02T18:00:00+00:00', replay: false, beatmap: { id: 777 } };
  assert.deepEqual([scoreFromApi(old, { legacyRoute: true }).legacy, scoreFromApi(old, { legacyRoute: true }).solo, scoreFromApi(old).ruleset], [555, null, 2]);
});

test('a score link is checked with the osu! API: one call per entry, the token kept, never on a read', async () => {
  const env = osuEnv();
  osuRoutes['/api/v2/scores/9001'] = apiScore(9001, { legacy: 555 });
  osuRoutes['/api/v2/scores/9002'] = apiScore(9002, { user: 7, replay: false, beatmap: 778 });
  // Player 6 isn't in the exported data at all: osu!'s answer is enough now.
  const first = await addPlay(env, 5, { score: 'https://osu.ppy.sh/scores/9001', caption: 'nobody FCs this' });
  assert.equal(first.status, 201);
  assert.deepEqual({ ...first.body.play, created: undefined }, {
    id: 1, year: 2026, scope: 'year', submitter: 5, player: 6, score_ref: 'osu:9001', beatmap_id: 777, caption: 'nobody FCs this', clip: null, created: undefined,
    played: '2026-04-02T18:00:00Z', endorsements: 0, score: apiCard('osu:9001'), replay: { kind: 'osu', url: 'https://osu.ppy.sh/scores/9001/download' },
  });
  const second = await addPlay(env, 5, { score: '9002' });
  assert.deepEqual([second.status, second.body.play.replay], [201, null], 'osu! keeps no replay of it: no button');
  assert.deepEqual(osuCalls.map(c => c.path), ['/oauth/token', '/api/v2/scores/9001', '/api/v2/scores/9002'], 'one token, one call per entry');
  const tokenCall = new URLSearchParams(osuCalls[0].body);
  assert.deepEqual([tokenCall.get('client_id'), tokenCall.get('grant_type'), tokenCall.get('scope')], ['73866', 'client_credentials', 'public']);
  assert.equal(osuCalls[1].headers.get('Authorization'), 'Bearer app-token');
  assert.equal(osuCalls[1].headers.get('x-api-version'), '20240529');

  // The same score by its legacy link: osu! says it's 9001, already in.
  osuRoutes['/api/v2/scores/fruits/555'] = apiScore(9001, { legacy: 555 });
  const again = await addPlay(env, 8, { score: 'https://osu.ppy.sh/scores/fruits/555' });
  assert.deepEqual([again.status, again.body.code, again.body.id], [409, 'duplicate', 1]);
  const calls = osuCalls.length;
  assert.equal((await addPlay(env, 8, { score: 'https://osu.ppy.sh/scores/9001' })).status, 409);
  assert.equal(osuCalls.length, calls, 'a link already in the showcase doesn’t ask osu!');

  // Reads never ask osu!.
  await call(api.plays, env, { path: '/api/top10/plays' });
  await call(api.plays, env, { as: 5, path: '/api/top10/plays?player=6' });
  assert.equal(osuCalls.length, calls);
  const listed = (await call(api.plays, env, { path: '/api/top10/plays' })).body.plays;
  assert.deepEqual(listed.map(p => [p.id, p.replay?.kind ?? null]), [[1, 'osu'], [2, null]]);
});

test('osu!’s answer decides: catch only, a PT player, this year, the player named; 404s refused; osu! down falls back to the data', async () => {
  const env = osuEnv();
  osuRoutes['/api/v2/scores/1'] = apiScore(1, { ruleset: 0 });
  osuRoutes['/api/v2/scores/2'] = apiScore(2, { user: 999 });
  osuRoutes['/api/v2/scores/3'] = apiScore(3, { ended: '2025-12-31T23:59:00Z' });
  osuRoutes['/api/v2/scores/4'] = apiScore(4, { user: 6 });
  osuRoutes['/api/v2/scores/5000000001'] = 503;
  const refused = async (body, status, code) => {
    const out = await addPlay(env, 5, body);
    assert.deepEqual([out.status, out.body.code], [status, code], `${JSON.stringify(body)} → ${out.body.error}`);
    return out;
  };
  await refused({ score: 'https://osu.ppy.sh/scores/1' }, 422, 'mode');
  await refused({ score: 'https://osu.ppy.sh/scores/2' }, 422, 'not_pt');
  assert.equal((await refused({ score: 'https://osu.ppy.sh/scores/3' }, 422, 'wrong_year')).body.year, 2025);
  assert.equal((await refused({ score: 'https://osu.ppy.sh/scores/4', player: 7 }, 422, 'not_theirs')).body.player, 6);
  assert.match((await refused({ score: 'https://osu.ppy.sh/scores/404404' }, 422, 'not_found')).body.error, /replay \(\.osr\) or a clip/);
  // osu! answers 503: the exported data still knows player 2's score.
  const fallback = await addPlay(env, 5, { score: 'https://osu.ppy.sh/scores/5000000001', player: 2 });
  assert.deepEqual([fallback.status, fallback.body.play.player, fallback.body.play.replay], [201, 2, null]);
});

test('an .osr upload: parsed, checked, stored once by its SHA-256 in R2, and linked from the entry', async () => {
  const noBucket = envWith();
  const replay = osrFile({ player: 'player6' });
  const off = await upload(noBucket, 5, { replay });
  assert.deepEqual([off.status, off.body.code], [503, 'no_replays'], 'uploads need the REPLAYS binding');
  assert.equal((await addPlay(noBucket, 5, { player: 6, clip: 'https://youtu.be/x' })).status, 201, 'everything else works without it');

  const bucket = fakeBucket();
  const env = osuEnv({ REPLAYS: bucket });
  osuRoutes[`/api/v2/beatmaps/lookup?checksum=${'c'.repeat(32)}`] = {
    id: 777, version: 'Insane', checksum: 'c'.repeat(32), difficulty_rating: 8.12, beatmapset: { id: 4242, artist: 'Camellia', title: 'Exit This Earth' },
  };
  const out = await upload(env, 5, { replay, caption: 'offline ScoreV2 run' });
  assert.equal(out.status, 201, out.body.error);
  const sha = [...bucket.objects.keys()][0].slice('replays/'.length, -'.osr'.length);
  assert.match(sha, /^[0-9a-f]{64}$/);
  // The card comes from the replay's header (no pp in a replay) and osu!'s answer about its map.
  assert.deepEqual({ ...out.body.play, created: undefined }, {
    id: 1, year: 2026, scope: 'year', submitter: 5, player: 6, score_ref: null, beatmap_id: 777, caption: 'offline ScoreV2 run', clip: null, created: undefined,
    played: '2026-06-01T20:30:00Z', endorsements: 0,
    score: {
      ref: null, player: 6, map: 777, set: 4242, artist: 'Camellia', title: 'Exit This Earth', version: 'Insane', stars: 8.12, pp: null, acc: 99.43,
      miss: 2, combo: 850, mods: 'HDHR', grade: 'SH', time: at('2026-06-01T20:30:00Z'), url: null,
    },
    replay: { kind: 'file', url: `${DATA}replays/${sha}.osr`, name: 'Player6 - Camellia - Exit This Earth [Insane] (2026-06-01).osr' },
  });
  const stored = bucket.objects.get(`replays/${sha}.osr`);
  assert.deepEqual(stored.bytes, replay);
  assert.equal(stored.options.sha256, sha);
  assert.equal(stored.options.httpMetadata.contentType, 'application/octet-stream');
  assert.match(stored.options.httpMetadata.contentDisposition, /^attachment; filename="Player6 - Camellia - Exit This Earth \[Insane\] \(2026-06-01\)\.osr"/);
  assert.deepEqual(osuCalls.map(c => c.path), ['/oauth/token', `/api/v2/beatmaps/lookup?checksum=${'c'.repeat(32)}`], 'one call for the map');
  const asJson = await addPlay(env, 5, { replay: 'T1NSIGJ5dGVz' });
  assert.deepEqual([asJson.status, asJson.body.code], [400, 'shape'], 'a replay comes as a file, never in JSON');

  // The same file again, by anyone: refused, and not stored twice.
  for (const as of [5, 8]) {
    const twin = await upload(env, as, { replay });
    assert.deepEqual([twin.status, twin.body.code, twin.body.id], [409, 'duplicate', 1]);
  }
  assert.deepEqual(bucket.log, [`put replays/${sha}.osr`]);
  // A file already in R2 (say, from an entry since removed and re-added) isn't put again.
  const other = osrFile({ player: 'Player7', time: '2026-07-01T10:00:00Z' });
  bucket.objects.set('replays/placeholder', { bytes: other });
  const second = await upload(env, 5, { replay: other });
  assert.equal(second.status, 201);
  assert.equal(bucket.log.length, 2);

  // Refusals: not catch, not a replay, too big, not a PT player, another year, a player named who isn't the replay's.
  const refused = async (fields, status, code) => {
    const res = await upload(env, 8, fields);
    assert.deepEqual([res.status, res.body.code], [status, code], `${code}: ${res.body.error}`);
  };
  await refused({ replay: osrFile({ mode: 0, player: 'Player9' }) }, 400, 'mode');
  await refused({ replay: new TextEncoder().encode('not a replay at all') }, 400, 'osr');
  await refused({ replay: new Uint8Array(MAX_REPLAY_BYTES + 1) }, 413, 'too_big');
  await refused({ replay: osrFile({ player: 'SomeoneElse' }) }, 422, 'not_pt');
  await refused({ replay: osrFile({ player: 'Player9', time: '2025-12-30T10:00:00Z' }) }, 422, 'wrong_year');
  await refused({ replay: osrFile({ player: 'Player9', time: '2026-02-02T10:00:00Z' }), player: 10 }, 422, 'not_theirs');

  // The entry's submitter removes it: the file goes too, since nothing else uses it.
  const del = await call(api.deletePlay, env, { as: 5, method: 'DELETE', path: '/api/top10/plays/1', id: '1' });
  assert.equal(del.status, 200);
  assert.ok(!bucket.objects.has(`replays/${sha}.osr`));
});

test('an .osr with a score link must be that score’s; osu!’s own replay is linked first', async () => {
  const bucket = fakeBucket();
  const env = osuEnv({ REPLAYS: bucket });
  osuRoutes['/api/v2/scores/9100'] = apiScore(9100, { replay: false });
  osuRoutes['/api/v2/scores/9101'] = apiScore(9101, { replay: true, beatmap: 779, checksum: 'e'.repeat(32) });
  osuRoutes['/api/v2/scores/9102'] = apiScore(9102, { user: 7 });
  const both = await upload(env, 5, { score: 'https://osu.ppy.sh/scores/9100', replay: osrFile({ player: 'Player6' }) });
  assert.equal(both.status, 201, both.body.error);
  assert.deepEqual([both.body.play.score_ref, both.body.play.score, both.body.play.replay.kind], ['osu:9100', apiCard('osu:9100'), 'file'], 'osu! keeps none, so the upload is the link');
  const kept = await upload(env, 8, { score: 'https://osu.ppy.sh/scores/9101', replay: osrFile({ player: 'Player6', md5: 'e'.repeat(32), time: '2026-04-03T10:00:00Z' }) });
  assert.deepEqual([kept.status, kept.body.play.replay], [201, { kind: 'osu', url: 'https://osu.ppy.sh/scores/9101/download' }]);
  const wrongMap = await upload(env, 5, { score: 'https://osu.ppy.sh/scores/9102', replay: osrFile({ player: 'Player6', md5: 'f'.repeat(32) }) });
  assert.deepEqual([wrongMap.status, wrongMap.body.code], [422, 'replay_mismatch']);
  assert.equal(osuCalls.filter(c => c.path.startsWith('/api/v2/beatmaps')).length, 0, 'the score call gives the map: no lookup');
});

/**
 * The score info lazer appends to its replays, for score 9300 by player 6 (online_id, user_id, mods, statistics…),
 * framed as lazer writes it: "LZMA alone" with the real size in the header. Made with Python's lzma module
 * (FORMAT_ALONE, lc 3, lp 0, pb 2, a 2 MiB dictionary, as lazer's encoder sets).
 */
const LAZER_INFO_9300 = Uint8Array.from(Buffer.from('XQAAIABXAQAAAAAAAAA9iInnI/ZsWfQmC3pS+6ZC8OWj+IIQ88PMUZNzZvQYRAbw+uo+e/4ZmsT/uhtFzxyvE/fh1aJZbFi2rFuBuYL50WUmUm6PdbvyY1gZ3ivej9eI0zpiJ8PSotCS4PLAHS0slvku7sP1yJkcXY1gTquXx21VertY/u6YR0W81WWMXpCwzBtVmLfjGD8HClsAK/O9JGNuaijSvHA3k13GBcP4IgeBr9owW//YT0S7iNVbhZsnyEQYD3fZbOrx/z15UJ858wobBCm4tJXzAppvaBG2yd/+6eTm', 'base64'));
/** A replay as lazer writes it: its own version, -1 in the legacy id field, then the score info. */
const lazerOsr = (extra = {}) => osrFile({ version: 30000016, onlineId: -1, lazer: LAZER_INFO_9300, ...extra });

test('lazer replays: the score id is in the score info they append (LZMA), not in the legacy id field', () => {
  const info = JSON.parse(new TextDecoder().decode(lzmaDecode(LAZER_INFO_9300)));
  assert.deepEqual([info.online_id, info.user_id, info.client_version], [9300, 6, '2026.1101.0-lazer']);
  const osr = parseOsr(lazerOsr());
  assert.deepEqual([osr.mode, osr.player, osr.onlineId, osr.soloId, osr.userId], [2, 'Player6', null, 9300, 6]);
  const stable = parseOsr(osrFile({ onlineId: 555 }));
  assert.deepEqual([stable.onlineId, stable.soloId, stable.userId], [555, null, null]);
  // Score info that doesn't read leaves a replay with no ids; it's only read from lazer's versions.
  const cut = parseOsr(lazerOsr({ lazer: LAZER_INFO_9300.slice(0, 40) }));
  assert.deepEqual([cut?.mode, cut?.soloId, cut?.onlineId], [2, null, null]);
  assert.equal(parseOsr(osrFile({ lazer: LAZER_INFO_9300 })).soloId, null);
  // The decoder refuses junk, a cut stream and more than it may give.
  assert.equal(lzmaDecode(new Uint8Array(40).fill(7)), null);
  assert.equal(lzmaDecode(LAZER_INFO_9300.subarray(0, 60)), null);
  assert.equal(lzmaDecode(LAZER_INFO_9300, { maxOut: 100 }), null);
});

test('a replay osu! keeps isn’t stored: a link with its .osr, or an .osr whose score osu! has; otherwise the file is kept', async () => {
  const bucket = fakeBucket();
  const env = osuEnv({ REPLAYS: bucket });
  const row = id => env.ECONOMY.sqlite.prepare('SELECT replay_sha, replay_name, refs, has_replay FROM top10_plays WHERE id = ?').get(id);

  // A link with its .osr, and osu! keeps the replay: the file is checked, then the entry links to osu!'s, no copy.
  osuRoutes['/api/v2/scores/9200'] = apiScore(9200, { replay: true });
  const file = osrFile({ player: 'Player6', time: '2026-04-02T18:00:00Z' });
  const linked = await upload(env, 5, { score: 'https://osu.ppy.sh/scores/9200', replay: file });
  assert.equal(linked.status, 201, linked.body.error);
  assert.deepEqual([linked.body.replay, linked.body.play.replay], ['osu', { kind: 'osu', url: 'https://osu.ppy.sh/scores/9200/download' }]);
  assert.deepEqual(bucket.log, []);
  assert.deepEqual([row(1).replay_sha, row(1).replay_name, row(1).has_replay], [null, null, 1]);
  osuRoutes['/api/v2/scores/9201'] = apiScore(9201, { replay: true });
  assert.equal((await upload(env, 5, { score: '9201', replay: osrFile({ player: 'Player7' }) })).body.code, 'replay_mismatch', 'still checked');
  // The same file alone (no score id in it, and no copy) is still the same play: known by its SHA-256.
  const again = await upload(env, 8, { replay: file });
  assert.deepEqual([again.status, again.body.code, again.body.id], [409, 'duplicate', 1]);

  // A lazer .osr alone, naming score 9300, which osu! has with its replay: that score's entry, pp and all; no copy.
  osuRoutes['/api/v2/scores/9300'] = apiScore(9300, { replay: true, ended: '2026-05-05T12:00:00Z' });
  let calls = osuCalls.length;
  const lazer = await upload(env, 9, { replay: lazerOsr({ time: '2026-05-05T12:00:00Z' }), caption: 'from lazer' });
  assert.equal(lazer.status, 201, lazer.body.error);
  assert.deepEqual({ ...lazer.body.play, id: undefined, created: undefined }, {
    id: undefined, year: 2026, scope: 'year', submitter: 9, player: 6, score_ref: 'osu:9300', beatmap_id: 777, caption: 'from lazer', clip: null, created: undefined,
    played: '2026-05-05T12:00:00Z', endorsements: 0, score: apiCard('osu:9300', { time: '2026-05-05T12:00:00Z' }),
    replay: { kind: 'osu', url: 'https://osu.ppy.sh/scores/9300/download' },
  });
  assert.equal(lazer.body.replay, 'osu');
  assert.deepEqual(osuCalls.slice(calls).map(c => c.path), ['/api/v2/scores/9300'], 'one call: the score gives the map');
  assert.deepEqual(bucket.log, []);
  // The same score again, by its file or its link: refused before osu! is asked.
  calls = osuCalls.length;
  assert.equal((await upload(env, 8, { replay: lazerOsr({ time: '2026-05-05T12:00:00Z' }) })).body.code, 'duplicate');
  assert.equal((await addPlay(env, 8, { score: 'https://osu.ppy.sh/scores/9300' })).body.code, 'duplicate');
  assert.equal(osuCalls.length, calls);

  // A stable .osr alone with its legacy id, and osu! has the score but no replay: the score's entry, and the file kept.
  osuRoutes['/api/v2/scores/fruits/555'] = apiScore(9400, { legacy: 555, replay: false });
  const stable = await upload(env, 10, { replay: osrFile({ player: 'Player6', onlineId: 555, time: '2026-04-02T18:00:00Z' }) });
  assert.equal(stable.status, 201, stable.body.error);
  assert.deepEqual([stable.body.replay, stable.body.play.score_ref, stable.body.play.score.pp, stable.body.play.replay.kind], ['kept', 'osu:9400', 812.4, 'file']);
  const kept = row(stable.body.play.id);
  assert.deepEqual([JSON.parse(kept.refs), kept.has_replay], [['osu:9400', 'legacy:555'], 0]);
  assert.deepEqual(bucket.log, [`put replays/${kept.replay_sha}.osr`]);
  assert.equal((await addPlay(env, 8, { score: 'https://osu.ppy.sh/scores/fruits/555' })).body.code, 'duplicate');

  // An id naming another player's score, or one on another map, is refused; and osu!'s date decides the year.
  osuRoutes['/api/v2/scores/fruits/556'] = apiScore(9401, { legacy: 556, user: 7 });
  osuRoutes['/api/v2/scores/fruits/557'] = apiScore(9402, { legacy: 557, checksum: 'e'.repeat(32) });
  osuRoutes['/api/v2/scores/fruits/558'] = apiScore(9403, { legacy: 558, ended: '2025-12-30T10:00:00Z' });
  assert.equal((await upload(env, 5, { replay: osrFile({ player: 'Player6', onlineId: 556 }) })).body.code, 'replay_mismatch');
  assert.equal((await upload(env, 5, { replay: osrFile({ player: 'Player6', onlineId: 557 }) })).body.code, 'replay_mismatch');
  assert.equal((await upload(env, 5, { replay: osrFile({ player: 'Player6', onlineId: 558 }) })).body.code, 'wrong_year');

  // No id, no such score on osu!, or osu! down: the file is the entry and is stored, as before, in two calls at most.
  const md5 = 'a'.repeat(32);
  osuRoutes[`/api/v2/beatmaps/lookup?checksum=${md5}`] = { id: 780, version: 'Hard', difficulty_rating: 5, beatmapset: { id: 4243, artist: 'A', title: 'T' } };
  osuRoutes['/api/v2/scores/fruits/600'] = 503;
  for (const [i, [onlineId, why]] of [[0, 'no id'], [601, 'no such score on osu!'], [600, 'osu! down']].entries()) {
    calls = osuCalls.length;
    const put = bucket.log.length;
    const res = await upload(env, [7, 11, 12][i], { replay: osrFile({ player: 'Player9', md5, onlineId }) });
    assert.equal(res.status, 201, `${why}: ${res.body.error}`);
    assert.deepEqual([res.body.replay, res.body.play.replay.kind, res.body.play.score_ref, res.body.play.score.pp, res.body.play.beatmap_id], ['kept', 'file', null, null, 780], why);
    assert.equal(bucket.log.length, put + 1, why);
    assert.ok(osuCalls.length - calls <= 2, `${why}: ${osuCalls.length - calls} calls`);
    assert.equal((await upload(env, 8, { replay: osrFile({ player: 'Player9', md5, onlineId }) })).body.code, 'duplicate', `${why}: by its SHA-256`);
  }
});

test('your own entry: edit its caption and clip while the showcase is open; only yours', async () => {
  const env = envWith();
  const patch = (as, id, body, now = OPEN) => call(api.editPlay, env, { as, now, method: 'PATCH', path: `/api/top10/plays/${id}`, id: String(id), body });
  const added = await addPlay(env, 5, { score: 'https://osu.ppy.sh/scores/5000000001', player: 2, caption: 'first try' });
  assert.equal(added.status, 201, added.body.error);
  const id = added.body.play.id;
  const edited = await patch(5, id, { caption: '  the  first PT FC  ' });
  assert.deepEqual([edited.status, edited.body.play.caption, edited.body.play.score_ref], [200, 'the first PT FC', 'osu:5000000001']);
  const withClip = await patch(5, id, { clip: 'https://youtu.be/abc' });
  assert.deepEqual([withClip.body.play.caption, withClip.body.play.clip], ['the first PT FC', 'https://youtu.be/abc'], 'a field left out is kept');
  assert.equal((await patch(5, id, { clip: '' })).body.play.clip, null, 'a score entry can drop its clip');
  assert.equal((await patch(5, id, { caption: null })).body.play.caption, '');
  // Before voting opens, the showcase is already open; after the close, it isn't.
  assert.equal((await patch(5, id, { caption: 'early' }, BEFORE)).status, 200);
  assert.deepEqual([(await patch(5, id, { caption: 'late' }, CLOSED)).body.code], ['closed']);
  // Refusals: someone else's, no such entry, too long, not a clip site.
  assert.deepEqual([(await patch(7, id, { caption: 'mine now' })).status, (await patch(7, id, { caption: 'x' })).body.code], [403, 'not_yours']);
  assert.equal((await patch(5, 999, { caption: 'x' })).status, 404);
  assert.equal((await patch(5, id, { caption: 'x'.repeat(281) })).body.code, 'too_long');
  assert.equal((await patch(5, id, { clip: 'https://evil.example/youtube.com' })).body.code, 'clip');
  // A clip-only entry is its clip: it can change, not go.
  const clip = await addPlay(env, 5, { player: 6, clip: 'https://youtu.be/one' });
  assert.equal((await patch(5, clip.body.play.id, { clip: '' })).body.code, 'clip_needed');
  assert.equal((await patch(5, clip.body.play.id, { clip: 'https://streamable.com/two' })).body.play.clip, 'https://streamable.com/two');
  // The listing shows the edit.
  const listed = (await call(api.plays, env, { path: '/api/top10/plays' })).body.plays.find(p => p.id === id);
  assert.equal(listed.caption, 'early');
});

test('a replay uploaded to the Legendary plays lands there (multipart carries the scope)', async () => {
  const env = envWith({ REPLAYS: fakeBucket() });
  const out = await upload(env, 5, { scope: 'alltime', replay: osrFile({ player: 'Player9', time: '2021-06-01T10:00:00Z' }) });
  assert.equal(out.status, 201, out.body.error);
  assert.equal(out.body.play.scope, 'alltime');
});

// ---- Past editions (§13.10) ---------------------------------------------------------------------------------------

/** A history file as top10/history/<edition>.json has it, with a voter from outside PT and an oddly numbered list. */
const EDITION = {
  edition: '2023-24',
  label: '2023–24',
  thread: 'https://osu.ppy.sh/community/forums/topics/1',
  ballots: [
    { voter: 1, post: 'https://osu.ppy.sh/community/forums/posts/11', picks: picks(2, 3, 4, 5, 6), mentions: [7], watch: [8] },
    { voter: 2, post: 'https://osu.ppy.sh/community/forums/posts/12', picks: picks(1, 3, 4, 6, 5), mentions: [7], watch: [] },
    // tartaruga57-style: "8. A / B … 9. C" kept as written.
    { voter: 999, post: 'https://osu.ppy.sh/community/forums/posts/13', notes: 'not a PT player', picks: [...picks(1, 2, 3, 4, 5, 6, 7), { id: 8, spot: 8 }, { id: 9, spot: 8 }, { id: 10, spot: 9 }] },
  ],
};

test('past editions: year keys, the file check, and the same score.js whatever the turnout', () => {
  assert.deepEqual(['2025', '2023-24', '2023–24', 2020, 'next year'].map(editionYear), [2025, 2024, 2024, 2020, null]);
  const { errors, warnings } = checkEdition(EDITION);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ballot 3 .*1, 2, 3, 4, 5, 6, 7, 8, 8, 9/);

  const results = pastResults(EDITION, { importedAt: '2026-11-08T00:00:00Z', names: new Map([[1, 'Tris'], [999, 'Patatita']]) });
  assert.deepEqual([results.year, results.edition, results.label, results.past, results.ballots], [2024, '2023-24', '2023–24', true, 3]);
  const of = id => results.ranking.find(r => r.id === id);
  // Player 1 voted, so only 2 of the 3 lists could name them: (10 + 10) / 2.
  assert.deepEqual([of(1).points, of(1).eligible, of(1).score, of(1).rank], [20, 2, 10, 1]);
  // 8 and 9 share spot 8 on the forum list, covering 8 and 9: (3 + 2) / 2 each; 10 at its written 9 gets 2.
  assert.deepEqual([of(8).points, of(9).points, of(10).points], [2.5, 2.5, 2]);
  assert.equal(of(7).mentions, 2);
  assert.deepEqual(results.watch, [{ id: 8, count: 1 }]);

  // One list (2020 had only Tris's) is still an edition; so are four (2023–24).
  const single = pastResults({ edition: '2020', label: '2020', ballots: [EDITION.ballots[0]] });
  assert.deepEqual([single.year, single.ballots, single.ranking[0].id, single.ranking[0].score], [2020, 1, 2, 10]);
  assert.equal(pastResults({ edition: 2024, ballots: [...EDITION.ballots, { voter: 2, picks: picks(3, 4, 5, 6, 7) }] }).ballots, 4);
  // More than 10 picks (tartaruga57's 2023–24 list: 11 names numbered to 10, spots 8, 8, 10, 11): past 10 scores 0,
  // but the player is still on the list. The live limit of 10 doesn't apply here.
  const eleven = { voter: 50, post: 'p', picks: [...picks(1, 2, 3, 4, 5, 6, 7), { id: 8, spot: 8 }, { id: 9, spot: 8 }, { id: 10, spot: 10 }, { id: 11, spot: 11 }] };
  assert.deepEqual(checkEdition({ edition: 2024, ballots: [eleven] }), { errors: [], warnings: [] });
  const long = pastResults({ edition: 2024, ballots: [eleven] });
  const in11 = id => long.ranking.find(r => r.id === id);
  assert.deepEqual([in11(10).points, in11(11)], [1, undefined], '#11 gets 0 points, so no ranking line');
  // Names, for every id the edition names, from the map given (the import's: the index, then ALIASES.md).
  assert.deepEqual(results.names, { 1: 'Tris', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 999: 'Patatita' }, 'no name given: the number');
  assert.deepEqual(pastResults(EDITION, { names: new Map([[2, 'Hiroto-']]) }).names[2], 'Hiroto-');
  // The forum posts come along, as written.
  assert.deepEqual(results.lists.map(l => [l.voter, l.post, l.picks.length, l.notes ?? null]), [
    [1, 'https://osu.ppy.sh/community/forums/posts/11', 5, null], [2, 'https://osu.ppy.sh/community/forums/posts/12', 5, null],
    [999, 'https://osu.ppy.sh/community/forums/posts/13', 10, 'not a PT player'],
  ]);
  // A broken file isn't imported.
  const broken = { edition: '2022', ballots: [{ voter: 1, picks: [{ id: 1, spot: 1 }, { id: 'Hiroto-', spot: 2 }] }] };
  assert.equal(checkEdition(broken).errors.length, 2, 'a voter on their own list, and a name instead of an id');
  assert.throws(() => pastResults(broken), /2022/);
});

test('past editions are served by GET /api/top10/results and listed on the hub', async () => {
  const env = envWith();
  const editions = [pastResults(EDITION, { importedAt: '2026-11-08T00:00:00Z' }), pastResults({ edition: '2020', label: '2020', ballots: [EDITION.ballots[0]] })];
  env.ECONOMY.sqlite.exec(pastSql(editions, { importedAt: at('2026-11-08T00:00:00Z') }));
  env.ECONOMY.sqlite.exec(pastSql(editions.slice(0, 1))); // run again: it replaces, never doubles
  const served = await call(api.results, env, { now: OPEN, path: '/api/top10/results?year=2024' });
  assert.equal(served.status, 200);
  assert.deepEqual([served.body.label, served.body.edition, served.body.past, served.body.ranking[0].id], ['2023–24', '2023-24', true, 1]);
  assert.equal((await call(api.results, env, { now: OPEN, path: '/api/top10/results?year=2021' })).body.code, 'not_published');
  assert.deepEqual((await call(api.hub, env, { now: OPEN })).body.editions, [{ year: 2024, kind: 'year', label: '2023–24' }, { year: 2020, kind: 'year', label: '2020' }]);
  assert.equal(env.ECONOMY.sqlite.prepare('SELECT COUNT(*) AS n FROM top10_results').get().n, 2);
});

test('ALIASES.md’s tables give current names (the "Today" column, or the voter’s where there’s none)', () => {
  const md = [
    '## Please confirm', '', '| As written (where) | osu! id | Today | Evidence | Confidence |', '|---|---|---|---|---|',
    '| **Tuga** (2022 Tris) | — | — | Not identified. | — |',
    '| **anomi** (2025) | 24642612 | anomi | **Post link:** … | High |', '',
    '## Settled', '', '| As written | osu! id | Today | Evidence |', '|---|---|---|---|',
    '| **GoncS**, Goncs | 19423459 | **_wb** | **Profile:** previous name GoncS. |',
    '| Hiroto-, -Hiroto | 14917517 | suzuhiro77 | … |', '| uwu | 2788013 | Airdown | … |', '| Air, Airdown | 2788013 | Airdown | … |', '',
    '## Voters from outside Portugal', '', '| Voter | osu! id | Country (today) | Edition |', '|---|---|---|---|',
    '| Ritmo Brigido | 5124924 | Chile | 2021 |', '| [ Ajia ] | 17578266 | Belgium | 2025 |',
  ].join('\n');
  assert.deepEqual([...namesFromAliases(md)], [[24642612, 'anomi'], [19423459, '_wb'], [14917517, 'suzuhiro77'], [2788013, 'Airdown'], [5124924, 'Ritmo Brigido'], [17578266, '[ Ajia ]']]);
});

// The real editions (top10/history/, on the history branch until it's merged; TOP10_HISTORY_DIR points elsewhere).
const HISTORY = process.env.TOP10_HISTORY_DIR ? new URL(`file:///${process.env.TOP10_HISTORY_DIR.replace(/\\/g, '/').replace(/\/?$/, '/')}`) : new URL('./history/', import.meta.url);
const edition = name => JSON.parse(fs.readFileSync(new URL(name, HISTORY), 'utf8'));
const historyHere = fs.existsSync(new URL('2025.json', HISTORY)) ? false : 'top10/history/ isn’t here yet';
test('past editions: 2025 comes out as the history import found (§13.10, with GoncS as a voter)', { skip: historyHere }, () => {
  const results = pastResults(edition('2025.json'));
  // Hiroto- 10.00, anomi 8.63 (2nd on #1s), ExPin 8.63, GoncS 7.00 (voted as _wb, so 56 ÷ 8: §13.10's 6.22 was wrong),
  // AfonsoMPt 6.78, Rosa 5.56, AlexFenom 4.25, DemiGod Yoxide 3.13, Leo5h 3.00, TRUE_PLAYER36 2.25, Nelson 1.00 in 11th.
  assert.deepEqual(results.ranking.slice(0, 11).map(r => [r.id, r.rank, r.score]), [
    [14917517, 1, 10], [24642612, 2, 8.63], [16935754, 3, 8.63], [19423459, 4, 7], [13294871, 5, 6.78], [7385703, 6, 5.56],
    [20942650, 7, 4.25], [6205809, 8, 3.13], [26323728, 9, 3], [10067533, 10, 2.25], [4095868, 11, 1],
  ]);
  assert.equal(results.ballots, 9);
});
test('past editions: 2020–2024 come out as the history import’s check does', { skip: historyHere }, () => {
  const top = (file, n) => pastResults(edition(file)).ranking.slice(0, n).map(r => [r.rank, r.score]);
  assert.deepEqual(top('2020.json', 3), [[1, 10], [2, 9], [3, 8]]);
  assert.deepEqual(top('2021.json', 13), [[1, 9.6], [2, 9.5], [3, 7.5], [4, 6.67], [5, 6.4], [6, 5.8], [7, 5], [8, 2.33], [9, 2.33], [10, 1.83], [11, 1.83], [12, 0.5], [13, 0.17]]);
  assert.deepEqual(top('2022.json', 12), [[1, 10], [2, 8.2], [3, 8], [4, 6.2], [5, 6.17], [6, 5.8], [7, 5.58], [8, 4.25], [9, 1], [10, 0.5], [11, 0.33], [12, 0.17]]);
  const y2024 = pastResults(edition('2024.json'));
  assert.deepEqual([y2024.year, y2024.label, y2024.ballots], [2024, '2023–24', 4]);
  assert.deepEqual(y2024.ranking.map(r => [r.rank, r.score]), [[1, 10], [2, 9.33], [3, 8.5], [4, 7.67], [5, 6.25], [6, 6], [7, 4.25], [8, 4.13], [9, 2.88], [10, 2], [11, 0.5], [12, 0.25], [13, 0.13]]);
});

// ---- The all-time ballot (§13.11) ---------------------------------------------------------------------------------

const ALL = { kind: 'alltime' };
const saveAll = (env, as, body, now = OPEN) => save(env, as, { ...ALL, ...body }, now);
const submitAll = (env, as, now = OPEN) => call(api.submitBallot, env, { as, now, method: 'POST', path: '/api/top10/ballot/submit', body: ALL });
const withdrawAll = (env, as, now = OPEN) => call(api.withdrawBallot, env, { as, now, method: 'POST', path: '/api/top10/ballot/withdraw', body: ALL });
const mineAll = (env, as, now = OPEN) => call(api.myBallot, env, { as, now, path: '/api/top10/ballot?kind=alltime' });
const feedAll = (env, now = OPEN) => call(api.ballots, env, { now, path: '/api/top10/ballots?kind=alltime' });
const hubOf = async (env, as, now = OPEN) => (await call(api.hub, env, { as, now })).body;

test('the all-time ballot: its own, beside the yearly one; mentions yes, ones to watch no', async () => {
  const env = envWith();
  assert.equal((await save(env, 3, { picks: picks(4, 5, 6, 7, 8), watch: [9] })).status, 200);
  const all = await saveAll(env, 3, { picks: picks(1, 2, 4, 5, 6), mentions: [7], writeups: { 1: { body: 'The first legend of them all.' } } });
  assert.equal(all.status, 200, all.body.error);
  assert.deepEqual([all.body.ballot.kind, all.body.ballot.status, all.body.ballot.mentions, all.body.ballot.watch], ['alltime', 'draft', [7], []]);
  const watch = await saveAll(env, 3, { watch: [9] });
  assert.deepEqual([watch.status, watch.body.code], [400, 'no_watch']);
  const bad = await save(env, 3, { kind: 'forever', picks: picks(4, 5, 6, 7, 8) });
  assert.deepEqual([bad.status, bad.body.code], [400, 'kind']);
  assert.deepEqual((await saveAll(env, 4, { picks: picks(4, 5, 6, 7, 8) })).body.code, 'self', 'never yourself, as on the yearly ballot');
  assert.deepEqual((await saveAll(env, 4, { picks: picks(5, 6, 7, 8, 999) })).body.code, 'not_pt');
  // ?kind= works on a write too.
  const byQuery = await call(api.saveBallot, env, { as: 5, method: 'PUT', path: '/api/top10/ballot?kind=alltime', body: { picks: picks(1, 2) } });
  assert.equal(byQuery.body.ballot.kind, 'alltime');

  // Each ballot is read, submitted and withdrawn on its own.
  assert.deepEqual((await mine(env, 3)).body.ballot.picks.map(p => p.id), [4, 5, 6, 7, 8]);
  const mineAllTime = (await mineAll(env, 3)).body;
  assert.deepEqual([mineAllTime.kind, mineAllTime.ballot.picks.map(p => p.id), mineAllTime.ballot.writeups[1].words], ['alltime', [1, 2, 4, 5, 6], 6]);
  assert.equal((await call(api.myBallot, env, { as: 3, path: '/api/top10/ballot?kind=nope' })).status, 400);
  assert.equal((await submitAll(env, 3)).body.ballot.status, 'submitted');
  assert.equal((await mine(env, 3)).body.ballot.status, 'draft', 'the yearly ballot is still a draft');
  assert.deepEqual((await submitAll(env, 6)).body.code, 'no_ballot');

  let hub = await hubOf(env, 3);
  assert.deepEqual([hub.turnout, hub.turnouts], [0, { year: 0, alltime: 1 }]);
  assert.deepEqual([hub.me.ballot.kind, hub.me.ballot.status, hub.me.ballots.alltime.status], ['year', 'draft', 'submitted']);
  assert.deepEqual(hub.me.ballot, hub.me.ballots.year, 'me.ballot stays the yearly one');
  assert.deepEqual((await hubOf(env, 6)).me.ballots, { year: null, alltime: null });

  const feedAllTime = (await feedAll(env)).body;
  assert.deepEqual([feedAllTime.kind, feedAllTime.ballots.map(b => [b.voter, b.kind])], ['alltime', [[3, 'alltime']]]);
  assert.deepEqual((await feed(env)).body.ballots, [], 'the yearly feed has none');
  assert.equal((await call(api.ballots, env, { path: '/api/top10/ballots?kind=x' })).status, 400);

  await submit(env, 3);
  hub = await hubOf(env);
  assert.deepEqual([hub.turnout, hub.turnouts], [1, { year: 1, alltime: 1 }]);
  assert.equal((await withdrawAll(env, 3)).body.ballot.status, 'draft');
  hub = await hubOf(env);
  assert.deepEqual([hub.turnout, hub.turnouts], [1, { year: 1, alltime: 0 }]);
});

test('all-time cites may be any year’s play; the yearly ballot’s map refs stay in the season', async () => {
  const env = envWith();
  // Player 2's only play on map 113 was set on 31 Dec 2025.
  const body = { picks: picks(2, 4, 5, 6, 7), writeups: { 2: { body: 'That last night of 2025.', cites: ['map:113'] } } };
  const yearly = await save(env, 3, body);
  assert.deepEqual([yearly.status, yearly.body.code, yearly.body.ref], [400, 'cite', 'map:113:2']);
  const all = await saveAll(env, 3, body);
  assert.equal(all.status, 200, all.body.error);
  assert.deepEqual(all.body.ballot.writeups[2].cites, ['map:113:2']);
  assert.deepEqual([all.body.ballot.scores['map:113:2'].map, all.body.ballot.scores['map:113:2'].time], [113, at('2025-12-31T23:00:00Z')]);
});

test('the same text on both your ballots is flagged as a copy on the later one, so it pays once', async () => {
  const env = envWith();
  const text = essay(40, 50);
  await save(env, 3, { picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: text } } });
  const all = await saveAll(env, 3, { picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: text } } });
  assert.deepEqual(all.body.ballot.writeups[4].flags, ['copy']);
  assert.deepEqual((await mine(env, 3)).body.ballot.writeups[4].flags, []);
});

test('Legendary plays: any year, 10 each with at most 5 of your own, apart from the yearly showcase', async () => {
  const env = envWith();
  const refused = await addPlay(env, 5, { score: '5000000002', player: 2 });
  assert.deepEqual([refused.status, refused.body.code], [422, 'wrong_year']);
  const legend = await addPlay(env, 5, { scope: 'alltime', score: '5000000002', player: 2, caption: 'the last FC of 2025' });
  assert.equal(legend.status, 201, legend.body.error);
  assert.deepEqual([legend.body.play.scope, legend.body.play.year, legend.body.play.played], ['alltime', 2026, '2025-12-31T23:00:00Z']);
  assert.deepEqual((await addPlay(env, 7, { scope: 'alltime', score: 'map:113:2' })).body.code, 'duplicate', 'the same play by its map ref');
  // The same play can be in both: they're separate lists.
  assert.equal((await addPlay(env, 5, { score: '5000000001', player: 2 })).status, 201);
  assert.equal((await addPlay(env, 9, { scope: 'alltime', score: '5000000001', player: 2 })).status, 201);
  assert.deepEqual((await addPlay(env, 5, { scope: 'forever', player: 6, clip: 'https://youtu.be/x' })).body.code, 'scope');

  const listed = async (path, as) => (await call(api.plays, env, { as, path })).body;
  const legendary = await listed('/api/top10/plays?scope=alltime');
  assert.deepEqual([legendary.scope, legendary.plays.map(p => [p.id, p.scope])], ['alltime', [[1, 'alltime'], [3, 'alltime']]]);
  assert.deepEqual((await listed('/api/top10/plays')).plays.map(p => p.id), [2]);
  assert.equal((await call(api.plays, env, { path: '/api/top10/plays?scope=x' })).status, 400);
  // Endorsing a legendary play marks it with its scope.
  const endorsed = await call(api.endorse, env, { as: 8, method: 'POST', path: '/api/top10/plays/1/endorse', id: '1' });
  assert.deepEqual(endorsed.body, { endorsed: true, endorsements: 1 });
  assert.equal(env.ECONOMY.sqlite.prepare("SELECT kind FROM top10_marks WHERE mark = 'endorse'").get().kind, 'alltime');
  assert.deepEqual((await listed('/api/top10/plays?scope=alltime', 8)).plays.map(p => [p.id, p.endorsed]), [[1, true], [3, false]]);

  // Limits: 5 of your own, 10 in all, counted apart from the yearly showcase's.
  for (let i = 0; i < 5; i++) assert.equal((await addPlay(env, 4, { scope: 'alltime', score: String(4000000000 + i) })).status, 201);
  assert.deepEqual((await addPlay(env, 4, { scope: 'alltime', score: String(4000000005) })).body.code, 'own_limit');
  for (let i = 0; i < 5; i++) assert.equal((await addPlay(env, 4, { scope: 'alltime', player: 6 + i, clip: `https://youtu.be/${i}` })).status, 201);
  const over = await addPlay(env, 4, { scope: 'alltime', player: 11, clip: 'https://youtu.be/more' });
  assert.deepEqual([over.status, over.body.code], [429, 'limit']);
  assert.match(over.body.error, /10 entries in the Legendary plays/);
  assert.equal((await addPlay(env, 4, { score: String(4000000005) })).status, 201, 'the yearly showcase counts on its own');
});

test('finalize does both kinds; one under 5 ballots stays unpublished, pays nothing, and doesn’t block the other', async () => {
  const env = envWith();
  for (const voter of [3, 4, 5, 6, 7]) {
    await save(env, voter, { picks: picks(10, 11, 12, 13, 14) });
    await submit(env, voter);
  }
  for (const voter of [3, 4]) {
    await saveAll(env, voter, { picks: picks(10, 11, 12, 13, 14), writeups: { 10: { body: essay(40, voter) } } });
    await submitAll(env, voter);
  }
  const dry = await finalize(env, 1, { year: 2026, dryRun: true });
  assert.equal(dry.status, 200);
  assert.deepEqual([dry.body.results.year.kind, dry.body.results.year.ballots, dry.body.results.alltime], ['year', 5, null]);
  assert.deepEqual(dry.body.unpublished, [{ kind: 'alltime', ballots: 2 }]);
  assert.deepEqual(dry.body.payouts.map(p => [p.osuId, p.payload.kind]), [[3, 'year'], [4, 'year'], [5, 'year'], [6, 'year'], [7, 'year']]);
  assert.deepEqual(dry.body.thanks, []);
  const real = await finalize(env, 1, { year: 2026, dryRun: false });
  assert.equal(real.status, 200);
  assert.deepEqual(real.body.unpublished, [{ kind: 'alltime', ballots: 2 }]);
  assert.deepEqual(env.ECONOMY.sqlite.prepare('SELECT year, kind FROM top10_results').all().map(r => [r.year, r.kind]), [[2026, 'year']]);
  assert.equal(env.ECONOMY.sqlite.prepare("SELECT COUNT(*) AS n FROM requests WHERE json_extract(payload, '$.kind') = 'alltime'").get().n, 0);
  // Once only: the all-time results can't be published later.
  assert.equal((await finalize(env, 1, { year: 2026, dryRun: false })).body.code, 'already');
  const missing = await call(api.results, env, { now: REVEALED, path: '/api/top10/results?kind=alltime' });
  assert.deepEqual([missing.status, missing.body.code], [404, 'not_published']);
  assert.deepEqual((await hubOf(env, undefined, REVEALED)).editions, [{ year: 2026, kind: 'year', label: '2026' }]);
  // The unpublished kind isn't final, so the mods can still act on it; the published one is.
  assert.equal((await act(env, 1, { action: 'void', target: 'ballot:alltime:3', reason: 'test' })).body.changed, true);
  assert.equal((await act(env, 1, { action: 'void', target: 'ballot:3', reason: 'test' })).body.code, 'final');

  // Only the all-time ballot with 5: it's published alone. Neither: 409 turnout.
  const other = envWith();
  for (const voter of [3, 4, 5, 6, 7]) {
    await saveAll(other, voter, { picks: picks(10, 11, 12, 13, 14) });
    await submitAll(other, voter);
  }
  const alone = await finalize(other, 1, { year: 2026, dryRun: true });
  assert.deepEqual([alone.body.results.year, alone.body.results.alltime.kind, alone.body.unpublished], [null, 'alltime', [{ kind: 'year', ballots: 0 }]]);
  const none = await finalize(envWith(), 1, { year: 2026, dryRun: true });
  assert.deepEqual([none.status, none.body.code, none.body.ballots], [409, 'turnout', { year: 0, alltime: 0 }]);
});

test('finalize does both kinds: the all-time results and payouts carry kind, and later thanks are paid per kind', async () => {
  const env = envWith();
  for (const voter of [3, 4, 5, 6, 7]) {
    await save(env, voter, { picks: picks(11, 12, 13, 14, 15), writeups: voter === 3 ? { 11: { body: essay(41, 1) } } : {} });
    await submit(env, voter);
    const writeups = { 3: { 10: { body: essay(40, 2) } }, 5: { 11: { body: essay(45, 3) } } }[voter] ?? {};
    await saveAll(env, voter, { picks: picks(10, 11, 12, 13, 14), writeups });
    await submitAll(env, voter);
  }
  // 10 thanks 3's all-time write-up before finalize; 11 thanks 3's yearly one.
  assert.deepEqual((await thank(env, 10, { ...ALL, voter: 3 })).body, { thanked: true, thanks: 1 });
  assert.equal((await thank(env, 10, { voter: 3 })).status, 404, 'there’s no yearly write-up about 10');
  await thank(env, 11, { voter: 3 });
  const thanksOf = async kind => (await call(api.ballots, env, { as: 10, path: `/api/top10/ballots?kind=${kind}` })).body.ballots.find(b => b.voter === 3);
  assert.deepEqual([(await thanksOf('alltime')).thanks, (await thanksOf('alltime')).writeups[10].thanked], [1, true]);

  const real = await finalize(env, 1, { year: 2026, dryRun: false });
  assert.equal(real.status, 200);
  assert.deepEqual([real.body.results.year.kind, real.body.results.alltime.kind, real.body.unpublished], ['year', 'alltime', []]);
  const payload = (kind, writeups) => ({ year: 2026, kind, ballot: true, writeups, allFull: false });
  assert.deepEqual(real.body.payouts.map(({ requestId, ...p }) => p), [
    { osuId: 3, type: 'top10.payout', payload: payload('year', [{ subject: 11, words: 41 }]) },
    ...[4, 5, 6, 7].map(osuId => ({ osuId, type: 'top10.payout', payload: payload('year', []) })),
    { osuId: 3, type: 'top10.payout', payload: payload('alltime', [{ subject: 10, words: 40 }]) },
    { osuId: 4, type: 'top10.payout', payload: payload('alltime', []) },
    { osuId: 5, type: 'top10.payout', payload: payload('alltime', [{ subject: 11, words: 45 }]) },
    ...[6, 7].map(osuId => ({ osuId, type: 'top10.payout', payload: payload('alltime', []) })),
  ]);
  assert.deepEqual(real.body.thanks.map(({ requestId, ...p }) => p), [
    { osuId: 3, type: 'top10.thanks', payload: { year: 2026, kind: 'year', subject: 11 } },
    { osuId: 3, type: 'top10.thanks', payload: { year: 2026, kind: 'alltime', subject: 10 } },
  ]);
  assert.deepEqual(env.ECONOMY.sqlite.prepare('SELECT kind FROM top10_results ORDER BY kind').all().map(r => r.kind), ['alltime', 'year']);

  // The results: each kind at its own address, from the reveal.
  assert.equal((await call(api.results, env, { now: CLOSED, path: '/api/top10/results?kind=alltime' })).body.code, 'not_yet');
  const shown = await call(api.results, env, { now: REVEALED, path: '/api/top10/results?year=2026&kind=alltime' });
  assert.deepEqual([shown.status, shown.body.kind, shown.body.ranking[0].id], [200, 'alltime', 10]);
  assert.deepEqual((await call(api.results, env, { now: REVEALED, path: '/api/top10/results?year=2026' })).body.ranking[0].id, 11);
  assert.equal((await call(api.results, env, { now: REVEALED, path: '/api/top10/results?kind=x' })).status, 400);
  assert.deepEqual((await hubOf(env, undefined, REVEALED)).editions, [{ year: 2026, kind: 'year', label: '2026' }, { year: 2026, kind: 'alltime', label: '2026' }]);

  // A thanks after finalize is queued at once, with its kind; it can't be taken back.
  assert.deepEqual((await thank(env, 11, { ...ALL, voter: 5 }, REVEALED)).body, { thanked: true, thanks: 1 });
  assert.equal((await thank(env, 11, { ...ALL, voter: 5, thanked: false }, REVEALED)).body.code, 'final');
  const late = env.ECONOMY.sqlite.prepare("SELECT osu_id, payload FROM requests WHERE kind = 'top10.thanks' ORDER BY created DESC, rowid DESC").get();
  assert.deepEqual([late.osu_id, JSON.parse(late.payload)], [5, { year: 2026, kind: 'alltime', subject: 11 }]);
  assert.deepEqual((await thank(env, 11, { ...ALL, voter: 5, thanked: true }, REVEALED)).body, { thanked: true, thanks: 1 });
  assert.equal(env.ECONOMY.sqlite.prepare("SELECT COUNT(*) AS n FROM requests WHERE kind = 'top10.thanks'").get().n, 3, 'a second click queues nothing');
});

test('moderation tells the ballots apart: writeup:alltime:… and ballot:alltime:…', async () => {
  const env = envWith();
  await save(env, 3, { picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: 'Four, this year.' } } });
  await submit(env, 3);
  await saveAll(env, 3, { picks: picks(4, 5, 6, 7, 8), writeups: { 4: { body: 'Four, of all time.' } } });
  await submitAll(env, 3);
  const queue = async path => (await call(api.adminQueue, env, { as: 1, path })).body;
  const both = await queue('/api/top10/admin/queue');
  assert.deepEqual(both.writeups.map(w => [w.kind, w.target]).sort(), [['alltime', 'writeup:alltime:3:4'], ['year', 'writeup:3:4']]);
  assert.deepEqual(both.ballots.map(b => [b.kind, b.target]).sort(), [['alltime', 'ballot:alltime:3'], ['year', 'ballot:3']]);
  assert.deepEqual((await queue('/api/top10/admin/queue?kind=alltime')).writeups.map(w => w.target), ['writeup:alltime:3:4']);
  assert.equal((await call(api.adminQueue, env, { as: 1, path: '/api/top10/admin/queue?kind=x' })).status, 400);

  assert.equal((await act(env, 1, { action: 'strike', target: 'writeup:alltime:3:4', reason: 'off topic' }, OPEN)).body.changed, true);
  assert.deepEqual([(await mineAll(env, 3)).body.ballot.writeups[4].mod, (await mine(env, 3)).body.ballot.writeups[4].mod], ['struck', 'ok']);
  assert.equal((await act(env, 1, { action: 'restore', kind: 'alltime', target: { voter: 3, subject: 4 } }, OPEN)).body.changed, true);
  assert.equal((await act(env, 1, { action: 'restore', kind: 'year', target: 'writeup:alltime:3:4' }, OPEN)).body.code, 'kind', 'they mustn’t disagree');
  assert.equal((await act(env, 1, { action: 'void', target: 'ballot:alltime:3', reason: 'duplicate account' }, OPEN)).body.changed, true);
  assert.deepEqual((await hubOf(env)).turnouts, { year: 1, alltime: 0 });
  assert.deepEqual((await mine(env, 3)).body.log.map(l => [l.kind, l.action, l.target]), [
    ['alltime', 'void', 'ballot:alltime:3'], ['alltime', 'restore', 'writeup:alltime:3:4'], ['alltime', 'strike', 'writeup:alltime:3:4'],
  ]);
  assert.equal((await saveAll(env, 3, { intro: 'hi' })).body.code, 'void');
  assert.equal((await save(env, 3, { intro: 'hi' })).status, 200, 'the yearly ballot isn’t void');
});

/** An all-time list as top10/history/alltime-<year>.json has it. */
const ALLTIME_EDITION = {
  kind: 'alltime', edition: 2020, label: 'All time (2020)', thread: 'https://osu.ppy.sh/community/forums/topics/2',
  ballots: [
    { voter: 1, post: 'https://osu.ppy.sh/community/forums/posts/21', picks: picks(2, 3, 4, 5, 6), mentions: [7], watch: [] },
    { voter: 2, post: 'https://osu.ppy.sh/community/forums/posts/22', picks: picks(1, 3, 4, 6, 5) },
  ],
};

test('past all-time lists: kind alltime, no ones to watch, served at ?kind=alltime beside the year’s', async () => {
  assert.deepEqual(checkEdition(ALLTIME_EDITION).errors, []);
  const watching = { ...ALLTIME_EDITION, ballots: [{ ...ALLTIME_EDITION.ballots[0], watch: [8] }] };
  assert.match(checkEdition(watching).errors.join(), /no ones to watch/);
  assert.match(checkEdition({ ...ALLTIME_EDITION, kind: 'forever' }).errors.join(), /kind "forever"/);
  const all = pastResults(ALLTIME_EDITION, { importedAt: '2026-11-08T00:00:00Z' });
  assert.deepEqual([all.year, all.kind, all.label, all.past, all.ballots], [2020, 'alltime', 'All time (2020)', true, 2]);
  const yearly = pastResults({ edition: '2020', label: '2020', ballots: [EDITION.ballots[0]] });
  assert.equal(yearly.kind, 'year');

  const env = envWith();
  await hubOf(env); // the tables as the site makes them first: the import's SQL must fit them
  env.ECONOMY.sqlite.exec(pastSql([yearly, all]));
  env.ECONOMY.sqlite.exec(pastSql([all])); // again: it replaces, never doubles
  assert.equal(env.ECONOMY.sqlite.prepare('SELECT COUNT(*) AS n FROM top10_results').get().n, 2);
  const got = async path => (await call(api.results, env, { now: OPEN, path })).body;
  assert.deepEqual([(await got('/api/top10/results?year=2020')).kind, (await got('/api/top10/results?year=2020')).label], ['year', '2020']);
  const served = await got('/api/top10/results?year=2020&kind=alltime');
  assert.deepEqual([served.kind, served.label, served.thread, served.ranking[0].id], ['alltime', 'All time (2020)', 'https://osu.ppy.sh/community/forums/topics/2', 1]);
  assert.deepEqual((await hubOf(env)).editions, [{ year: 2020, kind: 'year', label: '2020' }, { year: 2020, kind: 'alltime', label: 'All time (2020)' }]);
});

const allTimeHere = fs.existsSync(new URL('alltime-2020.json', HISTORY)) ? false : 'top10/history/alltime-2020.json isn’t here yet';
test('past editions: the 2020 all-time thread comes out as the history import found (§13.11)', { skip: allTimeHere }, () => {
  const results = pastResults(edition('alltime-2020.json'));
  assert.deepEqual([results.year, results.kind, results.ballots], [2020, 'alltime', 7]);
  // Buffow 9.86, Tris 8.67, Airdown 8.17, gold801 7.57, PTrollYO 6.14, SoulEater 5.33, DemiGod Yoxide 4.67, Rosa 2.67,
  // [SS]Bell 2.29, Sp1ritGG 1.57.
  assert.deepEqual(results.ranking.slice(0, 10).map(r => [r.id, r.rank, r.score]), [
    [4427038, 1, 9.86], [3821475, 2, 8.67], [2788013, 3, 8.17], [3006672, 4, 7.57], [6502093, 5, 6.14], [1267642, 6, 5.33],
    [6205809, 7, 4.67], [7385703, 8, 2.67], [2600197, 9, 2.29], [1700805, 10, 1.57],
  ]);
});
