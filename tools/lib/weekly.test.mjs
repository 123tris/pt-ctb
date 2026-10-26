// node --test tools/lib/weekly.test.mjs
// The community week (Lisbon time, as in the bot) and the weekly highlights block the exporter builds from the bot's
// Weekly/ files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { lisbonWeek, scoreId, modMask, weeklyBlock, votedMaps, weekOf } from './weekly.mjs';
import { build } from './build.mjs';
import { MOD } from '../../assets/js/core/model.js';

const utc = (y, m, d, h = 0) => Date.UTC(y, m - 1, d, h) / 1000;

test('a summer week starts at 23:00 UTC on the Sunday, a winter one at midnight', () => {
  assert.deepEqual(lisbonWeek(utc(2026, 7, 15, 12)), { id: '2026-W29', start: utc(2026, 7, 12, 23), end: utc(2026, 7, 19, 23) });
  assert.equal(lisbonWeek(utc(2026, 7, 12, 22)).id, '2026-W28');
  assert.equal(lisbonWeek(utc(2026, 7, 12, 23)).id, '2026-W29');
  assert.deepEqual(lisbonWeek(utc(2026, 11, 4)), { id: '2026-W45', start: utc(2026, 11, 2), end: utc(2026, 11, 9) });
});

test('the weeks with a clock change last 169 and 167 hours', () => {
  const autumn = lisbonWeek(utc(2026, 10, 25, 12));
  assert.deepEqual(autumn, { id: '2026-W43', start: utc(2026, 10, 18, 23), end: utc(2026, 10, 26) });
  const spring = lisbonWeek(utc(2026, 3, 25));
  assert.equal(spring.id, '2026-W13');
  assert.equal(spring.end - spring.start, 167 * 3600);
  assert.equal(lisbonWeek(utc(2027, 1, 1, 12)).id, '2026-W53');
});

test('score ids: the current id positive, a stable play\'s legacy id negative, unknown kinds left out', () => {
  assert.equal(scoreId({ score_id: 6749394886, solo: true }), 6749394886);
  assert.equal(scoreId({ score_id: 4512345678, legacy_score_id: 4512345678 }), -4512345678);
  assert.equal(scoreId({ score_id: 123 }), 0); // stored before the bot tracked the kind
  assert.equal(scoreId({ id: 55, solo: true }), 55); // a log line
  assert.equal(scoreId({ id: 77, lid: 77 }), -77);
});

test('mod acronyms become the bitmask', () => {
  assert.equal(modMask('NM'), 0);
  assert.equal(modMask('HDHR'), MOD.HD | MOD.HR);
  assert.equal(modMask('EZHTHD'), MOD.EZ | MOD.HT | MOD.HD);
});

const play = (id, u, pp, extra = {}) => ({ id, solo: true, u, m: 1000 + id, c: 'r', t: utc(2026, 10, 20), pp, acc: 98.5, combo: 700, miss: 0, mods: 'HD', g: 'S', sc: 900000, ...extra });
const week = (id, start, extra = {}) => ({
  week: id, start, end: start + 7 * 86400, complete: true, passes: 10, players: 3,
  topPp: play(1, 11, 300), mostPlays: [[12, 400], [11, 200]], vote: null, ...extra,
});
const posted = { url: 'https://discord.com/channels/1/2/4', posted: '2026-11-02T00:31:00Z' };

test('a week id gives back its Lisbon week', () => {
  assert.deepEqual(weekOf('2026-W44'), lisbonWeek(utc(2026, 10, 28)));
  assert.deepEqual(weekOf('2026-W29'), { id: '2026-W29', start: utc(2026, 7, 12, 23), end: utc(2026, 7, 19, 23) });
  assert.equal(weekOf('2026-W53').id, '2026-W53');
  assert.equal(weekOf('nope'), null);
});

test('a map vote decides a week only once counted, and only if its recap was posted', () => {
  const weeks = [
    week('2026-W43', utc(2026, 10, 18, 23), { vote: posted, mapVote: { week: '2026-W45', candidates: [7, 8, 9], winner: 1, map: 8 } }),
    week('2026-W44', utc(2026, 10, 26), { vote: posted, mapVote: { week: '2026-W46', candidates: [4, 5, 6] } }),
    week('2026-W42', utc(2026, 10, 11, 23), { mapVote: { week: '2026-W44', candidates: [1, 2, 3], winner: 0, map: 1 } }),
  ];
  assert.deepEqual([...votedMaps(weeks)], [['2026-W45', 8]]);
  assert.deepEqual([...votedMaps(undefined)], []);
});

test('no weekly data: no block, so the page shows nothing', () => {
  assert.deepEqual(weeklyBlock(undefined, utc(2026, 10, 28)), { block: null, mapIds: [] });
  assert.equal(weeklyBlock({ weeks: [], current: null }, utc(2026, 10, 28)).block, null);
});

test('the block: the week so far, the open map vote and past weeks with their maps', () => {
  const now = utc(2026, 11, 4); // in 2026-W45
  const w43 = week('2026-W43', utc(2026, 10, 18, 23), { vote: posted, mapVote: { week: '2026-W45', candidates: [7, 8, 9], winner: 1, map: 8 } });
  const w44 = week('2026-W44', utc(2026, 10, 26), { vote: posted, mapVote: { week: '2026-W46', candidates: [4, 5, 6] } });
  const current = week('2026-W45', utc(2026, 11, 2));

  const { block, mapIds } = weeklyBlock({ weeks: [w44, w43], current }, now, new Set(),
    { picked: { '2026-W43': 300, '2026-W44': 8 }, playersOn: id => id * 10 });

  assert.equal(block.current.week, '2026-W45');
  assert.deepEqual(block.current.top.slice(0, 3), [11, 'r', 1001]);
  assert.equal(block.current.top[2 + 11], 1); // S.ID: the solo score id
  assert.deepEqual(block.current.most, [[12, 400], [11, 200]]);
  assert.deepEqual(block.mapVote, { week: '2026-W46', start: utc(2026, 11, 9), end: utc(2026, 11, 16), url: posted.url, candidates: [[4, 40], [5, 50], [6, 60]] });
  assert.deepEqual(block.past.map(p => [p.week, p.map, p.voted]), [['2026-W44', 8, false], ['2026-W43', 300, false]]);
  assert.equal(block.past[1].top[2 + 5], MOD.HD); // mods as a bitmask
  assert.deepEqual(mapIds.sort((a, b) => a - b), [4, 5, 6, 8, 300, 1001, 1001, 1001]);
});

test('no open vote once it is counted, or when the recap never went out', () => {
  const counted = week('2026-W44', utc(2026, 10, 26), { vote: posted, mapVote: { week: '2026-W46', candidates: [4, 5, 6], winner: 0, map: 4 } });
  const unposted = week('2026-W44', utc(2026, 10, 26), { mapVote: { week: '2026-W46', candidates: [4, 5, 6] } });
  for (const w of [counted, unposted]) assert.equal(weeklyBlock({ weeks: [w] }, utc(2026, 11, 4)).block.mapVote, null);
});

test('a stale week so far (the bot stopped writing it) is left out', () => {
  const current = week('2026-W44', utc(2026, 10, 26));
  assert.equal(weeklyBlock({ weeks: [], current }, utc(2026, 11, 4)).block, null);
});

// ---- The exporter: the voted map is the map of the week ----------------------------------------------------------

const score = (uid, map) => ({
  beatmap_id: map, user_id: uid, pp: 100, score: 900000, maxcombo: 700, count300: 690, count100: 5, count50: 5,
  countmiss: 0, countkatu: 0, enabled_mods: 0, rank: 'S', date: '2026-10-20T12:00:00Z',
});
const players = [1, 2, 3, 4].map(uid => ({
  user_id: uid, username: 'P' + uid, country: 'PT', pp_raw: 5000, pp_rank: 1000, pp_country_rank: 10, accuracy: 98, level: 100,
  playcount: 1000, count_rank_ss: 1, count_rank_s: 2, count_rank_a: 3, profile_updated: '2026-10-25T00:00:00Z',
  TopConvertedScores: [score(uid, 500), score(uid, 501), score(uid, 502)], TopUnrankedScores: [], RankedSpecificScores: [], PreRankScores: [], DanPasses: [],
}));
const beatmaps = new Map([500, 501, 502].map(id => [id, { beatmap_id: id, beatmapset_id: id, artist: 'A', title: 'T' + id, version: 'Hard', approved: 1, playmode: 0, difficultyrating: 5 }]));
const exportIn = (now, weeks, state = {}) => build({
  bot: { players, ptCatch: [], ptCatchState: {}, banned: new Set(), weekly: { weeks, current: null } }, beatmaps, homeCountry: 'PT', now, state,
});

test('the map the vote chose becomes that week\'s map of the week, even over an automatic pick already made', () => {
  const now = utc(2026, 11, 4); // in 2026-W45
  const auto = exportIn(now, []);
  const autoPick = auto.files['challenges.json'].week.map;
  const chosen = [500, 501, 502].find(id => id !== autoPick);
  const weeks = [week('2026-W43', utc(2026, 10, 18, 23), { vote: posted, mapVote: { week: '2026-W45', candidates: [chosen, autoPick], winner: 0, map: chosen } })];

  const { files, state } = exportIn(now, weeks, auto.state);

  assert.equal(files['challenges.json'].week.map, chosen);
  assert.equal(state.weeks['2026-W45'], chosen);
  assert.equal(files['challenges.json'].weekly.past[0].map, auto.state.weeks['2026-W43'] ?? null);
});

test('with no counted vote the automatic pick stands', () => {
  const now = utc(2026, 11, 4);
  const weeks = [week('2026-W44', utc(2026, 10, 26), { vote: posted, mapVote: { week: '2026-W46', candidates: [500, 501, 502] } })];
  const { files } = exportIn(now, weeks);
  assert.ok([500, 501, 502].includes(files['challenges.json'].week.map));
  assert.deepEqual(files['challenges.json'].weekly.mapVote.candidates, [[500, 4], [501, 4], [502, 4]]);
});
