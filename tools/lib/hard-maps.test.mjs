// node --test tools/lib/hard-maps.test.mjs
// The Records page's hard-map record: #1s counted on 6★ and up only, and the hardest full combo. EZ/HT plays, banned
// maps and converts without a catch star rating don't count; DT/HR plays count at the nomod stars.

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './build.mjs';
import { S } from '../../assets/js/core/model.js';

const map = (id, stars, extra = {}) => ({
  beatmap_id: id, beatmapset_id: id, approved: '1', playmode: '2', title: `Map ${id}`, artist: 'A', version: 'V',
  difficultyrating: stars, max_combo: 1000, ...extra,
});
const play = (id, score, { miss = 0, mods = 0 } = {}) => ({
  beatmap_id: id, date: '2024-01-01T00:00:00', pp: score / 1e6, score, count300: 900, count100: 50, count50: 40,
  countmiss: miss, countkatu: 2, maxcombo: 1000, enabled_mods: mods, rank: miss ? 'A' : 'S',
});
const player = (user_id, username, ranked, converts = []) => ({
  user_id, username, country: 'PT', RankedSpecificScores: ranked, TopConvertedScores: converts, TopUnrankedScores: [],
  PreRankScores: [],
});

test('only hard maps count: easy #1s, EZ/HT, banned maps and converts without catch stars are left out', () => {
  const beatmaps = new Map([
    [1, map(1, 2.1)], [2, map(2, 2.4)], [3, map(3, 1.8)], // easy maps
    [10, map(10, 6.2)], [11, map(11, 7.5)], [12, map(12, 8.9)], [13, map(13, 6.6)], [14, map(14, 6.4)],
    [20, map(20, 9.5, { playmode: '0' })], // a convert with no catch star rating: not counted
    [21, map(21, 6.8, { playmode: '0', catch_difficulty: true })],
  ]);
  const bell = player(1, 'Bell', [play(1, 900e6), play(2, 900e6), play(3, 900e6), play(10, 500e6)]);
  const afonso = player(2, 'Afonso', [
    play(10, 800e6, { miss: 3 }), play(11, 700e6, { mods: 64 }), play(12, 600e6, { miss: 2 }),
    play(13, 600e6, { mods: 2 }), // EZ: not counted
    play(14, 600e6), // banned
  ], [play(20, 600e6), play(21, 600e6)]);
  const bot = { players: [bell, afonso], ptCatch: [], banned: new Set([14]), ptCatchState: {} };
  const { files } = build({ bot, beatmaps, homeCountry: 'PT', now: Date.parse('2026-10-25T12:00:00Z') / 1000, state: {} });
  const { hard, maps } = files['records.json'];

  assert.equal(hard.stars, 6);
  // Afonso: 10, 11 (DT at nomod stars) and 12, plus the convert 21. Bell's three easy #1s count nothing.
  assert.deepEqual(hard.firsts, [[2, 4]]);
  // The hardest FC: 11 (7.5★, DT); 12 is harder but has misses, 13 is EZ, 14 is banned, 20 has no catch stars.
  assert.equal(hard.fc[0], 2);
  assert.equal(hard.fc[S.MAP + 2], 11);
  assert.ok(maps[11]);
});
