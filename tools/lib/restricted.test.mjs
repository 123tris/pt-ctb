// node --test tools/lib/restricted.test.mjs
// A player the bot stamps restricted on osu! (restricted_since) is in none of the exported files, the map boards close
// up around them, and they're back as soon as the stamp is lifted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { build, neededMapIds, restrictedIds } from './build.mjs';
import { weeklyBlock } from './weekly.mjs';
import { S } from '../../assets/js/core/model.js';

const SERG = 7025890, ALICE = 1, BOB = 2;
const MAP = 500, DUMP_MAP = 600, LOVED_MAP = 700;
const now = Date.UTC(2026, 9, 25, 12) / 1000;
const day = 86400;

const score = (uid, map, pp, daysAgo) => ({
  beatmap_id: map, user_id: uid, pp, score: Math.round(pp * 10000), maxcombo: 700, count300: 690, count100: 5, count50: 5,
  countmiss: 0, countkatu: 0, enabled_mods: 8, rank: 'S', date: new Date((now - daysAgo * day) * 1000).toISOString(),
});

const player = (uid, name, pp, extra = {}) => ({
  user_id: uid, username: name, country: 'PT', pp_raw: 5000, pp_rank: 1000, pp_country_rank: 10, accuracy: 98, level: 100,
  playcount: 1000, count_rank_ss: 1, count_rank_s: 2, count_rank_a: 3, profile_updated: '2026-10-25T00:00:00Z',
  TopConvertedScores: [score(uid, MAP, pp, 3)], TopUnrankedScores: [], RankedSpecificScores: [], PreRankScores: [], DanPasses: [],
  ...extra,
});

const logPlay = (id, u, pp) => ({ id, solo: true, u, m: MAP, c: 'c', t: now - 5 * day, pp, acc: 98, combo: 700, miss: 0, mods: 'HD', g: 'S', sc: 900000 });

/** serg holds the map's #1 and the top of everything, Alice and Bob follow; the bot data as source.mjs loads it. */
function botData({ restricted }) {
  const week = {
    week: '2026-W42', start: now - 13 * day, end: now - 6 * day, complete: true, passes: 3, players: 3,
    topPp: logPlay(1, SERG, 300), mostPlays: [[SERG, 900], [ALICE, 100]],
    candidates: [{ lens: 'topPp', play: logPlay(1, SERG, 300) }, { lens: 'snipe', play: logPlay(2, ALICE, 200) }],
    vote: { url: 'https://discord.com/channels/1/2/3', posted: new Date((now - 6 * day) * 1000).toISOString() }, winner: 0, votes: [5, 1],
  };
  return {
    players: [
      player(SERG, 'serg', 300, {
        TopUnrankedScores: [score(SERG, LOVED_MAP, 50, 10)], // a map only he played
        ...(restricted ? { restricted_since: '2026-10-25T10:00:00Z', profile_updated: null } : {}),
      }),
      player(ALICE, 'Alice', 200),
      player(BOB, 'Bob', 100),
    ],
    ptCatch: [
      { user_id: SERG, username: 'serg', country: 'PT', pp: 10800, top_scores: [score(SERG, DUMP_MAP, 500, 30)], community_scores: [] },
      { user_id: ALICE, username: 'Alice', country: 'PT', pp: 5000, top_scores: [score(ALICE, DUMP_MAP, 250, 30)], community_scores: [] },
    ],
    ptCatchState: {},
    banned: new Set(),
    weekly: { weeks: [week], current: null },
  };
}

const beatmaps = new Map([
  [MAP, { beatmap_id: MAP, beatmapset_id: 50, artist: 'A', title: 'Convert', version: 'Hard', approved: 1, playmode: 0, difficultyrating: 5 }],
  [DUMP_MAP, { beatmap_id: DUMP_MAP, beatmapset_id: 60, artist: 'B', title: 'Catch', version: 'Rain', approved: 1, playmode: 2, difficultyrating: 6 }],
]);

// An earlier export: serg on the boards, an overtake event naming him, and his pp line.
const previous = {
  boards: { c: [SERG, ALICE, BOB], u: [], r: [SERG, ALICE, BOB] },
  totals: { [SERG]: [300, 0, 10800], [ALICE]: [200, 0, 5000], [BOB]: [100, 0, 5000] },
  known: [SERG, ALICE, BOB],
  events: [
    { t: now - day, k: 'pass', u: SERG, c: 'c', v: [ALICE], r: 1, pp: 300 },
    { t: now - day, k: 'pass', u: ALICE, c: 'r', v: [BOB], r: 2, pp: 5000 },
    { t: now - day, k: 'join', u: BOB },
  ],
  history: { days: ['2026-10-01'], series: { [SERG]: [[0, 300, 0, 10800]], [ALICE]: [[0, 200, 0, 5000]] } },
};

const exportWith = restricted => build({ bot: botData({ restricted }), beatmaps, homeCountry: 'PT', now, state: previous });
const mentions = (files, uid) => Object.entries(files).filter(([, content]) => new RegExp(`\\b${uid}\\b`).test(JSON.stringify(content))).map(([name]) => name);

test('the bot\'s stamp marks a player restricted', () => {
  assert.deepEqual([...restrictedIds(botData({ restricted: true }).players)], [SERG]);
  assert.deepEqual([...restrictedIds(botData({ restricted: false }).players)], []);
});

test('a restricted player is in none of the exported files', () => {
  const { files, state } = exportWith(true);

  assert.deepEqual(mentions(files, SERG), []);
  assert.ok(!files[`players/${SERG}.json`] && !files[`players/${SERG}-head.json`]);
  assert.deepEqual(files['players.json'].map(p => p.id), [ALICE, BOB]);
  assert.deepEqual(files['players.json'].map(p => p.rank.c), [1, 2]);
  assert.deepEqual(files['modrankings.json'].sources.r.HD.map(r => r[0]), [ALICE, BOB]); // Bob from his converts (no dump record)
  assert.ok(files['topplays.json'].plays.every(row => row[0] !== SERG));
  assert.equal(files['records.json'].topPlay.c[0], ALICE);
  assert.equal(files['records.json'].totals.players, 2);
  assert.ok(!(SERG in files['history.json'].series));
  assert.deepEqual(files['activity.json'].events.filter(e => e.k === 'pass').map(e => e.u), [ALICE]);
  assert.ok(files['activity.json'].events.every(e => e.k !== 'sotw')); // his Score of the week
  // The weekly block: his top play and win show as none, his candidate and most plays go.
  const past = files['challenges.json'].weekly.past[0];
  assert.equal(past.top, null);
  assert.equal(past.sotw, null);
  assert.equal(past.votes, null);
  assert.deepEqual(past.most, [ALICE, 100]);
  // Still known, so coming back isn't a "join".
  assert.ok(state.known.includes(SERG));
  assert.ok(!state.boards.c.includes(SERG));
  assert.ok(!neededMapIds(botData({ restricted: true }), 'PT').has(LOVED_MAP));
  assert.ok(!files[`maps/${LOVED_MAP % 128}.json`]?.[LOVED_MAP]); // no page for a map only he played
});

test('the map board closes up around a restricted player', () => {
  const bucket = exportWith(true).files[`maps/${MAP % 128}.json`][MAP];
  assert.deepEqual(bucket.s.map(e => e[0]), [ALICE, BOB]);
  const alice = exportWith(true).files[`players/${ALICE}.json`].scores.c.find(t => t[S.MAP] === MAP);
  assert.equal(alice[S.POS], 1);
});

test('with the stamp lifted the player is back, at his place', () => {
  const { files } = exportWith(false);
  assert.deepEqual(files['players.json'].map(p => p.id), [ALICE, BOB, SERG]); // by name
  assert.ok(neededMapIds(botData({ restricted: false }), 'PT').has(LOVED_MAP));
  assert.deepEqual(files[`maps/${MAP % 128}.json`][MAP].s.map(e => e[0]), [SERG, ALICE, BOB]);
  assert.ok(files[`players/${SERG}.json`]);
  assert.equal(files['challenges.json'].weekly.past[0].sotw[0], SERG);
  assert.ok(!files['activity.json'].events.some(e => e.k === 'join' && e.u === SERG));
});

test('an open vote drops a restricted candidate but keeps the numbers of the Discord post', () => {
  const week = { ...botData({ restricted: true }).weekly.weeks[0], winner: null, votes: null };
  const { block } = weeklyBlock({ weeks: [week] }, now, new Set([SERG]));
  assert.deepEqual(block.vote.candidates.map(([lens, row, n]) => [lens, row[0], n]), [['snipe', ALICE, 2]]);
});
