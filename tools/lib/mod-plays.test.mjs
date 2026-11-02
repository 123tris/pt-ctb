// node --test tools/lib/mod-plays.test.mjs
// The mod rankings and the top plays' mod filters count the same plays as the bot's /modranking: every play the bot
// keeps on a map (the board play, a convert's pp play, each mod's best in ConvertModScores and the like, the dump's
// mod_scores), each map once with the player's best play that has the mods. Before, the site only had one play per map,
// so an HR play under a better HD one counted on the bot's HR board but not on the site's.

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './build.mjs';
import { S, topPlaysView } from '../../assets/js/core/model.js';

const ALICE = 1, BOB = 2;
const CONVERT = 500, CONVERT_2 = 501, RANKED_MAP = 600, RANKED_2 = 601, LOVED = 700;
const now = Date.UTC(2026, 10, 1, 12) / 1000;
const HD = 8, HR = 16, DT = 64;

const play = (uid, map, pp, mods, total = 1_000_000) => ({
  beatmap_id: map, user_id: uid, pp, score: total, maxcombo: 700, count300: 690, count100: 5, count50: 5,
  countmiss: 0, countkatu: 0, enabled_mods: mods, rank: 'S', date: '2026-10-20T00:00:00Z',
});

const player = (uid, name, extra = {}) => ({
  user_id: uid, username: name, country: 'PT', pp_raw: 5000, pp_rank: 1000, pp_country_rank: 10, accuracy: 98, level: 100,
  playcount: 1000, count_rank_ss: 1, count_rank_s: 2, count_rank_a: 3, profile_updated: '2026-10-25T00:00:00Z',
  TopConvertedScores: [], TopUnrankedScores: [], RankedSpecificScores: [], PreRankScores: [], DanPasses: [],
  ...extra,
});

// Alice's best plays are HD; under them the bot keeps an HR play on each map. Bob plays HR only.
function botData({ modPlays = true } = {}) {
  return {
    players: [
      player(ALICE, 'Alice', {
        TopConvertedScores: [play(ALICE, CONVERT, 200, HD), play(ALICE, CONVERT_2, 150, HD)],
        TopUnrankedScores: [play(ALICE, LOVED, 120, HD)],
        RankedSpecificScores: [play(ALICE, RANKED_MAP, 300, 0)],
        ...(modPlays ? {
          ConvertModScores: [play(ALICE, CONVERT, 180, HR, 900_000), play(ALICE, CONVERT_2, 100, HR, 800_000)],
          UnrankedModScores: [play(ALICE, LOVED, 90, HR, 900_000)],
        } : {}),
      }),
      player(BOB, 'Bob', { TopConvertedScores: [play(BOB, CONVERT, 190, HR)] }),
    ],
    // The dump: Alice's best on the ranked map is HD, and its mod plays add a DT play on another map.
    ptCatch: [{
      user_id: ALICE, username: 'Alice', country: 'PT', pp: 5000, top_scores: [play(ALICE, RANKED_MAP, 350, HD)],
      ...(modPlays ? { mod_scores: [play(ALICE, RANKED_2, 250, DT)] } : {}), community_scores: [],
    }],
    ptCatchState: {},
    banned: new Set(),
    weekly: { weeks: [], current: null },
  };
}

const map = (id, setId, mode, approved) => [id, { beatmap_id: id, beatmapset_id: setId, artist: 'A', title: `Map ${id}`, version: 'Hard', approved, playmode: mode, difficultyrating: 5 }];
const beatmaps = new Map([map(CONVERT, 50, 0, 1), map(CONVERT_2, 51, 0, 1), map(RANKED_MAP, 60, 2, 1), map(RANKED_2, 61, 2, 1), map(LOVED, 70, 2, 4)]);
const exportWith = options => build({ bot: botData(options), beatmaps, homeCountry: 'PT', now, state: {} }).files;
const board = (files, source, mods) => files['modrankings.json'].sources[source][mods].map(r => [r[0], r[1], r[2]]);

test('an HR convert play under a better HD one counts on the HR board', () => {
  const files = exportWith();
  assert.deepEqual(board(files, 'c', 'HR'), [[ALICE, 275, 2], [BOB, 190, 1]]); // 180 + 100 × 0.95
  assert.deepEqual(board(files, 'c', 'HD'), [[ALICE, 342.5, 2]]);              // the HD plays still count as before
  assert.deepEqual(board(files, 'u', 'HR'), [[ALICE, 90, 1]]);
});

test('the ranked boards count the dump, its mod plays and the bot\'s live plays together', () => {
  const files = exportWith();
  assert.deepEqual(board(files, 'r', 'NM'), [[ALICE, 300, 1]]);   // the live nomod play, beside the dump's HD one
  assert.deepEqual(board(files, 'r', 'DT'), [[ALICE, 250, 1]]);   // from the dump's mod plays
  assert.deepEqual(board(files, 'r', 'HD')[0], [ALICE, 675.38, 3]); // dump HD 350, then the HD converts 200 and 150
});

test('the top plays take each player\'s best play on a map with the mods, once', () => {
  const plays = exportWith()['topplays.json'];
  const view = mods => topPlaysView(plays.plays, 'c', mods, plays.cap).map(r => [r[0], r[S.MAP + 2], r[S.PP + 2]]);
  assert.deepEqual(view(HR), [[BOB, CONVERT, 190], [ALICE, CONVERT, 180], [ALICE, CONVERT_2, 100]]);
  assert.deepEqual(view(null), [[ALICE, CONVERT, 200], [BOB, CONVERT, 190], [ALICE, CONVERT_2, 150]]);
});

test('the mod plays change nothing else', () => {
  const [withMods, without] = [exportWith(), exportWith({ modPlays: false })];
  for (const name of ['players.json', `players/${ALICE}.json`, `maps/${CONVERT % 128}.json`, 'records.json']) {
    assert.deepEqual(withMods[name], without[name], name);
  }
});
