// node --test tools/lib/weekly.test.mjs
// The community week (Lisbon time, as in the bot) and the weekly highlights block the exporter builds from the bot's
// Weekly/ files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { lisbonWeek, scoreId, modMask, weeklyBlock, sotwEvents } from './weekly.mjs';
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
  topPp: play(1, 11, 300), mostPlays: [[12, 400], [11, 200]],
  candidates: [{ lens: 'topPp', play: play(1, 11, 300) }, { lens: 'snipe', play: play(2, 12, 250) }, { lens: 'hardestFc', play: play(3, 13, 200) }],
  vote: null, winner: null, ...extra,
});

test('no weekly data: no block, so the page shows nothing', () => {
  assert.deepEqual(weeklyBlock(undefined, utc(2026, 10, 28)), { block: null, sotw: new Map(), mapIds: [] });
  assert.equal(weeklyBlock({ weeks: [], current: null }, utc(2026, 10, 28)).block, null);
});

test('the block: the week so far, the open vote and past weeks with their winners', () => {
  const now = utc(2026, 11, 4); // in 2026-W45
  const w43 = week('2026-W43', utc(2026, 10, 18, 23), { vote: { url: 'https://discord.com/channels/1/2/3' }, winner: 1, votes: [1, 4, 0] });
  const w44 = week('2026-W44', utc(2026, 10, 26), { vote: { url: 'https://discord.com/channels/1/2/4', posted: '2026-11-02T00:31:00Z' } });
  const current = { ...week('2026-W45', utc(2026, 11, 2)), candidates: [] };

  const { block, sotw, mapIds } = weeklyBlock({ weeks: [w44, w43], current }, now);

  assert.equal(block.current.week, '2026-W45');
  assert.deepEqual(block.current.top.slice(0, 3), [11, 'r', 1001]);
  assert.equal(block.current.top[2 + 11], 1); // S.ID: the solo score id
  assert.deepEqual(block.current.most, [[12, 400], [11, 200]]);
  assert.equal(block.vote.week, '2026-W44');
  assert.equal(block.vote.url, 'https://discord.com/channels/1/2/4');
  assert.deepEqual(block.vote.candidates.map(([lens, row]) => [lens, row[0]]), [['topPp', 11], ['snipe', 12], ['hardestFc', 13]]);
  assert.deepEqual(block.past.map(p => [p.week, p.sotw?.[0] ?? null, p.votes]), [['2026-W44', null, null], ['2026-W43', 12, 4]]);
  assert.equal(block.past[1].sotw[2 + 5], MOD.HD); // mods as a bitmask
  assert.deepEqual([...sotw], [[12, 1]]);
  assert.ok(mapIds.includes(1002));
});

test('a stale week so far (the bot stopped writing it) is left out', () => {
  const current = week('2026-W44', utc(2026, 10, 26));
  assert.equal(weeklyBlock({ weeks: [], current }, utc(2026, 11, 4)).block, null);
});

test('a Score of the week becomes an activity event when its vote closed', () => {
  const w43 = week('2026-W43', utc(2026, 10, 18, 23), { winner: 2 });
  const w44 = week('2026-W44', utc(2026, 10, 26), { vote: { posted: '2026-11-02T00:31:00Z' } });

  const events = sotwEvents([w43, w44], utc(2026, 1, 1), utc(2026, 11, 4));

  assert.deepEqual(events.map(e => [e.k, e.u, e.w, e.t]), [['sotw', 13, '2026-W43', utc(2026, 11, 2, 0) + 31 * 60]]);
  assert.equal(sotwEvents([w43, w44], utc(2026, 1, 1), utc(2026, 11, 1)).length, 0); // not decided yet then
});
