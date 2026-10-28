import test from 'node:test';
import assert from 'node:assert/strict';
import { MOD, S, matchesModFilter, parseModFilter, topPlaysView } from '../../assets/js/core/model.js';
import { build } from './build.mjs';

for (const name of ['NM', 'HD', 'HR', 'DT', 'FL', 'EZ', 'HT', 'HDHR', 'HDDT', 'HRDT']) {
  test(`${name} rankings and top plays include NF across all sources, preserving the score mods`, () => {
    const mods = parseModFilter(name);
    assert.equal(matchesModFilter(mods | MOD.NF, mods), true);
    assert.equal(matchesModFilter(MOD.NF | MOD.HR, 0), false);
    const scores = [], maps = new Map();
    for (let i = 1; i <= 6; i++) {
      scores.push({ beatmap_id: i, pp: i % 2 ? 100 : 90, score: 100000, enabled_mods: mods | (i % 2 ? 0 : MOD.NF),
        rank: 'S', date: '2026-10-01T00:00:00Z', count300: 100, count100: 0, count50: 0, countmiss: 0, countkatu: 0, maxcombo: 100 });
      maps.set(i, { beatmap_id: i, beatmapset_id: i, playmode: i <= 2 ? 0 : 2, approved: i > 4 ? 4 : 1,
        difficultyrating: 5, catch_difficulty: true, title: 'Map' });
    }
    const bot = { players: [{ user_id: 1, username: 'Player', country: 'PT', TopConvertedScores: scores.slice(0, 2),
      RankedSpecificScores: scores.slice(2, 4), TopUnrankedScores: scores.slice(4) }],
      ptCatch: [], ptCatchState: {}, banned: new Set() };
    const { files } = build({ bot, beatmaps: maps, homeCountry: 'PT', now: 1793000000, state: {} });
    for (const source of ['r', 'c', 'u']) {
      const row = files['modrankings.json'].sources[source][name][0];
      assert.equal(row[2], source === 'r' ? 4 : 2);
      if (source !== 'r') assert.equal(row[1], 185.5);
      const plays = files['topplays.json'];
      const matching = topPlaysView(plays.plays, source, mods, plays.cap);
      assert.equal(matching.filter(t => t[S.MODS + 2] & MOD.NF).length, source === 'r' ? 2 : 1);
    }
  });
}
