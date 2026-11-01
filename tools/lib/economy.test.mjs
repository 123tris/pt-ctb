// node --test tools/lib/economy.test.mjs
// Bananas in the export: economy.json from the bot's Economy/ folder (wallets, pouches, recent lines, the Records
// boards), tips and posted bounties in Activity, a bounty's pot and funders on the board, unlocks.json for the bot, and
// a clean export with no Economy/ at all. Nothing that isn't the contract's public fields comes out.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from './build.mjs';
import { loadEconomy } from './source.mjs';
import { unlocks } from './economy.mjs';

const NOW = Date.parse('2026-11-20T12:00:00Z') / 1000;
const map = (id, stars) => ({
  beatmap_id: id, beatmapset_id: id, approved: '1', playmode: '2', title: `Map ${id}`, artist: 'A', version: 'V',
  difficultyrating: stars, max_combo: 1000,
});
const play = (id, score, date = '2024-01-01T00:00:00') => ({
  beatmap_id: id, date, pp: score / 1e6, score, count300: 900, count100: 50, count50: 40,
  countmiss: 0, countkatu: 2, maxcombo: 1000, enabled_mods: 0, rank: 'S',
});
const player = (user_id, username, ranked) => ({
  user_id, username, country: 'PT', RankedSpecificScores: ranked, TopConvertedScores: [], TopUnrankedScores: [], PreRankScores: [],
});

// A Discord snowflake hidden where a careless export would copy it: a ledger ref and a line id.
const SNOWFLAKE = '987654321098765432';
const wallet = (balance, pouch, earned, extra = {}) => ({ balance, pouch, earned, escrow: 0, weekRepeatable: 0, signedIn: false, shield: false, title: null, signature: null, colour: null, colourUntil: null, ...extra });
const line = (id, t, user, amount, kind, ref, extra = {}) => ({ id, t, user, amount, kind, ref, note: null, pouch: false, ...extra });
const ECONOMY = {
  updated: '2026-11-20T11:45:00Z',
  wallets: {
    1: wallet(1400, 0, 1250, { signedIn: true, escrow: 600, title: 'Bounty hunter', signature: 10, colour: 'mint', colourUntil: '2026-12-01T00:00:00Z', role: 'sky', roleUntil: '2026-11-25T00:00:00Z' }), // over the gate
    2: wallet(700, 0, 420, { signedIn: true, shield: true, colour: 'gold', colourUntil: '2026-11-01T00:00:00Z' }), // signed in, under the gate; colour ran out
    3: wallet(0, 240, 240), // pouch only: never signed in
    99: wallet(5000, 0, 5000, { signedIn: true }), // not on the site: never shown
  },
  ledger: [
    line(1, '2026-11-02T10:00:00Z', 3, 120, 'snipe', 'snipe:111', { pouch: true }),
    line(2, '2026-11-03T10:00:00Z', 3, 120, 'fc.first', 'fc.first:222', { pouch: true }),
    line(3, '2026-10-30T10:00:00Z', 1, 500, 'hill.crown', 'crown:2026-10:HR:open'),
    line(4, '2026-11-05T10:00:00Z', 1, 750, 'bounty.claim', `bounty.claim:7:${SNOWFLAKE}`),
    line(5, '2026-11-06T10:00:00Z', 1, -20, 'tip.out', `tip:${SNOWFLAKE}`, { note: 'nice FC' }),
    line(6, '2026-11-06T10:00:00Z', 2, 20, 'tip.in', `tip:${SNOWFLAKE}`, { note: 'nice FC' }),
    line(7, '2026-11-07T10:00:00Z', 2, -50, 'bounty.fund', 'fund:4:2'),
    line(8, '2026-11-08T10:00:00Z', 1, -500, 'bounty.stake', 'stake:9'),
    line(9, '2026-11-08T10:00:00Z', 1, -100, 'bounty.fee', 'fee:9'),
    line(10, '2026-11-09T10:00:00Z', 99, -30, 'tip.out', 'tip:x'), // to and from someone not on the site
    line(11, '2026-11-09T10:00:00Z', 2, 30, 'tip.in', 'tip:x'),
  ],
};
const BOUNTIES = [
  { id: 9, map: 10, goal: 'fc', status: 'open', posted: '2026-11-08T10:00:00Z', postedBy: Number(SNOWFLAKE), stake: 500, fee: 100, poster: 1,
    funds: [{ user: 2, amount: 50, at: '2026-11-09T10:00:00Z' }, { user: 99, amount: 75, at: '2026-11-10T10:00:00Z' }],
    expires: '2027-01-07T10:00:00Z', mods: 'HD', pledges: [] },
  { id: 4, map: 11, goal: 'pass', status: 'open', posted: '2026-10-08T10:00:00Z', postedBy: Number(SNOWFLAKE), pledges: [{ prize: 'a drawing', by: 'X', byDiscord: Number(SNOWFLAKE), at: '2026-10-08T10:00:00Z' }] },
  { id: 7, map: 12, goal: 'pass', status: 'claimed', posted: '2026-10-20T10:00:00Z', stake: 600, poster: 2, funds: [], pledges: [],
    claim: { user: 1, score: 1, at: '2026-11-05T10:00:00Z', mods: 'NM', acc: 98, combo: 900, pp: 300, payout: 750, message: Number(SNOWFLAKE) } },
];

function run({ economy = ECONOMY, state = {} } = {}) {
  const beatmaps = new Map([[10, map(10, 7.2)], [11, map(11, 6.9)], [12, map(12, 8.1)]]);
  const players = [
    player(1, 'Alpha', [play(10, 900e6), play(11, 800e6, '2026-11-15T10:00:00'), play(12, 950e6)]),
    player(2, 'Bravo', [play(10, 800e6), play(11, 900e6)]),
    player(3, 'Charlie', [play(10, 700e6)]),
  ];
  return build({
    bot: { players, ptCatch: [], ptCatchState: {}, banned: new Set(), bounties: BOUNTIES, economy, plays: { from: null, lines: [] } },
    beatmaps, homeCountry: 'PT', now: NOW, state,
  });
}

test('economy.json: wallets of players on the site, recent lines, the boards and totals', () => {
  const { files } = run();
  const eco = files['economy.json'];
  assert.deepEqual(Object.keys(eco.players), ['1', '2', '3']);
  assert.deepEqual({ ...eco.players[1], r: undefined }, { b: 1400, p: 0, e: 1250, x: 600, s: 1, sh: 0, t: 'Bounty hunter', w: 0, sg: 10, c: 'mint', cu: Date.parse('2026-12-01T00:00:00Z') / 1000, ro: 'sky', ru: Date.parse('2026-11-25T00:00:00Z') / 1000, r: undefined });
  assert.deepEqual({ ...eco.players[3], r: undefined }, { b: 0, p: 240, e: 240, x: 0, s: 0, sh: 0, t: null, w: 0, sg: null, c: null, cu: null, ro: null, ru: null, r: undefined });
  assert.equal(eco.players[2].sh, 1);
  assert.equal(eco.players[2].c, null, 'a colour that ran out isn’t shown');
  // Newest first; the pouch flag; a tip's reason, nothing else's.
  // The latest lines are on each profile file, not economy.json.
  assert.equal(eco.players[3].r, undefined);
  assert.deepEqual(files['players/3.json'].ledger.map(r => r.slice(1)), [[120, 'fc.first', 1, null], [120, 'snipe', 1, null]]);
  assert.deepEqual(files['players/3-head.json'].ledger, files['players/3.json'].ledger);
  assert.deepEqual(files['players/1.json'].ledger[2].slice(1), [-20, 'tip.out', 0, 'nice FC']);
  assert.equal(eco.month, '2026-11');
  assert.deepEqual(eco.boards.earned, [[1, 750], [3, 240]], 'this month only: the October crown doesn’t count');
  assert.deepEqual(eco.boards.hunters, [[1, 750, 1]]);
  assert.deepEqual(eco.boards.generous, [[2, 50], [1, 20]]);
  assert.deepEqual(eco.totals, { supply: 1400 + 700 + 240 + 600, wallets: 2100, pouches: 240, escrow: 600, signedIn: 2, mintedMonth: 990, burnedMonth: 100 });
});

test('Activity: tips between players on the site and bounties players posted; a claim carries its payout', () => {
  const { files } = run();
  const events = files['activity.json'].events;
  assert.deepEqual(events.filter(e => e.k === 'tip'), [{ t: Date.parse('2026-11-06T10:00:00Z') / 1000, k: 'tip', u: 1, v: 2, a: 20, n: 'nice FC' }]);
  assert.deepEqual(events.filter(e => e.k === 'post').map(e => [e.u, e.m, e.g, e.a]), [[1, 10, 'fc', 500], [2, 12, 'pass', 600]]);
  assert.equal(events.find(e => e.k === 'bounty').a, 750);
});

test('the board: a bounty’s pot, funders (not on the site: unnamed), poster, expiry and mods; a house bounty has none', () => {
  const { files } = run();
  const open = files['bounties.json'].open;
  const banana = open.find(r => r[0] === 10);
  assert.deepEqual(banana.slice(8), [9, 625, [[null, 75], [2, 50]], 1, Date.parse('2027-01-07T10:00:00Z') / 1000, 'HD', 500]);
  const house = open.find(r => r[0] === 11);
  assert.deepEqual(house.slice(8), [4, null, [], null, null, null, null]);
  assert.equal(files['bounties.json'].hall[0][11], 750);
});

test('no Discord id, ledger ref or line id reaches any file', () => {
  const { files } = run();
  const text = JSON.stringify(files);
  assert.ok(!text.includes(SNOWFLAKE.slice(0, 12)), 'no snowflake');
  assert.ok(!text.includes('crown:2026-10') && !text.includes('fund:4:2') && !text.includes('stake:9'), 'no refs');
  assert.ok(!JSON.stringify(files['economy.json']).includes('"5000"') && !files['economy.json'].players[99]);
});

test('no Economy/ folder: no economy.json, no tips, and everything else as before', () => {
  const { files } = run({ economy: null });
  assert.equal(files['economy.json'], undefined);
  assert.ok(!files['activity.json'].events.some(e => e.k === 'tip'));
  assert.ok(files['bounties.json'].open.length && files['unlocks.json']);
});

test('loadEconomy: null without Economy/wallets.json; the ledger’s lines, a broken last line skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptctb-economy-'));
  try {
    assert.equal(loadEconomy(dir), null);
    fs.mkdirSync(path.join(dir, 'Economy'));
    assert.equal(loadEconomy(dir), null, 'a folder without wallets.json is still off');
    fs.writeFileSync(path.join(dir, 'Economy', 'wallets.json'), JSON.stringify({ updated: ECONOMY.updated, players: ECONOMY.wallets }));
    assert.deepEqual(loadEconomy(dir).ledger, [], 'no ledger yet');
    fs.writeFileSync(path.join(dir, 'Economy', 'ledger.jsonl'), `${ECONOMY.ledger.slice(0, 2).map(l => JSON.stringify(l)).join('\r\n')}\n{"id": 3, "t":`);
    const loaded = loadEconomy(dir);
    assert.equal(loaded.ledger.length, 2);
    assert.equal(loaded.wallets[1].balance, 1400);
    fs.writeFileSync(path.join(dir, 'Economy', 'wallets.json'), '{ nope');
    assert.equal(loadEconomy(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unlocks.json: records dated by their play; badges held when tracking began are dated 1970, new ones when first seen', () => {
  const { files, state } = run();
  const records = files['unlocks.json'].filter(u => u.kind === 'record');
  assert.ok(records.length);
  assert.ok(records.every(u => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(u.date) && Number.isInteger(u.osuId)));
  assert.ok(records.some(u => u.key === 'topCombo'));
  assert.deepEqual(Object.keys(files['unlocks.json'][0]), ['osuId', 'kind', 'key', 'date']);
  assert.ok(state.unlocks, 'the first-seen dates are kept in the state');

  // The badge logic itself, directly.
  const first = unlocks({ badges: [[1, ['wysi', 'digits3', null]]], records: {}, seen: undefined, now: NOW });
  assert.deepEqual(first.file.map(u => [u.key, u.date]), [['digits3', '1970-01-01T00:00:00Z'], ['wysi', '1970-01-01T00:00:00Z']]);
  const later = unlocks({ badges: [[1, ['wysi', 'digits2']], [2, ['wysi']]], records: {}, seen: first.seen, now: NOW });
  assert.deepEqual(later.file.map(u => [u.osuId, u.key, u.date]), [
    [1, 'wysi', '1970-01-01T00:00:00Z'], [1, 'digits2', '2026-11-20T12:00:00Z'], [2, 'wysi', '2026-11-20T12:00:00Z'],
  ]);
  assert.ok('digits3:1' in later.seen, 'a badge that went is remembered, so it’s never new again');
});

test('a name colour reaches players.json while it lasts, and the pinned play reaches the profile files', () => {
  const { files } = run();
  const alpha = files['players.json'].find(p => p.id === 1);
  assert.deepEqual([alpha.nc, alpha.ncu], ['mint', Date.parse('2026-12-01T00:00:00Z') / 1000]);
  assert.equal(files['players.json'].find(p => p.id === 2).nc, undefined, 'ran out');
  // Alpha pinned map 10: their play there, with its category, in both profile files, and the map's details.
  for (const name of ['players/1.json', 'players/1-head.json']) {
    const file = files[name];
    assert.equal(file.pinned[0], 'r', name);
    assert.equal(file.pinned[1], 10, name);
    assert.ok(file.maps[10], name);
  }
  assert.equal(files['players/2.json'].pinned, undefined);
});

test('meta.json carries the map of the week in brief, and the header search gets its own small index', () => {
  const { files } = run();
  assert.ok('week' in files['meta.json']);
  const search = files['search-maps.json'];
  assert.ok(search && Array.isArray(search.mappers));
  assert.ok(!files['maps-search.json'].mappers?.some(Boolean), 'the Maps page index leaves the mapper out');
});
