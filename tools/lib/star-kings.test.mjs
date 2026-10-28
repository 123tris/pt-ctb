import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './build.mjs';
import { starKings } from './star-kings.mjs';
import { sharedRanks } from '../../assets/js/core/model.js';

const map = (id, stars, mode = 2, extra = {}) => ({ beatmap_id: id, beatmapset_id: id, approved: 1,
  playmode: mode, difficultyrating: stars, catch_difficulty: true, title: 'Map', max_combo: 100, ...extra });
const play = (id, score, extra = {}) => ({ beatmap_id: id, pp: score, score, rank: 'S', date: '2026-10-01T00:00:00Z',
  count300: 100, count100: 0, count50: 0, countmiss: 0, countkatu: 0, maxcombo: 100, enabled_mods: 0, ...extra });
const player = (id, ranked = [], converts = [], loved = [], extra = {}) => ({ user_id: id, username: `Player ${id}`,
  country: 'PT', RankedSpecificScores: ranked, TopConvertedScores: converts, TopUnrankedScores: loved, ...extra });

test('star kings use whole unrounded ranges, separate native modes, share ties and omit unknown difficulty', () => {
  const maps = new Map([[1, map(1, 5.999)], [2, map(2, 6)], [3, map(3, 6.99)], [4, map(4, 6.2)],
    [5, map(5, 6.9, 0)], [6, map(6, 12.2, 0)], [7, map(7, null)],
    [8, map(8, 8, 0, { catch_difficulty: false })], [9, map(9, 9, 3)], [10, map(10, 0.4)],
    [11, map(11, 10, 0)], [12, map(12, 96, 0)]]);
  const boards = new Map([...maps.keys()].map(id => [id, { entries: [[id === 3 ? 2 : 1], [99]] }]));
  const result = starKings(boards, maps);
  assert.deepEqual(result.catch, [{ stars: 0, count: 1, players: [1], board: [[1, 1]] },
    { stars: 5, count: 1, players: [1], board: [[1, 1]] }, { stars: 6, count: 2, players: [1], board: [[1, 2], [2, 1]] }]);
  assert.deepEqual(result.converts, [{ stars: 6, count: 1, players: [1], board: [[1, 1]] },
    { stars: 10, count: 3, players: [1], board: [[1, 3]] }]);
  boards.delete(4);
  assert.deepEqual(starKings(boards, maps).catch.at(-1), { stars: 6, count: 1, players: [1, 2], board: [[1, 1], [2, 1]] });
  assert.deepEqual(starKings(new Map(), maps), { catch: [], converts: [] });
});

test('export counts the actual PT board winner once, including NF, with no failed, foreign, restricted or pre-rank plays', () => {
  const maps = new Map([[1, map(1, 6.5)], [2, map(2, 6.7, 0)], [3, map(3, 6.9, 0, { approved: 4 })],
    [4, map(4, 7.2)], [5, map(5, 8.1, 2, { approved_date: '2026-09-01T00:00:00Z' })]]);
  const people = [
    player(1, [play(1, 100, { pp: 500, enabled_mods: 1 }), play(4, 999, { rank: 'F' }),
      play(5, 999, { date: '2020-01-01T00:00:00Z' })], [play(2, 50)], [play(1, 100, { enabled_mods: 1 }), play(3, 80)]),
    player(2, [play(1, 200, { pp: 90, enabled_mods: 17 })], [play(2, 40)], [play(3, 100, { pp: 70 })]),
    player(3, [play(1, 999)], [], [], { country: 'ES' }),
    player(4, [play(1, 1000)], [], [], { restricted_since: '2026-10-01' }),
  ];
  const bot = { players: people, ptCatch: [], ptCatchState: {}, banned: new Set() };
  const { files } = build({ bot, beatmaps: maps, homeCountry: 'PT', now: 1793000000, state: {} });
  assert.deepEqual(files['records.json'].kings, {
    catch: [{ stars: 6, count: 1, players: [2], board: [[2, 1]] }],
    converts: [{ stars: 6, count: 2, players: [1], board: [[1, 2]] }],
  });
});

test('each range has a full board: everyone with a #1 there, most first, ties by id, sharing a rank', () => {
  // Range 7: player 5 holds three #1s, players 4 and 3 two each, player 1 one; player 99 is only ever second.
  const winners = [5, 4, 5, 3, 1, 4, 5, 3];
  const maps = new Map(winners.map((_, i) => [i + 1, map(i + 1, 7 + i / 10)]));
  maps.set(20, map(20, 7.5, 0));
  const boards = new Map(winners.map((w, i) => [i + 1, { entries: [[w], [99]] }]));
  boards.set(20, { entries: [[99]] });
  const [seven] = starKings(boards, maps).catch;
  assert.deepEqual(seven, { stars: 7, count: 3, players: [5], board: [[5, 3], [3, 2], [4, 2], [1, 1]] });
  assert.deepEqual(sharedRanks(seven.board.map(([, n]) => n)), [1, 2, 2, 4]);
  // Converts are counted on their own: player 99's convert #1 doesn't reach the catch board.
  assert.deepEqual(starKings(boards, maps).converts, [{ stars: 7, count: 1, players: [99], board: [[99, 1]] }]);
  assert.deepEqual(sharedRanks([2, 2, 1]), [1, 1, 3]);
  assert.deepEqual(sharedRanks([]), []);
});
