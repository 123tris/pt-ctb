// node --test tools/lib/completion.test.mjs
// The completion goal (Tris's rules): a ranked catch-specific map counts as cleared once any tracked Portuguese player
// has passed it without NoFail. Failed plays, NF plays, pre-rank plays, restricted players and banned maps don't
// count; converts are their own count.

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './build.mjs';
import { completion, homeGoal, clearsMap, isRankedSpecific, isRankedConvert, NF } from './completion.mjs';

const now = Date.UTC(2026, 9, 25, 12) / 1000;
const day = 86400;
const iso = t => new Date(t * 1000).toISOString();

const map = (id, extra = {}) => ({
  beatmap_id: id, beatmapset_id: id * 10, approved: '1', approved_date: '2020-01-01T00:00:00Z', playmode: '2',
  artist: 'A', title: `Map ${id}`, creator: 'C', version: 'Platter', difficultyrating: 3, playcount: 1000 - id,
  catch_difficulty: true, ...extra,
});
const play = (map, extra = {}) => ({
  beatmap_id: map, score: 500000, maxcombo: 300, count300: 290, count100: 5, count50: 5, countmiss: 0, countkatu: 0,
  enabled_mods: 0, rank: 'A', pp: 50, date: iso(now - 30 * day), ...extra,
});
const player = (uid, extra = {}) => ({
  user_id: uid, username: `p${uid}`, country: 'PT', pp_raw: 1000, pp_rank: 1, profile_updated: '2026-10-25T00:00:00Z',
  TopConvertedScores: [], TopUnrankedScores: [], RankedSpecificScores: [], PreRankScores: [], DanPasses: [], ...extra,
});
const bot = ({ players = [], ptCatch = [], banned = [] } = {}) => ({ players, ptCatch, banned: new Set(banned), ptCatchState: {} });
const goal = (data, maps, previous) => completion({ bot: data, beatmaps: new Map(maps.map(m => [m.beatmap_id, m])), homeCountry: 'PT', previous });

test('a pass clears a map; a failed play or one with NoFail does not, at any accuracy', () => {
  assert.equal(NF, 1);
  assert.equal(clearsMap(play(1)), true);
  assert.equal(clearsMap(play(1, { rank: 'D', count300: 10, countmiss: 280 })), true); // no accuracy minimum
  assert.equal(clearsMap(play(1, { rank: 'F' })), false);
  assert.equal(clearsMap(play(1, { rank: null })), false);
  assert.equal(clearsMap(play(1, { passed: false, rank: 'A' })), false);
  assert.equal(clearsMap(play(1, { enabled_mods: NF })), false);
  assert.equal(clearsMap(play(1, { enabled_mods: NF | 8 | 64 })), false); // NFHDDT
  assert.equal(clearsMap(play(1, { enabled_mods: 2 | 8 | 16 })), true); // EZHDHR: no NF bit
});

test('only failed or NF plays leave a map uncleared; one clean pass from anyone clears it', () => {
  const maps = [map(1), map(2), map(3)];
  const { file } = goal(bot({
    players: [
      player(10, { RankedSpecificScores: [play(1, { enabled_mods: NF }), play(2, { rank: 'F' })] }),
      player(11, { RankedSpecificScores: [play(3, { enabled_mods: 1 | 16 })] }),
    ],
    ptCatch: [{ user_id: 12, username: 'p12', country: 'PT', top_scores: [], community_scores: [play(3, { enabled_mods: 16 })] }],
  }), maps);
  assert.equal(file.total, 3);
  assert.equal(file.cleared, 1);
  assert.deepEqual(file.left.map(r => r[0]), [1, 2]);
  assert.deepEqual(file.sole, [[12, 1]]);
  assert.equal(file.players, 1);
});

test('converts are counted apart from the catch-specific goal, and taiko or mania filed as catch count for neither', () => {
  const convert = map(4, { playmode: '0' });
  const mania = map(5, { catch_difficulty: undefined, version: '[4K] Hard' }); // the cache files it as catch
  const loved = map(6, { approved: '4' });
  const qualified = map(7, { approved: '3' });
  assert.equal(isRankedSpecific(map(1)), true);
  assert.equal(isRankedSpecific(convert), false);
  assert.equal(isRankedConvert(convert), true);
  assert.equal(isRankedSpecific(mania), false);
  assert.equal(isRankedConvert(mania), false);
  assert.equal(isRankedSpecific(map(1, { approved: '2' })), true); // approved counts as ranked

  const { file } = goal(bot({ players: [player(10, { TopConvertedScores: [play(4)], TopUnrankedScores: [play(6)], RankedSpecificScores: [play(5)] })] }),
    [map(1), convert, mania, loved, qualified]);
  assert.deepEqual({ total: file.total, cleared: file.cleared }, { total: 1, cleared: 0 });
  assert.deepEqual(file.converts, { total: 1, cleared: 1 });
  assert.deepEqual(file.left.map(r => r[0]), [1]);
});

test('restricted players clear nothing, and banned maps are out of the goal', () => {
  const maps = [map(1), map(2)];
  const data = bot({
    players: [player(10, { restricted_since: '2026-10-01T00:00:00Z', RankedSpecificScores: [play(1)] })],
    ptCatch: [{ user_id: 10, username: 'p10', country: 'PT', top_scores: [play(1)], community_scores: [play(1)] }],
    banned: [2],
  });
  const { file } = goal(data, maps);
  assert.equal(file.total, 1);
  assert.equal(file.cleared, 0);
  // A foreign player in the dump doesn't count either.
  const foreign = goal(bot({ ptCatch: [{ user_id: 20, username: 'x', country: 'BR', top_scores: [play(1)], community_scores: [] }] }), maps);
  assert.equal(foreign.file.cleared, 0);
});

test('a play from before its map was ranked does not clear it', () => {
  const fresh = map(1, { approved_date: iso(now - 10 * day) });
  const { file } = goal(bot({
    players: [player(10, {
      PreRankScores: [play(1, { date: iso(now - 40 * day) })], // the bot's pre-rank archive
      TopUnrankedScores: [play(1, { date: iso(now - 12 * day) })], // filed while unranked, before the ranked date
      RankedSpecificScores: [play(1, { date: iso(now - 60 * day) })], // older than the qualified period allows
    })],
  }), [fresh]);
  assert.equal(file.cleared, 0);
  // A play from the qualified period stays on the ranked board, so it counts.
  const qualified = goal(bot({ players: [player(10, { RankedSpecificScores: [play(1, { date: iso(now - 15 * day) })] })] }), [fresh]);
  assert.equal(qualified.file.cleared, 1);
});

test('the first clear is the earliest pass, and an earlier one recorded before is kept', () => {
  const data = bot({
    players: [
      player(10, { RankedSpecificScores: [play(1, { date: iso(now - 5 * day) })] }),
      player(11, { RankedSpecificScores: [play(1, { date: iso(now - 9 * day) }), play(2, { date: iso(now - 2 * day) })] }),
    ],
  });
  const fresh = goal(data, [map(1), map(2)]);
  assert.deepEqual(fresh.firsts, { 1: [11, now - 9 * day], 2: [11, now - 2 * day] });
  assert.deepEqual(fresh.file.recent, [[2, 11, now - 2 * day], [1, 11, now - 9 * day]]);
  assert.deepEqual(fresh.file.sole, [[11, 1]]);
  // Player 10 cleared map 1 first, then improved the play (the bot keeps only the best one).
  const kept = goal(data, [map(1), map(2)], { 1: [10, now - 20 * day], 2: [99, now - 30 * day] });
  assert.deepEqual(kept.firsts[1], [10, now - 20 * day]);
  assert.deepEqual(kept.firsts[2], [11, now - 2 * day]); // 99 isn't tracked (or restricted): not kept
});

test('the export writes the goal, a page for every uncleared map and the headline in meta.json', () => {
  const untitled = map(3, { beatmapset_id: 77, title: null, artist: null, creator: null, playcount: 5000 });
  const sibling = map(8, { beatmapset_id: 77, playmode: '0', title: 'Set title', artist: 'Set artist', creator: 'Mapper' });
  const beatmaps = new Map([map(1), map(2), untitled, sibling].map(m => [m.beatmap_id, m]));
  const data = { ...bot({ players: [player(10, { RankedSpecificScores: [play(1)] })] }), weekly: { weeks: [], current: null } };
  const { files, state } = build({ bot: data, beatmaps, homeCountry: 'PT', now, state: {} });

  const file = files['completion.json'];
  assert.deepEqual([file.cleared, file.total], [1, 3]);
  const home = files['meta.json'].completion;
  assert.deepEqual([home.cleared, home.total, home.players], [1, 3, 1]);
  assert.deepEqual(home.next.map(r => r[0]), [3, 2]); // equal stars: the most played on osu! first
  assert.deepEqual(home.sets, { 20: ['A', 'Map 2'], 77: ['Set artist', 'Set title'] });
  assert.deepEqual(home.latest, [1, 10, now - 30 * day]);
  assert.deepEqual(home.maps, { 1: file.maps[1] });
  assert.deepEqual(file.left.map(r => r[0]), [3, 2]); // most played on osu! first
  assert.deepEqual(file.sets[77], ['Set artist', 'Set title']);
  assert.ok(file.maps[1]);
  assert.deepEqual(Object.keys(state.cleared), ['1']);
  // The uncleared maps have a page (an empty board), the untitled one with its set's title.
  const page = files[`maps/${3 % 128}.json`][3];
  assert.deepEqual(page.s, []);
  assert.equal(page.c, 'r');
  assert.equal(page.m[1], 'Set title');
  assert.ok(files[`maps/${2 % 128}.json`][2]);
});

test('the home page gets the easiest maps still to clear, one per set, and the newest first clear', () => {
  const file = {
    cleared: 5, total: 10, players: 2,
    recent: [[1, 10, now], [2, 11, now - day]],
    maps: { 1: ['tuple 1'], 2: ['tuple 2'] },
    sets: { 50: ['A', 'Five'], 60: ['B', 'Six'], 70: ['C', 'Seven'], 80: ['D', 'Eight'] },
    // [mapId, setId, version, stars, rankedDay, osu! plays]
    left: [
      [5, 50, 'Hard', 4, null, 900], [6, 50, 'Cup', 1, null, 100], [7, 60, 'Salad', 2, null, 50],
      [8, 70, 'Platter', 2, null, 500], [9, 80, 'Cup', 0, null, 9000], [11, 0, 'Cup', 3, null, 1],
    ],
  };
  const home = homeGoal(file);
  // Stars first, then osu! plays; a second difficulty of a set already listed and maps with no star rating are skipped.
  assert.deepEqual(home.next.map(r => r[0]), [6, 8, 7]);
  assert.deepEqual(home.sets, { 50: ['A', 'Five'], 60: ['B', 'Six'], 70: ['C', 'Seven'] });
  assert.deepEqual(home.latest, [1, 10, now]);
  assert.deepEqual(home.maps, { 1: ['tuple 1'] });
  assert.deepEqual(file.left.map(r => r[0]), [5, 6, 7, 8, 9, 11]); // left as it was
  const none = homeGoal({ ...file, recent: [], left: [] });
  assert.deepEqual([none.next, none.sets, none.latest, none.maps], [[], {}, null, {}]);
});
