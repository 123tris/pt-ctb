// node --test tools/lib/bounties.test.mjs
// The bounty board (bounties.json): open bounties with their pledges (lapsed ones flagged), the hall of fame newest
// first, the wanted list without the maps that have an open bounty, removed bounties dropped, and none of the bot's
// Discord ids in the output. Claimed bounties are Activity events (a profile lists its own from the hall).

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './build.mjs';

const map = (id, stars, extra = {}) => ({
  beatmap_id: id, beatmapset_id: id, approved: '1', playmode: '2', title: `Map ${id}`, artist: 'A', version: 'V',
  difficultyrating: stars, max_combo: 1000, ...extra,
});
const play = (id, score, { miss = 0, mods = 0 } = {}) => ({
  beatmap_id: id, date: '2024-01-01T00:00:00', pp: score / 1e6, score, count300: 900, count100: 50, count50: 40,
  countmiss: miss, countkatu: 2, maxcombo: 1000, enabled_mods: mods, rank: miss ? 'A' : 'S',
});
const player = (user_id, username, ranked) => ({
  user_id, username, country: 'PT', RankedSpecificScores: ranked, TopConvertedScores: [], TopUnrankedScores: [], PreRankScores: [],
});

// Snowflakes beyond 2^53, as the bot writes them: JSON.parse rounds them, and none may come out anywhere. The bot leaves
// out a null note, target, until or pp, and writes "NM" for nomod.
const DISCORD = { channel: 987654321098765432, postedBy: 123456789012345678, byDiscord: 456789012345678901, message: 345678901234567890 };
const bountiesJson = `{ "nextId": 6, "channel": ${DISCORD.channel}, "bounties": [
  { "id": 1, "map": 10, "goal": "fc", "status": "open", "posted": "2026-10-20T12:00:00Z", "postedBy": ${DISCORD.postedBy}, "note": "go",
    "target": null, "pledges": [
      { "prize": "1 month of supporter", "by": "Pledger A", "byOsu": 1, "byDiscord": ${DISCORD.byDiscord}, "at": "2026-10-20T12:00:00Z" },
      { "prize": "a drawing", "by": "Pledger B", "byOsu": null, "byDiscord": ${DISCORD.byDiscord}, "at": "2026-10-20T12:00:00Z", "until": "2026-10-24T00:00:00Z" } ],
    "claim": null },
  { "id": 2, "map": 11, "goal": "snipe", "status": "open", "posted": "2026-10-22T12:00:00Z", "postedBy": ${DISCORD.postedBy}, "note": null,
    "target": 2, "pledges": [], "claim": null },
  { "id": 3, "map": 12, "goal": "pass", "status": "claimed", "posted": "2026-10-01T12:00:00Z", "postedBy": ${DISCORD.postedBy}, "note": null,
    "target": null, "pledges": [
      { "prize": "bragging rights", "by": "Pledger A", "byOsu": 1, "byDiscord": ${DISCORD.byDiscord}, "at": "2026-10-01T12:00:00Z", "until": null },
      { "prize": "gone before", "by": "Pledger C", "byOsu": 3, "byDiscord": ${DISCORD.byDiscord}, "at": "2026-10-01T12:00:00Z", "until": "2026-10-02T00:00:00Z" } ],
    "claim": { "user": 1, "score": 999, "at": "2026-10-05T12:00:00Z", "mods": "HDHR", "acc": 98.123, "combo": 1234, "pp": 512.34, "message": ${DISCORD.message} } },
  { "id": 4, "map": 13, "goal": "fc", "status": "done", "posted": "2026-10-10T12:00:00Z", "postedBy": ${DISCORD.postedBy},
    "pledges": [],
    "claim": { "user": 2, "score": 998, "at": "2024-01-01T00:00:00Z", "mods": "NM", "acc": 99.5, "combo": 1000, "pp": 300, "message": 0 } },
  { "id": 5, "map": 14, "goal": "fc", "status": "removed", "posted": "2026-10-11T12:00:00Z", "postedBy": ${DISCORD.postedBy}, "note": null,
    "target": null, "pledges": [], "claim": null }
] }`;

function run(bounties) {
  const beatmaps = new Map([[10, map(10, 7.2)], [11, map(11, 6.9)], [12, map(12, 8.1)], [13, map(13, 6.6)], [14, map(14, 6.8)], [15, map(15, 7.0)]]);
  // Maps 10, 14 and 15 are boss maps three players have passed, every one with a miss: the wanted list.
  const a = player(1, 'Alpha', [play(10, 900e6, { miss: 2 }), play(11, 800e6), play(14, 700e6, { miss: 1 }), play(15, 600e6, { miss: 4 })]);
  const b = player(2, 'Bravo', [play(10, 800e6, { miss: 5 }), play(11, 900e6), play(13, 600e6), play(14, 600e6, { miss: 3 }), play(15, 500e6, { miss: 6 })]);
  const c = player(3, 'Charlie', [play(10, 700e6, { miss: 9 }), play(14, 500e6, { miss: 2 }), play(15, 400e6, { miss: 7 })]);
  const bot = { players: [a, b, c], ptCatch: [], banned: new Set(), ptCatchState: {}, bounties };
  return build({ bot, beatmaps, homeCountry: 'PT', now: Date.parse('2026-10-25T12:00:00Z') / 1000, state: {} });
}

test('open bounties carry their board and pledges; lapsed pledges are flagged', () => {
  const { files } = run(JSON.parse(bountiesJson).bounties);
  const { open } = files['bounties.json'];
  // Newest first: the snipe (posted the 22nd), then the FC (the 20th).
  assert.deepEqual(open.map(r => [r[0], r[2]]), [[11, 'snipe'], [10, 'fc']]);
  const [snipe, fc] = open;
  assert.equal(snipe[6], 2); // the holder
  assert.deepEqual(snipe[7], []);
  assert.equal(fc[1], 'r');
  assert.equal(fc[3], Date.parse('2026-10-20T12:00:00Z') / 1000);
  assert.equal(fc[4], 3); // players
  assert.equal(fc[5], 2); // the closest: two misses
  assert.equal(fc[6], null); // no target for an FC
  assert.deepEqual(fc[7], [
    ['1 month of supporter', 'Pledger A', 1, null, false],
    ['a drawing', 'Pledger B', null, Date.parse('2026-10-24T00:00:00Z') / 1000, true],
  ]);
});

test('the hall of fame lists claims newest first, with the prizes still standing at the claim', () => {
  const { files } = run(JSON.parse(bountiesJson).bounties);
  const { hall, maps } = files['bounties.json'];
  assert.deepEqual(hall, [
    [12, 'r', 'pass', 'claimed', 1, Date.parse('2026-10-05T12:00:00Z') / 1000, 'HDHR', 98.12, 1234, 512.3, [['bragging rights', 'Pledger A', 1]], null],
    [13, 'r', 'fc', 'done', 2, Date.parse('2024-01-01T00:00:00Z') / 1000, '', 99.5, 1000, 300, [], null],
  ]);
  for (const id of [10, 11, 12, 13, 15]) assert.ok(maps[id], `map ${id} has its meta`);
});

test('wanted is the automatic list minus maps with an open bounty; removed bounties are dropped', () => {
  const { files } = run(JSON.parse(bountiesJson).bounties);
  const { open, hall, wanted } = files['bounties.json'];
  // 10 has an open bounty; 14's was removed, so it's wanted again, like 15.
  assert.deepEqual(wanted.map(r => r[0]).sort(), [14, 15]);
  assert.ok(![...open, ...hall].some(r => r[0] === 14));
  assert.equal(files['challenges.json'].bounties, undefined);
});

test('no Discord id reaches the output', () => {
  const { files } = run(JSON.parse(bountiesJson).bounties);
  const text = JSON.stringify(files);
  for (const [name, id] of Object.entries(DISCORD)) {
    assert.ok(!text.includes(String(id)), `${name} leaked`);
  }
  assert.ok(!/postedBy|byDiscord|"channel"|"message"|"note"/.test(JSON.stringify(files['bounties.json'])));
});

test('a claimed bounty is an Activity event; a done one is not', () => {
  const { files } = run(JSON.parse(bountiesJson).bounties);
  const claims = files['activity.json'].events.filter(e => e.k === 'bounty');
  assert.deepEqual(claims, [{ t: Date.parse('2026-10-05T12:00:00Z') / 1000, k: 'bounty', u: 1, m: 12, c: 'r', g: 'pass' }]);
  assert.ok(files['activity.json'].maps[12], 'the claimed map has its meta');
  assert.ok(!files['players/1-head.json'].extras.badges.some(b => b.name === 'Bounty hunter'));
});

test('no Bounties.json means an empty board, with the wanted list intact', () => {
  const { files } = run(undefined);
  const board = files['bounties.json'];
  assert.deepEqual([board.open, board.hall], [[], []]);
  assert.deepEqual(board.wanted.map(r => r[0]).sort(), [10, 14, 15]);
});
