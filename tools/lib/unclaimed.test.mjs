// node --test tools/lib/unclaimed.test.mjs
// Maps picked from the beatmap cache rather than from PT plays (Challenges → Unclaimed, a set's other difficulties)
// must be ones osu!catch can play. The bot's cache files taiko and mania difficulties as catch (mode 2), so only the
// catch dump's star rating (catch_difficulty) vouches for a map.

import test from 'node:test';
import assert from 'node:assert/strict';
import { build, isCatchPlayable, isUnclaimedCandidate } from './build.mjs';

const map = (id, extra = {}) => ({
  beatmap_id: id, beatmapset_id: 100, approved: '1', approved_date: '2020-01-01T00:00:00Z', playmode: '2',
  artist: 'A', title: `Map ${id}`, creator: 'C', version: 'Platter', difficultyrating: 3, playcount: 1000 - id,
  catch_difficulty: true, ...extra,
});
// A mania diff as the bot's cache holds it: filed as catch, with no catch star rating from the dump.
const maniaLooking = map(2, { version: '[4K] ADVANCED Lv.12', diff_size: 4, playcount: 2_058_934, catch_difficulty: undefined });
const taikoLooking = map(3, { version: 'Taiko Oni', diff_size: 5, playcount: 1_500_000, catch_difficulty: undefined });

test('only a map the catch dump rated is catch-playable, whatever mode the cache files it under', () => {
  assert.equal(isCatchPlayable(map(1)), true);
  assert.equal(isCatchPlayable(map(1, { playmode: '0' })), true); // a convert
  assert.equal(isCatchPlayable(maniaLooking), false);
  assert.equal(isCatchPlayable(map(1, { playmode: '3' })), false); // an API lookup said mania
  assert.equal(isCatchPlayable(undefined), false);
  assert.equal(isUnclaimedCandidate(maniaLooking), false);
  assert.equal(isUnclaimedCandidate(map(1)), true);
  assert.equal(isUnclaimedCandidate(map(1, { playmode: '0' })), false); // converts aren't "unclaimed" catch maps
});

test('mania and taiko maps filed as catch reach neither the unclaimed list nor a set\'s difficulties', () => {
  const beatmaps = new Map([[1, map(1)], [2, maniaLooking], [3, taikoLooking], [4, map(4, { beatmapset_id: 200 })]]);
  const bot = { players: [], ptCatch: [], banned: new Set(), ptCatchState: {} };
  const { files } = build({ bot, beatmaps, homeCountry: 'PT', now: Date.parse('2026-10-25T12:00:00Z') / 1000, state: {} });

  const unclaimed = files['challenges.json'].unclaimed.map(r => r[0]);
  assert.deepEqual(unclaimed, [1, 4]); // the far more played mania and taiko diffs stay out
  assert.ok(!(2 in files['challenges.json'].maps) && !(3 in files['challenges.json'].maps));
  // Set 100 lists only its catch difficulty, so it has no switcher (and no page for the others).
  const sets = Object.values(files).filter((_, i) => Object.keys(files)[i].startsWith('sets/'));
  assert.ok(!sets.some(bucket => bucket[100]));
  const pages = Object.entries(files).filter(([name]) => name.startsWith('maps/')).flatMap(([, bucket]) => Object.keys(bucket).map(Number));
  assert.ok(!pages.includes(2) && !pages.includes(3));
});
