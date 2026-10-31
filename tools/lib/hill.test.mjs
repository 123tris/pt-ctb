// node --test tools/lib/hill.test.mjs
// King of the hill: the block the exporter builds from the bot's Hill/ files (the running month, the closed months,
// the crown tallies and the titles), and the folder being read, or not there at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hillBlock, seasonOf, seasonMonths } from './hill.mjs';
import { loadHill } from './source.mjs';
import { MOD } from '../../assets/js/core/model.js';

const play = (userId, hillScore, time, mods = []) => ({
  userId, username: `p${userId}`, scoreId: 9000 + userId, hillScore, acc: 98.5, combo: 700, miss: 0, mods, time,
});
const slot = (s, tier, beatmapId, board = []) => ({
  slot: s, tier, beatmapId, beatmapsetId: beatmapId * 10, artist: 'A', title: `T${beatmapId}`, version: 'V', creator: 'C',
  stars: 5.1, convert: s !== 'SP', holder: board[0] ?? null, board, snipes: board.map((e, i) => ({ time: e.time, fromUserId: board[i + 1]?.userId ?? null, toUserId: e.userId })),
});
const month = (id, status, slots) => ({ month: id, start: `${id}-01T00:00:00Z`, end: `${id}-28T00:00:00Z`, status, slots });
const crownsOf = months => ({
  months: months.map(m => ({ month: m.month, crowns: m.slots.filter(s => s.holder).map(s => ({ slot: s.slot, tier: s.tier, beatmapId: s.beatmapId, userId: s.holder.userId, username: s.holder.username })) })),
});

test('months and seasons in Lisbon terms', () => {
  assert.equal(seasonOf('2026-11'), '2026-Q4');
  assert.equal(seasonOf('2027-03'), '2027-Q1');
  assert.deepEqual(seasonMonths('2026-Q3'), ['2026-07', '2026-08', '2026-09']);
});

test('no Hill folder: no file, no profiles', () => {
  assert.deepEqual(hillBlock(null), { file: null, profiles: new Map(), mapIds: [] });
});

test('the running month: its pool by slot and tier, empty slots open, the players holding most', () => {
  const live = month('2026-11', 'live', [
    slot('HR', 'open', 3, [play(1, 900000, '2026-11-05T10:00:00Z', ['HR'])]),
    slot('NM', 'challenger', 2, []),
    slot('NM', 'open', 1, [play(1, 950000, '2026-11-03T10:00:00Z'), play(2, 940000, '2026-11-02T10:00:00Z')]),
    slot('FM', 'open', 4, [play(2, 990000, '2026-11-04T10:00:00Z', ['HD', 'HR'])]),
    { slot: 'HT', tier: 'open', beatmapId: 5 }, // not a slot the site knows
  ]);
  const { file, profiles } = hillBlock({ months: [live], current: live, crowns: null });
  assert.equal(file.current.status, 'live');
  assert.equal(file.current.start, Date.UTC(2026, 10, 1) / 1000);
  assert.deepEqual(file.current.pool.map(s => `${s.slot}/${s.tier}`), ['NM/open', 'NM/challenger', 'HR/open', 'FM/open']);
  const nm = file.current.pool[0];
  assert.deepEqual(nm.holder, { u: 1, name: 'p1', score: 950000, acc: 98.5, combo: 700, miss: 0, mods: 0, time: Date.UTC(2026, 10, 3, 10) / 1000, id: 9001 });
  assert.equal(nm.players, 2);
  assert.equal(file.current.pool[1].holder, null);
  assert.equal(file.current.pool[3].holder.mods, MOD.HD | MOD.HR);
  assert.deepEqual(file.current.leaders, { players: [1], held: 2 });
  assert.deepEqual(file.months, []);
  assert.deepEqual(file.players, []); // holding isn't a crown yet
  assert.deepEqual(profiles.get(1).holding, [['NM', 'open', 1], ['HR', 'open', 3]]);
  assert.equal(profiles.get(1).total, 0);
  assert.deepEqual(file.maps[1].slice(0, 5), ['A', 'T1', 'V', 10, 5.1]);
});

test('a draft pool shows no maps; a closed current month means no running one', () => {
  const draft = month('2026-12', 'draft', [slot('NM', 'open', 7, [])]);
  const { file } = hillBlock({ months: [], current: draft, crowns: null });
  assert.deepEqual({ ...file.current, start: 0, end: 0 }, { month: '2026-12', start: 0, end: 0, status: 'draft', pool: [], leaders: null });
  assert.deepEqual(file.maps, {});
  const closed = month('2026-11', 'closed', [slot('NM', 'open', 1, [play(1, 1, '2026-11-02T00:00:00Z')])]);
  const after = hillBlock({ months: [closed], current: closed, crowns: crownsOf([closed]) }).file;
  assert.equal(after.current, null);
  assert.equal(after.months.length, 1);
});

test('crowns add up by slot and season, and give the titles', () => {
  // Q3: p1 takes HR twice, NM and DT (All-rounder, HR king); p2 takes HR once and NM once. Q4 has only October.
  const jul = month('2026-07', 'closed', [
    slot('HR', 'open', 11, [play(1, 9, '2026-07-02T00:00:00Z')]), slot('HR', 'challenger', 12, [play(2, 9, '2026-07-02T00:00:00Z')]),
    slot('NM', 'open', 13, [play(2, 9, '2026-07-03T00:00:00Z')]), slot('SP', 'open', 14, []),
  ]);
  const aug = month('2026-08', 'closed', [slot('HR', 'open', 21, [play(1, 9, '2026-08-02T00:00:00Z')]), slot('NM', 'open', 22, [play(1, 9, '2026-08-02T00:00:00Z')])]);
  const sep = month('2026-09', 'closed', [slot('DT', 'open', 31, [play(1, 9, '2026-09-02T00:00:00Z')])]);
  const oct = month('2026-10', 'closed', [slot('FM', 'open', 41, [play(2, 9, '2026-10-02T00:00:00Z')])]);
  const nov = month('2026-11', 'live', [slot('FM', 'open', 51, [play(3, 9, '2026-11-02T00:00:00Z')])]);
  const months = [jul, aug, sep, oct, nov];
  const { file, profiles } = hillBlock({ months, current: nov, crowns: crownsOf([jul, aug, sep, oct]) });

  assert.deepEqual(file.players.map(([id, , total]) => [id, total]), [[1, 4], [2, 3]]);
  const [, , , slots, seasons] = file.players[0];
  assert.deepEqual(slots, [1, 0, 2, 1, 0, 0]); // NM HD HR DT FM SP
  assert.deepEqual(seasons, { '2026-Q3': [1, 0, 2, 1, 0, 0] });

  assert.deepEqual(file.months.map(m => [m.month, m.kings, m.most]), [['2026-10', [2], 1], ['2026-09', [1], 1], ['2026-08', [1], 2], ['2026-07', [2], 2]]);
  assert.equal(file.months[3].pool.find(s => s.slot === 'SP').holder, null);

  const [q4, q3] = file.seasons;
  assert.deepEqual(q3, { id: '2026-Q3', final: true, kings: { NM: [1, 2], HR: [1], DT: [1] }, allRounders: [1] });
  assert.deepEqual(q4, { id: '2026-Q4', final: false, kings: { FM: [2] }, allRounders: [] });

  assert.deepEqual(profiles.get(1).titles, [
    { kind: 'slot', season: '2026-Q3', slot: 'NM', final: true }, { kind: 'slot', season: '2026-Q3', slot: 'HR', final: true },
    { kind: 'slot', season: '2026-Q3', slot: 'DT', final: true }, { kind: 'allrounder', season: '2026-Q3', final: true },
    { kind: 'king', month: '2026-09', final: true }, { kind: 'king', month: '2026-08', final: true },
  ]);
  assert.deepEqual(profiles.get(2).titles.map(x => x.kind + (x.final ? '' : ' (so far)')), ['slot (so far)', 'king', 'slot', 'king']);
  assert.deepEqual(profiles.get(3), { total: 0, slots: [0, 0, 0, 0, 0, 0], titles: [], holding: [['FM', 'open', 51]] });
});

test('restricted players hold nothing and their crowns don\'t count', () => {
  const live = month('2026-11', 'live', [slot('NM', 'open', 1, [play(1, 9, '2026-11-02T00:00:00Z'), play(2, 8, '2026-11-01T12:00:00Z')])]);
  const oct = month('2026-10', 'closed', [slot('NM', 'open', 2, [play(1, 9, '2026-10-02T00:00:00Z'), play(2, 8, '2026-10-02T00:00:00Z')])]);
  const { file, profiles } = hillBlock({ months: [oct, live], current: live, crowns: crownsOf([oct]) }, new Set([1]));
  assert.equal(file.current.pool[0].holder.u, 2); // the next play holds a running slot
  assert.equal(file.current.pool[0].players, 1);
  assert.equal(file.months[0].pool[0].holder, null); // a closed month's crown was theirs: nobody
  assert.deepEqual(file.players, []);
  assert.equal(profiles.has(1), false);
});

test('without crowns.json the closed months\' holders are the crowns', () => {
  const oct = month('2026-10', 'closed', [slot('HD', 'open', 2, [play(5, 9, '2026-10-02T00:00:00Z')])]);
  const { file } = hillBlock({ months: [oct], current: null, crowns: null });
  assert.deepEqual(file.players, [[5, 'p5', 1, [0, 1, 0, 0, 0, 0], { '2026-Q4': [0, 1, 0, 0, 0, 0] }]]);
});

test('loadHill reads the month files, current.json and crowns.json, and null without the folder', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptctb-hill-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(loadHill(dir), null);
  fs.mkdirSync(path.join(dir, 'Hill'));
  assert.deepEqual(loadHill(dir), { months: [], current: null, crowns: null });
  const oct = month('2026-10', 'closed', []);
  fs.writeFileSync(path.join(dir, 'Hill', '2026-10.json'), `﻿${JSON.stringify(oct)}`); // .NET may write a BOM
  fs.writeFileSync(path.join(dir, 'Hill', '2026-11.json'), '{ cut sho');
  fs.writeFileSync(path.join(dir, 'Hill', 'current.json'), JSON.stringify(oct));
  fs.writeFileSync(path.join(dir, 'Hill', 'crowns.json'), JSON.stringify({ months: [] }));
  assert.deepEqual(loadHill(dir), { months: [oct], current: oct, crowns: { months: [] } });
});
