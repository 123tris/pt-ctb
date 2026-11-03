// node --test tools/lib/duels.test.mjs
// Duels: what the exporter copies from the bot's Duels/ files (field by field, osu! ids only), the ladder, the duel
// pages, a duelist's profile slice and the Activity feed's results; and the folder being read, or not there at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { duelsBlock, duelCopy, liveCopy, duelMapIds } from './duels.mjs';
import { duelFile, DUEL_PROVISIONAL_RD as PROVISIONAL_RD } from '../../assets/js/core/model.js';
import { loadDuels } from './source.mjs';

const ON_SITE = new Set([1, 2, 3, 4]);
const known = id => ON_SITE.has(id);
const DISCORD = '209017408016318464';

const side = (osuId, points, before = 1500, after = before + (points >= 3 ? 12 : -12)) => ({
  osuId, name: `p${osuId}`, points, ratingBefore: before, ratingAfter: after, rdAfter: 180, discordId: DISCORD,
});
const score = (osuId, s, passed = true) => ({ osuId, score: s, acc: 98.123, combo: 500, misses: 1, passed, discordId: DISCORD });
const round = (n, winner, extra = {}) => ({
  n, beatmapId: 1000 + n, stars: 6.123, winner, void: null,
  scores: [score(1, winner === 1 ? 900000 : 800000), score(2, winner === 2 ? 900000 : 800000)], ...extra,
});
const duel = (id, extra = {}) => ({
  id, code: `AB${id}`, ranked: true, bestOf: 5, status: 'finished',
  startedAt: `2026-11-0${id}T20:00:00Z`, endedAt: `2026-11-0${id}T20:30:00Z`, matchId: 118000000 + id,
  stars: { min: 5.9, max: 6.9 }, wager: 50, winner: 1, threadId: DISCORD, channelId: DISCORD,
  players: [side(1, 3), side(2, 1)],
  rounds: [round(1, 1), round(2, 2), round(3, null, { void: 'Wrong map' }), round(4, 1), round(5, 1)],
  ...extra,
});

test('no Duels folder: nothing', () => {
  assert.deepEqual(duelsBlock(null, known), { file: null, pages: {}, profiles: new Map(), mapIds: [], events: [], summary: null });
});

test('a duel is copied field by field: osu! ids, never Discord ids or anything the bot adds', () => {
  const copy = duelCopy(duel(1, { secret: 'x' }), known);
  assert.deepEqual(Object.keys(copy).sort(), ['bestOf', 'code', 'end', 'id', 'mp', 'players', 'ranked', 'rounds', 'stars', 'start', 'status', 'wager', 'winner']);
  assert.deepEqual(copy.players[0], { u: 1, name: 'p1', pts: 3, before: 1500, after: 1512, rd: 180 });
  assert.deepEqual(copy.rounds[0].scores[0], { u: 1, score: 900000, acc: 98.12, combo: 500, miss: 1, pass: true });
  assert.equal(copy.start, Date.UTC(2026, 10, 1, 20) / 1000);
  assert.deepEqual(copy.stars, [5.9, 6.9]);
  // A void round has its reason and no winner, even if the bot named one.
  assert.deepEqual([copy.rounds[2].winner, copy.rounds[2].void], [null, 'Wrong map']);
  assert.ok(!JSON.stringify(copy).includes(DISCORD));
});

test('cancelled duels, unknown statuses, restricted or untracked players and odd shapes are left out', () => {
  assert.equal(duelCopy(duel(1, { status: 'cancelled' }), known), null);
  assert.equal(duelCopy(duel(1, { status: 'weird' }), known), null);
  assert.equal(duelCopy(duel(1, { players: [side(1, 3), side(9, 1)] }), known), null); // 9: not on the site
  assert.equal(duelCopy(duel(1, { players: [side(1, 3)] }), known), null);
  assert.equal(duelCopy(duel(1, { players: [side(1, 3), side(1, 1)] }), known), null);
  assert.equal(duelCopy(duel(1, { id: '7' }), known), null);
  // A score by someone else in the lobby isn't the duel's.
  const crowded = duelCopy(duel(1, { rounds: [{ ...round(1, 1), scores: [score(1, 5), score(3, 9), score(2, 4)] }] }), known);
  assert.deepEqual(crowded.rounds[0].scores.map(s => s.u), [1, 2]);
});

test('unranked and abandoned duels carry no rating change; an abandoned one has no winner, ranked or not', () => {
  const unranked = duelCopy(duel(1, { ranked: false }), known);
  assert.equal(unranked.players[0].after, undefined);
  const abandoned = duelCopy(duel(1, { status: 'abandoned', winner: 1 }), known);
  assert.deepEqual([abandoned.ranked, abandoned.winner, abandoned.players[0].before], [true, null, undefined]);
});

test('a live duel keeps only its allow-listed fields', () => {
  const live = liveCopy({
    id: 9, code: 'ZZ', ranked: true, bestOf: 5, startedAt: '2026-11-03T21:00:00Z', matchId: 1, threadId: DISCORD,
    challengerDiscordId: DISCORD, lastEventId: 55, players: [{ osuId: 3, name: 'p3', points: 2, discordId: DISCORD }, { osuId: 4, name: 'p4', points: 1 }],
  }, known);
  assert.deepEqual(live, { id: 9, code: 'ZZ', ranked: true, bestOf: 5, start: Date.UTC(2026, 10, 3, 21) / 1000, mp: 1, players: [{ u: 3, name: 'p3', pts: 2 }, { u: 4, name: 'p4', pts: 1 }] });
  assert.equal(liveCopy({ id: 9, players: [{ osuId: 3 }, { osuId: 8 }] }, known), null);
});

test('the block: ladder, live, recent, pages, profiles, events and the summary', () => {
  const ratings = {
    1: { name: 'p1', r: 1620.4, rd: 80, vol: 0.06, lastAt: '2026-11-05T20:30:00Z', w: 6, l: 1, streak: 3, peak: 1650, discordId: DISCORD },
    2: { name: 'p2', r: 1480, rd: 95, w: 2, l: 5, streak: -2, peak: 1500 },
    3: { name: 'p3', r: 1700, rd: 200, w: 2, l: 0, streak: 2, peak: 1700 }, // provisional: shown after the rated ones
    4: { name: 'p4', r: 1500, rd: 350, w: 0, l: 0 }, // no ranked duel
    9: { name: 'restricted', r: 2000, rd: 50, w: 9, l: 0 },
  };
  const matches = [duel(1), duel(2, { winner: 2, players: [side(1, 1), side(2, 3)], status: 'forfeit' }), duel(3, { status: 'cancelled' }),
    duel(4, { status: 'abandoned', players: [side(1, 1), side(2, 1)] }), duel(5, { ranked: false, players: [side(1, 3), side(3, 0)] })];
  const block = duelsBlock({ ratings, matches, active: [{ id: 6, players: [{ osuId: 3, points: 1 }, { osuId: 4, points: 0 }], startedAt: '2026-11-06T20:00:00Z' }] }, known);

  assert.deepEqual(block.file.ladder.map(r => [r.u, r.rank, r.prov]), [[1, 1, false], [2, 2, false], [3, null, true]]);
  assert.deepEqual(block.file.ladder[0], { u: 1, name: 'p1', r: 1620, rd: 80, w: 6, l: 1, streak: 3, peak: 1650, last: Date.UTC(2026, 10, 5, 20, 30) / 1000, prov: false, rank: 1 });
  assert.ok(PROVISIONAL_RD > 95 && PROVISIONAL_RD <= 200);
  assert.deepEqual(block.file.live.map(d => d.id), [6]);
  assert.deepEqual(block.file.recent.map(d => d.id), [5, 4, 2, 1]); // newest first, the cancelled one gone
  assert.equal(block.file.total, 4);
  assert.deepEqual(Object.keys(block.file.maps).map(Number), [1001, 1002, 1003, 1004, 1005]);
  assert.deepEqual(Object.keys(block.pages), ['duels/0.json']);
  assert.deepEqual(Object.keys(block.pages['duels/0.json'].duels).map(Number), [1, 2, 4, 5]);
  assert.equal(duelFile(1234), 'duels/12.json');

  const p1 = block.profiles.get(1);
  assert.deepEqual(p1.rating, { r: 1620, rd: 80, prov: false, rank: 1, w: 6, l: 1, streak: 3, peak: 1650 });
  assert.deepEqual(p1.recent.map(d => [d.id, d.res, d.opp, d.s]), [[5, 'w', 3, [3, 0]], [4, 'x', 2, [1, 1]], [2, 'l', 2, [1, 3]], [1, 'w', 2, [3, 1]]]);
  assert.equal(p1.recent[2].ff, 1);
  assert.equal(p1.recent[3].d, 12);
  assert.equal(p1.recent[0].d, undefined); // unranked
  // Head to head: the abandoned duel counts for nobody; most-played opponent first.
  assert.deepEqual(p1.h2h, [[2, 1, 1], [3, 1, 0]]);
  assert.equal(block.profiles.get(3).rating.prov, true);
  assert.equal(block.profiles.has(9), false);

  // Ranked results only, newest first; a forfeit says so.
  assert.deepEqual(block.events, [
    { t: Date.UTC(2026, 10, 2, 20, 30) / 1000, k: 'duel', u: 2, v: 1, d: 2, sc: [3, 1], r: 12, ff: 1 },
    { t: Date.UTC(2026, 10, 1, 20, 30) / 1000, k: 'duel', u: 1, v: 2, d: 1, sc: [3, 1], r: 12 },
  ]);
  assert.deepEqual(block.summary, { live: 1, players: 3, total: 4, leader: 1 });
  assert.ok(!JSON.stringify([block.file, block.pages, [...block.profiles], block.events]).includes(DISCORD));
  assert.ok(!JSON.stringify(block.file).includes('restricted'));
});

test('the same duel in two month files counts once, as the later file has it', () => {
  const block = duelsBlock({ ratings: {}, matches: [duel(1, { code: 'OLD' }), duel(1, { code: 'NEW' })], active: [] }, known);
  assert.deepEqual(block.file.recent.map(d => d.code), ['NEW']);
});

test('the Duels folder: ratings, every month of matches, and only state.json\'s active list', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'duels-'));
  try {
    assert.equal(loadDuels(root), null);
    fs.mkdirSync(path.join(root, 'Duels', 'matches'), { recursive: true });
    assert.deepEqual(loadDuels(root), { ratings: {}, matches: [], active: [] });
    const write = (file, value) => fs.writeFileSync(path.join(root, 'Duels', file), typeof value === 'string' ? value : JSON.stringify(value));
    write('ratings.json', { players: { 1: { r: 1500 } } });
    write('matches/2026-12.json', { duels: [duel(2)] });
    write('matches/2026-11.json', { duels: [duel(1)] });
    write('matches/notes.json', { duels: [duel(3)] });
    write('matches/2027-01.json', '{ not json');
    write('state.json', { channelId: DISCORD, challenges: [{ discordId: DISCORD }], active: [{ id: 5 }], nextId: 6 });
    const loaded = loadDuels(root);
    assert.deepEqual(loaded.ratings, { 1: { r: 1500 } });
    assert.deepEqual(loaded.matches.map(d => d.id), [1, 2]);
    assert.deepEqual(loaded.active, [{ id: 5 }]);
    assert.deepEqual(Object.keys(loaded), ['ratings', 'matches', 'active']);
    assert.deepEqual(duelMapIds(loaded), [1001, 1002, 1003, 1004, 1005, 1001, 1002, 1003, 1004, 1005]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the export: duels.json, the duel pages, profiles, meta, Activity and the maps it needs', async () => {
  const { build, neededMapIds } = await import('./build.mjs');
  const now = Date.UTC(2026, 10, 10) / 1000;
  const play = uid => ({
    beatmap_id: 500, user_id: uid, pp: 100, score: 1000000, maxcombo: 700, count300: 690, count100: 5, count50: 5,
    countmiss: 0, countkatu: 0, enabled_mods: 0, rank: 'S', date: '2026-11-01T00:00:00Z',
  });
  const player = (uid, extra = {}) => ({
    user_id: uid, username: `p${uid}`, country: 'PT', pp_raw: 5000, pp_rank: 1000, pp_country_rank: 10, accuracy: 98, level: 100,
    playcount: 1000, count_rank_ss: 1, count_rank_s: 2, count_rank_a: 3, profile_updated: '2026-11-01T00:00:00Z',
    TopConvertedScores: [play(uid)], TopUnrankedScores: [], RankedSpecificScores: [], PreRankScores: [], DanPasses: [], ...extra,
  });
  const bot = {
    players: [player(1), player(2), player(3, { restricted_since: '2026-11-02T00:00:00Z' })],
    ptCatch: [], ptCatchState: {}, banned: new Set(), weekly: { weeks: [], current: null },
    duels: {
      ratings: { 1: { name: 'p1', r: 1512, rd: 90, w: 1, l: 0, streak: 1, peak: 1512 }, 3: { name: 'p3', r: 1600, rd: 90, w: 1, l: 0 } },
      matches: [duel(1), duel(2, { players: [side(1, 3), side(3, 0)] })],
      active: [],
    },
  };
  const beatmaps = new Map([[1001, { beatmap_id: 1001, beatmapset_id: 10, artist: 'A', title: 'T', version: 'V', approved: 1, playmode: 2, difficultyrating: 6.1 }]]);
  assert.ok(neededMapIds(bot, 'PT').has(1005));
  const { files } = build({ bot, beatmaps, homeCountry: 'PT', now, state: {} });
  assert.deepEqual(files['duels.json'].recent.map(d => d.id), [1]); // duel 2 had a restricted player
  assert.deepEqual(files['duels.json'].ladder.map(r => r.u), [1]);
  assert.equal(files['duels.json'].maps[1001][1], 'T');
  assert.equal(files['duels.json'].maps[1002], null);
  assert.deepEqual(Object.keys(files['duels/0.json'].duels), ['1']);
  assert.equal(files['players/1-head.json'].duels.rating.r, 1512);
  assert.equal(files['players/1.json'].duels.recent.length, 1);
  assert.deepEqual(files['meta.json'].duels, { live: 0, players: 1, total: 1, leader: 1 });
  assert.ok(files['activity.json'].events.some(e => e.k === 'duel' && e.d === 1));

  const without = build({ bot: { ...bot, duels: null }, beatmaps, homeCountry: 'PT', now, state: {} }).files;
  assert.equal(without['duels.json'], undefined);
  assert.equal(without['meta.json'].duels, null);
});

test('before the bot has written any duels: an empty folder, empty files or junk all export, with nothing to show', async () => {
  const { build } = await import('./build.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'duels-empty-'));
  const write = (file, text) => fs.writeFileSync(path.join(root, 'Duels', file), text);
  const states = [];
  try {
    fs.mkdirSync(path.join(root, 'Duels', 'matches'), { recursive: true });
    states.push(loadDuels(root)); // empty folder, empty matches/
    write('ratings.json', '');
    write('state.json', '');
    states.push(loadDuels(root)); // empty files
    write('ratings.json', '{}');
    write('state.json', '{"active":null}');
    write('matches/2026-11.json', '{"duels":null}');
    states.push(loadDuels(root));
    write('ratings.json', '{"players":[]}');
    write('matches/2026-11.json', '[]');
    write('matches/2026-12.json', '{"duels":[null, 5, {"id":1}]}');
    states.push(loadDuels(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  for (const loaded of states) {
    assert.deepEqual(loaded.ratings, {});
    assert.deepEqual(loaded.active, []);
    const block = duelsBlock(loaded, known);
    assert.deepEqual(block.file, { ladder: [], live: [], recent: [], total: 0, maps: {} });
    assert.deepEqual(block.pages, {});
    assert.deepEqual(block.summary, { live: 0, players: 0, total: 0, leader: null });
  }

  // The whole export, with no folder and with an empty one: other files are unchanged by it.
  const now = Date.UTC(2026, 10, 10) / 1000;
  const bot = duels => ({
    players: [{ user_id: 1, username: 'p1', country: 'PT', pp_raw: 1, pp_rank: 1, profile_updated: '2026-11-01T00:00:00Z',
      TopConvertedScores: [], TopUnrankedScores: [], RankedSpecificScores: [], PreRankScores: [], DanPasses: [] }],
    ptCatch: [], ptCatchState: {}, banned: new Set(), weekly: { weeks: [], current: null }, duels,
  });
  const none = build({ bot: bot(null), beatmaps: new Map(), homeCountry: 'PT', now, state: {} }).files;
  const empty = build({ bot: bot(states[0]), beatmaps: new Map(), homeCountry: 'PT', now, state: {} }).files;
  assert.equal(none['duels.json'], undefined);
  assert.deepEqual(empty['duels.json'].ladder, []);
  assert.equal(Object.keys(empty).some(f => f.startsWith('duels/')), false);
  assert.equal(empty['players/1-head.json'].duels, undefined);
  const others = files => Object.fromEntries(Object.entries(files).filter(([f]) => f !== 'duels.json' && f !== 'meta.json'));
  assert.deepEqual(others(empty), others(none));
});
