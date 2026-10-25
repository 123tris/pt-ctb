// node --test tools/lib/prerank.test.mjs
// A play from before its map was ranked counts toward nothing (no board, no pp, no top play) but stays viewable with
// the map's pre-rank plays, wherever the bot filed it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { build, setBeforeRanking } from './build.mjs';
import { S } from '../../assets/js/core/model.js';

const RANKED = '2022-07-06T12:21:37Z';
const day = n => new Date(Date.parse(RANKED) + n * 86400e3).toISOString().slice(0, 19); // stored without the Z
const map = (id, extra = {}) => ({
  beatmap_id: id, beatmapset_id: id, approved: '1', approved_date: RANKED, playmode: '2', title: `Map ${id}`,
  artist: 'A', version: 'V', difficultyrating: 8.5, max_combo: 3352, ...extra,
});
const play = (id, date, pp, score = 300_000_000) => ({
  beatmap_id: id, date, pp, score, count300: 3000, count100: 80, count50: 500, countmiss: 0, countkatu: 4,
  maxcombo: 3333, enabled_mods: 0, rank: 'S',
});

test('a ranked board allows the qualified period; an unranked-era play needs the ranked date; loved maps keep theirs', () => {
  const ranked = map(1);
  assert.equal(setBeforeRanking(play(1, day(-220), 1094.94), ranked, true), true); // Galaxy Collapse
  assert.equal(setBeforeRanking(play(1, day(-6), 300), ranked, true), false); // the qualified period
  assert.equal(setBeforeRanking(play(1, day(-6), 300), ranked, false), true);
  assert.equal(setBeforeRanking(play(1, day(1), 300), ranked, false), false);
  assert.equal(setBeforeRanking(play(1, day(-220), 300), map(1, { approved: '4' }), false), false); // loved
  assert.equal(setBeforeRanking(play(1, day(-220), 300), map(1, { approved_date: null }), true), false); // no date
  assert.equal(setBeforeRanking(play(1, null, 300), ranked, true), false);
});

test('a pre-rank play filed on a ranked board leaves the board, the pp and the top plays, and shows once as pre-rank', () => {
  const tris = {
    user_id: 1, username: 'Tris', country: 'PT',
    TopConvertedScores: [], TopUnrankedScores: [],
    RankedSpecificScores: [play(10, day(-220), 1094.94), play(11, day(-3), 200)],
    PreRankScores: [{ ...play(10, day(-220), 0) }],
  };
  const other = {
    user_id: 2, username: 'Bell', country: 'PT', TopUnrankedScores: [], RankedSpecificScores: [],
    TopConvertedScores: [play(12, day(-1400), 79.68)], PreRankScores: [],
  };
  const beatmaps = new Map([[10, map(10)], [11, map(11)], [12, map(12, { playmode: '0' })]]);
  const bot = { players: [tris, other], ptCatch: [], banned: new Set(), ptCatchState: {} };
  const { files } = build({ bot, beatmaps, homeCountry: 'PT', now: Date.parse('2026-10-25T12:00:00Z') / 1000, state: {} });

  const entry = id => files[`maps/${id % 128}.json`][id];
  assert.deepEqual(entry(10).s, []); // no longer on the board...
  assert.equal(entry(10).pre.length, 1); // ...but viewable once, at 0pp
  assert.equal(entry(10).pre[0][0], 1);
  assert.equal(entry(10).pre[0][S.PP + 1], 0);
  assert.equal(entry(11).s.length, 1); // a qualified-period play stays
  assert.deepEqual(entry(12).s, []);

  assert.ok(!files['topplays.json'].plays.some(row => row[S.MAP + 2] === 10));
  const bell = files['players.json'].find(p => p.id === 2);
  assert.equal(bell.cv, 0);
  assert.deepEqual(files['players/1.json'].scores.r.map(t => t[S.MAP]), [11]);
  assert.deepEqual(files['players/1.json'].pre.map(t => t[S.MAP]), [10]);
});
