// node --test tools/lib/snipes.test.mjs
// "#1 sniped" in the activity feed: only when the #1 was someone else's before the play. A player beating their own #1
// leaves the same board as a snipe would (a #1 newer than the runner-up's score), so the bot's play log decides.

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './build.mjs';

const YOXIDE = 6205809, SAGIIT = 11491079, CARLA = 3;
const MAP = 3561625; // xi - Blue Zenith (Cut Ver.) [Sytho's Extra], a convert
const now = Date.UTC(2026, 9, 29, 18) / 1000;
const day = 86400;
const HD = 8, HR = 16;

const at = daysAgo => Math.floor(now - daysAgo * day);
const score = (uid, points, daysAgo, mods = HD, pp = points / 100000) => ({
  beatmap_id: MAP, user_id: uid, pp, score: points, maxcombo: 900, count300: 920, count100: 5, count50: 47,
  countmiss: 8, countkatu: 2, enabled_mods: mods, rank: 'SH', date: new Date(at(daysAgo) * 1000).toISOString(),
});
const player = (uid, name, scores, extra = {}) => ({
  user_id: uid, username: name, country: 'PT', pp_raw: 5000, pp_rank: 1000, pp_country_rank: 10, accuracy: 98, level: 100,
  playcount: 1000, count_rank_ss: 1, count_rank_s: 2, count_rank_a: 3, profile_updated: '2026-10-29T00:00:00Z',
  TopConvertedScores: scores, TopUnrankedScores: [], RankedSpecificScores: [], PreRankScores: [], DanPasses: [],
  ...extra,
});
/** A play log line as the bot writes it (Plays/<week>.jsonl), trimmed to what source.mjs keeps. */
const logged = (u, daysAgo, extra = {}) => ({ u, m: MAP, t: at(daysAgo), c: 'c', pp: 100, ...extra });

const LOVED = 2335663;
const beatmaps = new Map([
  [LOVED, { beatmap_id: LOVED, beatmapset_id: 1100000, artist: 'A', title: 'Loved', version: 'Expert', approved: 4, playmode: 2, difficultyrating: 6 }],
  [MAP, { beatmap_id: MAP, beatmapset_id: 1737645, artist: 'xi', title: 'Blue Zenith (Cut Ver.)', version: "Sytho's Extra", approved: 1, playmode: 0, difficultyrating: 3.71 }],
]);

/** The log as source.mjs loads it; its lines speak for plays set from `from` (here: 20 days ago). */
const LOG_FROM = at(20);
function snipes({ players, plays, from = LOG_FROM }) {
  const bot = { players, ptCatch: [], ptCatchState: {}, banned: new Set(), weekly: { weeks: [], current: null }, plays: { from, lines: plays } };
  const { files } = build({ bot, beatmaps, homeCountry: 'PT', now, state: {} });
  return files['activity.json'].events.filter(e => e.k === 'snipe').map(e => ({ u: e.u, v: e.v, t: e.t }));
}

// The reported case: Yoxide held the #1 (HD, 11.6M) over sagiiT (HD, 1.9M, from 2022) and beat it with HDHR today.
const yoxideImproves = [
  player(YOXIDE, 'DemiGod Yoxide', [score(YOXIDE, 12_100_000, 0.01, HD | HR, 115.4)]),
  player(SAGIIT, 'sagiiT', [score(SAGIIT, 1_934_031, 1610)]),
];

test('a player beating their own #1 is no snipe, and the runner-up lost nothing', () => {
  // The bot took the play in against his previous HD #1: it passed nobody, so no `sniped`, no `held`.
  assert.deepEqual(snipes({ players: yoxideImproves, plays: [logged(YOXIDE, 0.01)] }), []);
});

test('a #1 the bot credits to a player from elsewhere still names who held it among the players shown', () => {
  // `sniped` without `held`: the bot's #1 was someone outside the community, so it doesn't count the time held, but on
  // this board sagiiT was the #1 the play took.
  const plays = [logged(YOXIDE, 0.01, { sniped: [SAGIIT] })];
  assert.deepEqual(snipes({ players: yoxideImproves, plays }), [{ u: YOXIDE, v: SAGIIT, t: at(0.01) }]);
});

test('a genuine snipe names the player who held the #1', () => {
  const plays = [logged(YOXIDE, 0.01, { sniped: [SAGIIT], held: 1610 * day })];
  assert.deepEqual(snipes({ players: yoxideImproves, plays }), [{ u: YOXIDE, v: SAGIIT, t: at(0.01) }]);
});

test('the snipe names the old #1 even when someone has since slotted in between', () => {
  // Yoxide took the #1 from sagiiT 5 days ago; Carla's play 2 days ago went to #2 under him.
  const players = [
    player(YOXIDE, 'DemiGod Yoxide', [score(YOXIDE, 12_000_000, 5)]),
    player(CARLA, 'Carla', [score(CARLA, 8_000_000, 2)]),
    player(SAGIIT, 'sagiiT', [score(SAGIIT, 5_000_000, 100)]),
  ];
  const plays = [logged(YOXIDE, 5, { sniped: [SAGIIT], held: 95 * day }), logged(CARLA, 2, { sniped: [SAGIIT] })];
  assert.deepEqual(snipes({ players, plays }), [{ u: YOXIDE, v: SAGIIT, t: at(5) }]);
});

test('a play logged twice (by !rs and by the tracker) counts the line that changed the board', () => {
  const plays = [logged(YOXIDE, 0.01, { sniped: [SAGIIT], held: 1610 * day }), logged(YOXIDE, 0.01)];
  assert.deepEqual(snipes({ players: yoxideImproves, plays }), [{ u: YOXIDE, v: SAGIIT, t: at(0.01) }]);
});

test('tying the #1 takes nothing: the bot logs it without `held`', () => {
  const players = [
    player(YOXIDE, 'DemiGod Yoxide', [score(YOXIDE, 5_000_000, 0.5)]),
    player(SAGIIT, 'sagiiT', [score(SAGIIT, 5_000_000, 10)]),
  ];
  const tied = snipes({ players, plays: [logged(YOXIDE, 0.5)] });
  assert.ok(!tied.some(e => e.u === YOXIDE), JSON.stringify(tied));
});

test('a #1 lost to a restricted player is no event', () => {
  const players = [yoxideImproves[0], player(SAGIIT, 'sagiiT', yoxideImproves[1].TopConvertedScores, { restricted_since: '2026-10-01T00:00:00Z' })];
  assert.deepEqual(snipes({ players, plays: [logged(YOXIDE, 0.01, { sniped: [SAGIIT], held: day })] }), []);
});

test('a play the log doesn\'t have falls back to the board: a #1 newer than the runner-up took it from them', () => {
  // Before the log, or a play only a dump brought in: the board is all there is to go by.
  assert.deepEqual(snipes({ players: yoxideImproves, plays: [] }), [{ u: YOXIDE, v: SAGIIT, t: at(0.01) }]);
  // A #1 older than the runner-up's play never was a snipe.
  const players = [player(YOXIDE, 'DemiGod Yoxide', [score(YOXIDE, 12_000_000, 30)]), player(SAGIIT, 'sagiiT', [score(SAGIIT, 1_000_000, 3)])];
  assert.deepEqual(snipes({ players, plays: [] }), []);
});

test('a play from before the log speaks for snipes is left to the board', () => {
  // The log's first import took in the day before it again, plays the bot mostly had already: those lines have no
  // `sniped` whatever the play did, so they say nothing.
  assert.deepEqual(snipes({ players: yoxideImproves, plays: [logged(YOXIDE, 0.01)], from: at(0) }), [{ u: YOXIDE, v: SAGIIT, t: at(0.01) }]);
  assert.deepEqual(snipes({ players: yoxideImproves, plays: [logged(YOXIDE, 0.01)], from: null }), [{ u: YOXIDE, v: SAGIIT, t: at(0.01) }]);
});

test('a loved play the bot took in without pp is left to the board', () => {
  // Loved boards go by pp. A lazer play can come in with none; the bot works it out after its snipe check, which saw
  // a 0pp play that passed nobody. zDelightful's 157.64pp play over iPPC's 69.18pp was such a snipe.
  const loved = (uid, pp, daysAgo, points) => ({ ...score(uid, points, daysAgo, 0, pp), beatmap_id: LOVED });
  const players = [
    player(YOXIDE, 'zDelightful', [], { TopUnrankedScores: [loved(YOXIDE, 157.64, 1, 0)] }),
    player(SAGIIT, 'iPPC', [], { TopUnrankedScores: [loved(SAGIIT, 69.18, 1400, 4_934_998)] }),
  ];
  const plays = [{ u: YOXIDE, m: LOVED, t: at(1), c: 'u' }];
  assert.deepEqual(snipes({ players, plays }), [{ u: YOXIDE, v: SAGIIT, t: at(1) }]);
  // With its pp, the line speaks for itself.
  assert.deepEqual(snipes({ players, plays: [{ ...plays[0], pp: 157.64 }] }), []);
});
