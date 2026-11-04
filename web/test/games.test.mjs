// node --test web/test/games.test.mjs
// The Games page drawn in Node from an export (PTCATCH_DATA=<folder>, as web/test/packs.test.mjs finds it; skipped
// without), each game's first view in both languages, and each game's rules against the old page's
// (assets/js/pages/games.js, which needs a browser to load, so its pure parts are copied here as they were, with its
// Math.random as a seeded generator): the daily map and its options, the daily streak, practice's deck and rounds, the
// quizzes' maps and answers from the search pack against search-maps.json, and Higher or lower's rounds and answers
// from the core pack against players.json. The same dice give the same games.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore, readSearch } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { firstData, CORE, SEARCH } from '../src/routes.ts';
import * as lore from '../src/ui/lore.ts';
import { shuffle } from '../src/ui/fun.ts';
import {
  ROUNDS, STATS, dailyRecord, dailyRound, gameOf, hiloRight, hiloRound, lisbonDay, playedToday, practiceDeck, quizAnswer,
  quizDeck, quizMode, quizPool, render, roundOptions, title,
} from '../src/views/games.ts';
import { decodeSearchMaps } from '../../assets/js/core/maps-search.js';
import * as oldLore from '../../assets/js/core/lore.js';
import { PT } from '../../assets/js/core/pt.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const pack = name => {
  const bytes = fs.readFileSync(path.join(dir, 'packs', name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const ctxFor = (lang, now = 1.8e9) => {
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me: null };
};

/** A small seeded random generator (mulberry32): the same numbers each run. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- The old page's rules, as they were (games.js), over a given random source ----------------------------------------
const oldShuffle = (list, rnd) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const oldPick = (list, rnd) => list[Math.floor(rnd() * list.length)];
const OLD_QUIZ = {
  convert: { pool: rows => rows.filter(r => r[3] && r[7] >= 3 && (r[6] === 'c' || r[6] === 'r')), answer: r => r[6] },
  dose: {
    pool: rows => rows.filter(r => r[3] && r[7] >= 2 && (/\boverdose\b/i.test(r[4]) !== /\brain\b/i.test(r[4]))),
    answer: r => (/\boverdose\b/i.test(r[4]) ? 'overdose' : 'rain'),
  },
};
const OLD_STATS = [p => p.cv, p => p.ul, p => p.pp, p => p.firsts.c + p.firsts.u + p.firsts.r, p => p.plays];
function oldRoundPair(list, a, rnd) {
  let stat;
  for (let tries = 0; tries < 50; tries++) {
    stat = oldPick(OLD_STATS, rnd);
    const pool = list.filter(p => stat(p) > 0);
    const first = a && stat(a) > 0 ? a : oldPick(pool, rnd);
    const second = oldPick(pool.filter(p => p !== first && stat(p) !== stat(first)), rnd);
    if (first && second) return { stat, a: first, b: second };
  }
  return { stat, a: list[0], b: list[1] };
}
function oldNoteDaily(saved, today, yesterday, tried) {
  const won = tried > 0;
  const streak = won ? (saved.last === yesterday || saved.last === today ? saved.streak : 0) + (saved.last === today ? 0 : 1) : 0;
  return { last: today, streak, best: Math.max(streak, saved.best || 0), result: tried };
}

test('the games’ addresses and their first data', () => {
  assert.deepEqual(firstData('/games'), { packs: [CORE], json: [] });
  assert.deepEqual(firstData('/games/'), { packs: [CORE], json: [] });
  assert.deepEqual(firstData('/games/guess'), { packs: [], json: ['quiz.json'] });
  assert.deepEqual(firstData('/games/guess', '?mode=practice'), { packs: [], json: ['quiz.json'] });
  assert.deepEqual(firstData('/games/daily'), { packs: [], json: ['quiz.json'] });
  assert.deepEqual(firstData('/games/quiz', '?mode=dose'), { packs: [SEARCH], json: [] });
  assert.deepEqual(firstData('/games/higher-lower'), { packs: [CORE], json: [] });
  assert.deepEqual(firstData('/games/nope'), { packs: [CORE], json: [] }, 'any other game is the hub');
  assert.equal(firstData('/games/quiz/2'), null);
  // The old page's choice of game (games.js default export).
  const cases = [[{}, {}, 'hub'], [{ game: 'guess' }, {}, 'daily'], [{ game: 'guess' }, { mode: 'practice' }, 'practice'],
    [{ game: 'guess' }, { mode: 'daily' }, 'daily'], [{ game: 'daily' }, { mode: 'practice' }, 'daily'], [{ game: 'quiz' }, {}, 'quiz'],
    [{ game: 'higher-lower' }, {}, 'hilo'], [{ game: 'Quiz' }, {}, 'hub'], [{ game: 'x' }, {}, 'hub']];
  for (const [params, query, game] of cases) assert.equal(gameOf(params, query), game, JSON.stringify([params, query]));
  for (const [mode, want] of [[undefined, 'convert'], ['convert', 'convert'], ['dose', 'dose'], ['constructor', 'convert'], ['DOSE', 'convert']]) {
    assert.equal(quizMode({ mode }), want, String(mode));
  }
  assert.deepEqual(lore.BOSS_SETS, oldLore.BOSS_SETS);
  assert.equal(lore.TUGA_SET, oldLore.TUGA_SET);
});

test('shuffle and the daily streak, as the old page kept them', () => {
  for (let seed = 1; seed < 40; seed++) {
    const list = Array.from({ length: seed }, (_, i) => i);
    assert.deepEqual(shuffle(list, random(seed)), oldShuffle(list, random(seed)));
  }
  const days = ['2026-11-01', '2026-11-02', '2026-11-03'];
  const saves = [{ last: null, streak: 0, best: 0, result: null }, { last: days[0], streak: 4, best: 9, result: 2 },
    { last: days[1], streak: 4, best: 4, result: 1 }, { last: days[2], streak: 5, best: 5, result: 3 }, { last: days[2], streak: 0, best: 7, result: 0 },
    { last: days[1], streak: 2 }];
  for (const saved of saves) {
    for (const tried of [0, 1, 2, 3]) assert.deepEqual(dailyRecord(saved, days[2], days[1], tried), oldNoteDaily(saved, days[2], days[1], tried));
  }
  const d = (saved, today = days[2]) => ({ game: 'daily', today, yesterday: days[1], saved });
  assert.equal(playedToday(d(saves[3])), 3);
  assert.equal(playedToday(d(saves[4])), 0);
  assert.equal(playedToday(d(saves[2])), null);
  assert.equal(playedToday(d({ last: days[2], streak: 1 })), 0, 'a record from before results: played, as the old page took it');
  assert.equal(lisbonDay(Date.UTC(2026, 6, 1, 22, 59)), '2026-07-01');
  assert.equal(lisbonDay(Date.UTC(2026, 6, 1, 23, 0)), '2026-07-02', 'Lisbon is an hour ahead in summer');
  assert.equal(lisbonDay(Date.UTC(2026, 11, 1, 23, 59)), '2026-12-01');
});

test('Guess the map: the daily map and its options, and practice’s deck and rounds, as the old page dealt them', { skip }, () => {
  const { sets } = json('quiz.json');
  for (let k = 0; k < 60; k++) {
    const day = lisbonDay(Date.UTC(2026, 0, 1) + k * 86400000);
    const { answer, options } = dailyRound(sets, day, random(k));
    // The old dailyGame(): the answer by the day alone, five others from the same 300, the six shuffled.
    const pool = sets.slice(0, 300);
    const oldAnswer = oldLore.pick(pool, `daily:${day}`);
    const rnd = random(k);
    const oldOptions = oldShuffle([oldAnswer, ...oldShuffle(pool.filter(s => s[0] !== oldAnswer[0] && s[2] !== oldAnswer[2]), rnd).slice(0, 5)], rnd);
    assert.equal(answer, oldAnswer, day);
    assert.deepEqual(options, oldOptions, day);
    assert.equal(dailyRound(sets, day, random(k + 1000)).answer, answer, 'the same map for everyone that day');
    assert.equal(new Set(options.map(s => s[0])).size, 6);
  }
  for (let k = 0; k < 30; k++) {
    for (const tugaShown of [false, true]) {
      const rnd = random(k);
      const { deck, special } = practiceDeck(sets, tugaShown, rnd);
      const first = roundOptions(deck, deck[0], rnd);
      // The old guessGame(): the deck, the tuga round, the boss, then start()'s options.
      const old = random(k);
      const oldDeck = oldShuffle(sets.filter(s => !oldLore.BOSS_SETS.includes(s[0]) && s[0] !== oldLore.TUGA_SET), old);
      const tuga = sets.find(s => s[0] === oldLore.TUGA_SET);
      if (tuga && !tugaShown) oldDeck.splice(2 + Math.floor(old() * 6), 0, tuga);
      const bosses = sets.filter(s => oldLore.BOSS_SETS.includes(s[0]));
      if (bosses.length) oldDeck.splice(ROUNDS - 1, 0, oldPick(bosses, old));
      const current = oldDeck[0];
      const others = oldShuffle(oldDeck.filter(s => s[0] !== current[0] && s[2] !== current[2]), old).slice(0, 3);
      assert.deepEqual(deck, oldDeck);
      assert.deepEqual(first, oldShuffle([current, ...others], old));
      if (bosses.length) assert.equal(special.get(deck[ROUNDS - 1][0]), 'boss', 'the boss is the last round');
      if (tuga && !tugaShown) assert.ok(deck.slice(2, 8).includes(tuga) && special.get(tuga[0]) === 'tuga', 'the tuga round is in rounds 3–8');
      assert.ok(first.includes(deck[0]) && first.length === 4);
    }
  }
});

test('the map quizzes: the same maps from the search pack as from search-maps.json, and the same answers', { skip }, () => {
  const search = readSearch(pack('search.ptcb'));
  const rows = decodeSearchMaps(json('search-maps.json'));
  for (const mode of ['convert', 'dose']) {
    const pool = quizPool(search, mode);
    const oldPool = OLD_QUIZ[mode].pool(rows);
    assert.deepEqual(pool.map(i => search.maps.id[i]), oldPool.map(r => r[0]), `${mode}: the same maps in the same order`);
    assert.ok(pool.length >= 10, mode);
    for (let k = 0; k < 20; k++) {
      const deck = quizDeck(search, mode, random(k));
      const oldDeck = oldShuffle(oldPool, random(k)).slice(0, 10);
      assert.deepEqual(deck.map(c => [c.set, c.artist, c.title, c.version, c.stars, c.cat]), oldDeck.map(r => [r[1], r[2], r[3], r[4], r[5], r[6]]), `${mode} deck ${k}`);
      deck.forEach((card, i) => assert.equal(quizAnswer(mode, card), OLD_QUIZ[mode].answer(oldDeck[i])));
    }
  }
});

test('Higher or lower: the same rounds from the core pack as from players.json, and the same answers', { skip }, () => {
  const core = readCore(pack('core.ptcb'));
  const list = json('players.json');
  const players = core.players;
  for (let row = 0; row < players.rows; row++) {
    STATS.forEach((stat, i) => assert.equal(stat.value(players, row), OLD_STATS[i](list[row]) ?? 0, `${list[row].name}, stat ${i}`));
  }
  for (let k = 0; k < 40; k++) {
    const rnd = random(k), old = random(k);
    let round = null, oldRound = null;
    // A run of rounds, the second player staying on as the next round's first, as Continue does.
    for (let step = 0; step < 6; step++) {
      round = hiloRound(players, round ? round.b : null, rnd);
      oldRound = oldRoundPair(list, oldRound ? oldRound.b : null, old);
      assert.deepEqual([round.stat, round.a, round.b], [OLD_STATS.indexOf(oldRound.stat), list.indexOf(oldRound.a), list.indexOf(oldRound.b)], `run ${k}, round ${step}`);
      const higher = oldRound.stat(oldRound.b) > oldRound.stat(oldRound.a);
      assert.equal(hiloRight(players, round, true), higher);
      assert.equal(hiloRight(players, round, false), !higher);
    }
  }
});

test('each game’s first view, drawn in Node in both languages', { skip }, () => {
  const core = readCore(pack('core.ptcb'));
  const search = readSearch(pack('search.ptcb'));
  const { sets } = json('quiz.json');
  const today = '2026-11-04', yesterday = '2026-11-03';
  const paidDay = (done, solved) => ({
    day: today, options: sets.slice(0, 6).map(([, artist, title]) => ({ artist, title })), tries: done ? 2 : 1, triesLeft: done ? 1 : 2,
    guesses: done ? [0, 3] : [0], solved, done, cover: `/api/daily/cover?day=${today}`,
    ...(done ? { answer: { index: 3, setId: sets[3][0], artist: sets[3][1], title: sets[3][2], mapper: sets[3][3] } } : {}),
  });
  const deck = practiceDeck(sets, false, random(1));
  const games = {
    hub: { game: 'hub', core, records: { guessBest: 12, hiloBest: 3, daily: { last: today, streak: 2, best: 2, result: 1 }, quizBest: 7 } },
    'hub, nothing played': { game: 'hub', core, records: { guessBest: null, hiloBest: null, daily: null, quizBest: null } },
    daily: { game: 'daily', today, yesterday, ...dailyRound(sets, today, random(2)), saved: { last: yesterday, streak: 4, best: 4, result: 2 }, signInHere: true },
    'daily, played': { game: 'daily', today, yesterday, ...dailyRound(sets, today, random(2)), saved: { last: today, streak: 5, best: 5, result: 2 }, signInHere: false },
    paid: { game: 'paid', day: paidDay(false, false), streak: 3 },
    'paid, solved': { game: 'paid', day: paidDay(true, true), streak: 4 },
    practice: { game: 'practice', ...deck, options: roundOptions(deck.deck, deck.deck[0], random(3)) },
    'practice, too few sets': { game: 'practice', deck: [], special: new Map(), options: [] },
    convert: { game: 'quiz', mode: 'convert', deck: quizDeck(search, 'convert', random(4)) },
    dose: { game: 'quiz', mode: 'dose', deck: quizDeck(search, 'dose', random(5)) },
    'quiz, no maps': { game: 'quiz', mode: 'dose', deck: [] },
    hilo: { game: 'hilo', core, round: hiloRound(core.players, null, random(6)), best: 9 },
  };
  const count = (page, pattern) => (page.match(pattern) ?? []).length;
  for (const lang of ['en', 'pt']) {
    const ctx = ctxFor(lang);
    for (const [name, data] of Object.entries(games)) {
      const page = String(render(ctx, data));
      assert.ok(title(ctx, data), name);
      assert.doesNotMatch(page, /\{\w+\}|undefined|NaN|\[object /, `${lang} ${name}: nothing left unfilled`);
      if (name.startsWith('hub')) {
        assert.equal(count(page, /class="card card-link"/g), 3);
        assert.equal(count(page, /class="avatar avatar-md"/g), 2, 'the rivals');
      } else if (name.startsWith('daily') || name.startsWith('paid')) {
        assert.equal(count(page, /class="option[^"]*" type="button" data-i=/g), 6, name);
        assert.equal(count(page, /id="share"/g), name.includes(',') ? 1 : 0, name);
      } else if (name === 'practice') {
        assert.equal(count(page, /data-i="/g), 4);
        assert.match(page, /style="filter:blur\(26px\) saturate\(1\.2\)"/);
      } else if (name === 'convert' || name === 'dose') {
        assert.equal(count(page, /data-pick="/g), 2, name);
        assert.match(page, /<b>1<small>\/10<\/small><\/b>/);
      } else if (name === 'hilo') {
        assert.equal(count(page, /class="duel-card"/g), 2);
        assert.equal(count(page, /data-guess="/g), 2);
      } else {
        assert.match(page, /^\s*<div class="empty">/, name);
      }
    }
  }
});
