// node --test tools/lib/best-plays.test.mjs
// A convert map's board goes by classic score, its pp by the best-pp play. The bot keeps both when they're different
// plays (TopConvertedScores holds the board play, ConvertPpScores the higher-pp one): the export puts the board play on
// the map's board and counts the pp play for convert pp, the top plays and the mod rankings. Ranked boards go by score
// too, whichever source a play comes from.

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './build.mjs';
import { S, countedPp } from '../../assets/js/core/model.js';

const ALICE = 1, BOB = 2;
const MAP = 500, RANKED_MAP = 600;
const now = Date.UTC(2026, 9, 29, 12) / 1000;
const day = 86400;
const HD = 8, HR = 16;

const play = (uid, map, total, pp, mods, daysAgo = 3) => ({
  beatmap_id: map, user_id: uid, pp, score: total, maxcombo: 700, count300: 690, count100: 5, count50: 5,
  countmiss: 0, countkatu: 0, enabled_mods: mods, rank: 'S', date: new Date((now - daysAgo * day) * 1000).toISOString(),
});

const player = (uid, name, extra = {}) => ({
  user_id: uid, username: name, country: 'PT', pp_raw: 5000, pp_rank: 1000, pp_country_rank: 10, accuracy: 98, level: 100,
  playcount: 1000, count_rank_ss: 1, count_rank_s: 2, count_rank_a: 3, profile_updated: '2026-10-25T00:00:00Z',
  TopConvertedScores: [], TopUnrankedScores: [], RankedSpecificScores: [], PreRankScores: [], DanPasses: [],
  ...extra,
});

// Alice: HD 10M/100pp on the board, HDHR 8M/150pp for pp. Bob: 9M/140pp, between the two.
function botData({ withPpPlays = true } = {}) {
  return {
    players: [
      player(ALICE, 'Alice', {
        TopConvertedScores: [play(ALICE, MAP, 10_000_000, 100, HD)],
        ...(withPpPlays ? { ConvertPpScores: [play(ALICE, MAP, 8_000_000, 150, HD | HR)] } : {}),
        RankedSpecificScores: [play(ALICE, RANKED_MAP, 20_000_000, 300, 0)],
      }),
      player(BOB, 'Bob', { TopConvertedScores: [play(BOB, MAP, 9_000_000, 140, HD)] }),
    ],
    // The dump's best-pp ranked play of Alice's: more pp, less score than the one the bot keeps on the board.
    ptCatch: [{ user_id: ALICE, username: 'Alice', country: 'PT', pp: 5000, top_scores: [play(ALICE, RANKED_MAP, 15_000_000, 350, HR, 30)], community_scores: [] }],
    ptCatchState: {},
    banned: new Set(),
    weekly: { weeks: [], current: null },
  };
}

const beatmaps = new Map([
  [MAP, { beatmap_id: MAP, beatmapset_id: 50, artist: 'A', title: 'Convert', version: 'Hard', approved: 1, playmode: 0, difficultyrating: 5 }],
  [RANKED_MAP, { beatmap_id: RANKED_MAP, beatmapset_id: 60, artist: 'B', title: 'Catch', version: 'Rain', approved: 1, playmode: 2, difficultyrating: 6 }],
]);

const exportWith = options => build({ bot: botData(options), beatmaps, homeCountry: 'PT', now, state: {} }).files;
const board = (files, map) => files[`maps/${map % 128}.json`][map].s;

test('the convert board keeps the higher-scoring play', () => {
  const entries = board(exportWith(), MAP);
  assert.deepEqual(entries.map(e => e[0]), [ALICE, BOB]);
  assert.equal(entries[0][S.SCORE + 1], 10_000_000);
});

test('convert pp counts the higher-pp play', () => {
  const files = exportWith();
  const alice = files['players.json'].find(p => p.id === ALICE);
  assert.equal(alice.cv, 150);
  assert.equal(alice.rank.c, 1);                                      // 150 over Bob's 140
  const file = files[`players/${ALICE}.json`];
  assert.equal(file.scores.c.length, 1);
  assert.equal(file.scores.c[0][S.SCORE], 10_000_000);
  assert.equal(file.scores.c[0][S.POS], 1);
  assert.deepEqual(file.pp.c.map(t => t[S.PP]), [150]);
  assert.deepEqual(countedPp(file, 'c'), [150]);                      // what the calculator counts
  assert.ok(!files[`players/${BOB}.json`].pp);                       // no pp plays, no list
});

test('the top plays and mod rankings use the pp play', () => {
  const files = exportWith();
  const row = files['topplays.json'].plays.find(r => r[0] === ALICE && r[S.MAP + 2] === MAP);
  assert.equal(row[S.PP + 2], 150);
  const hd = files['modrankings.json'].sources.c.HD;
  assert.deepEqual(hd.map(r => [r[0], r[1]]), [[ALICE, 150], [BOB, 140]]);
  assert.equal(files['records.json'].topPlay.c[S.PP + 2], 150);
});

test('bot data without pp plays exports as before', () => {
  const files = exportWith({ withPpPlays: false });
  assert.equal(files['players.json'].find(p => p.id === ALICE).cv, 100);
  assert.ok(!files[`players/${ALICE}.json`].pp);
  assert.deepEqual(board(files, MAP).map(e => e[0]), [ALICE, BOB]);
});

test('a ranked board keeps the best score, even over a dump play worth more pp', () => {
  const entries = board(exportWith(), RANKED_MAP);
  assert.equal(entries[0][S.SCORE + 1], 20_000_000);
});
