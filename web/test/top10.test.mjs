// node --test web/test/top10.test.mjs
// The Top 10's all-time ballot (TOP10-DESIGN.md §13.11) on the client, without packs: which ballot a value means, a
// voter's ballot and the turnout of each kind from GET /api/top10 (and from a server from before kinds), careers from
// history.json and the picker's order and filters, the hub's two ballots, and finalize's preview of both kinds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { kindOf, myBallotOf, turnoutOf } from '../src/ui/top10.ts';
import { byPp, careerOf } from '../src/ui/top10-players.ts';
import { editorOf, shownCandidates } from '../src/views/top10-ballot.ts';
import { render as hub } from '../src/views/top10-hub.ts';
import { finalizePreview } from '../src/views/top10-admin.ts';
import { PT } from '../../assets/js/core/pt.js';

const NOW = Date.parse('2026-12-10T12:00:00Z') / 1000;
const ctxFor = (lang = 'en', me = 111) => {
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => NOW, timeZone: 'UTC' }), now: () => NOW, data: 'https://data.example/', me };
};
const SEASON = { year: 2026, opens: '2026-12-01T00:00:00Z', closes: '2026-12-31T23:59:59Z', reveal: '2027-01-02T12:00:00Z', thanksUntil: '2027-01-31T23:59:59Z' };
const cand = (id, more = {}) => ({
  row: 0, id, name: `p${id}`, active: false, pp: 0, ppJan: null, rank: 0, rankJan: 0, dan: -1, firsts: 0, last: 0,
  peak: 0, best: 0, since: null, legend: false, inactive: false, ...more,
});

test('a kind: alltime, or the year for anything else', () => {
  assert.equal(kindOf('alltime'), 'alltime');
  for (const v of ['year', undefined, null, '', 'ALLTIME', 3]) assert.equal(kindOf(v), 'year');
});

test('GET /api/top10: each kind’s ballot and turnout, and the yearly ones from a server from before kinds', () => {
  const now = { turnout: 7, turnouts: { year: 7, alltime: 3 }, me: { eligible: true, ballot: { status: 'submitted' }, ballots: { year: { status: 'submitted' }, alltime: { status: 'draft' } } } };
  assert.equal(turnoutOf(now, 'year'), 7);
  assert.equal(turnoutOf(now, 'alltime'), 3);
  assert.equal(myBallotOf(now, 'alltime').status, 'draft');
  const before = { turnout: 4, me: { eligible: true, ballot: { status: 'draft' } } };
  assert.equal(turnoutOf(before, 'year'), 4);
  assert.equal(turnoutOf(before, 'alltime'), undefined);
  assert.equal(myBallotOf(before, 'year').status, 'draft');
  assert.equal(myBallotOf(before, 'alltime'), null);
  assert.equal(myBallotOf(null, 'year'), null);
});

test('careers from history.json: the peak pp, the best rank at any point, the first year with pp', () => {
  // Three players over three days: 1 leads, then 2 passes 1, then 3 appears below them.
  const history = {
    days: ['2024-01-01', '2025-01-01', '2026-01-01'],
    series: {
      1: [[0, 0, 0, 5000], [1, 0, 0, 5100], [2, 0, 0, 5100]],
      2: [[0, 0, 0, 4000], [1, 0, 0, 6000], [2, 0, 0, 5900]],
      3: [[2, 0, 0, 1000]],
    },
    reconstructed: { days: ['2019-06-01'], series: { 1: [[0, 0, 0, 3000]] } },
  };
  const c = careerOf(history);
  assert.deepEqual(c.get(1), { peak: 5100, best: 1, since: 2019 });
  assert.deepEqual(c.get(2), { peak: 6000, best: 1, since: 2024 });
  assert.deepEqual(c.get(3), { peak: 1000, best: 3, since: 2026 });
  assert.equal(careerOf(null).size, 0);
});

test('the pickers: by official pp now (ties by name); all time: everyone, the active or the legends', () => {
  const list = byPp([cand(1, { pp: 1000, best: 1, peak: 9000 }), cand(2, { pp: 4000 }), cand(3, { pp: 5000, legend: true, inactive: true }), cand(4, { pp: 4000, name: 'a4' })]);
  assert.deepEqual(list.map(c => c.id), [3, 4, 2, 1]);
  const d = { kind: 'alltime', candidates: list };
  const e = editorOf(null, {}, 'alltime');
  assert.equal(e.filter, 'all');
  assert.deepEqual(e.watch, []);
  assert.deepEqual(shownCandidates(d, e).map(c => c.id), [3, 4, 2, 1]);
  assert.deepEqual(shownCandidates(d, { ...e, filter: 'legends' }).map(c => c.id), [3]);
  assert.deepEqual(shownCandidates(d, { ...e, filter: 'active' }).map(c => c.id), [4, 2, 1]);
  // Someone on your list stays in view whatever the filter.
  assert.deepEqual(shownCandidates(d, { ...e, filter: 'legends', rows: [{ id: 2, tie: false }] }).map(c => c.id), [3, 2]);
  assert.deepEqual(shownCandidates(d, { ...e, q: 'A4' }).map(c => c.id), [4]);
  // An old ballot's ones to watch don't come into an all-time editor.
  assert.deepEqual(editorOf({ picks: [], watch: [5], status: 'draft' }, {}, 'alltime').watch, []);
  assert.deepEqual(editorOf({ picks: [], watch: [5], status: 'draft' }, {}, 'year').watch, [5]);
});

test('the hub: both ballots, each with its turnout, where yours is and its way in, in both languages', () => {
  const hubData = { season: SEASON, turnout: 7, turnouts: { year: 7, alltime: 3 }, me: { eligible: true, ballot: { status: 'submitted' }, ballots: { year: { status: 'submitted' }, alltime: null } } };
  for (const lang of ['en', 'pt']) {
    const out = String(hub(ctxFor(lang), { season: SEASON, phase: 'open', hub: hubData, trouble: null, signInHere: false }));
    assert.match(out, /href="\/top10\/vote"/);
    assert.match(out, /href="\/top10\/vote\/alltime"/);
    assert.match(out, /t10-bc-year/);
    assert.match(out, /t10-bc-alltime/);
    assert.match(out, /<b>7<\/b>/);
    assert.match(out, /<b>3<\/b>/);
    assert.match(out, lang === 'pt' ? /Top 10 de sempre/ : /Top 10 of all time/);
  }
  // A past all-time edition among the chips (its results page is views/top10-results.ts's: top10-results.test.mjs).
  const past = { ...hubData, editions: [{ year: 2020, kind: 'alltime', label: '2020' }, { year: 2023, kind: 'year', label: '2023' }] };
  const page = String(hub(ctxFor(), { season: SEASON, phase: 'open', hub: past, trouble: null, signInHere: false }));
  assert.match(page, /href="\/top10\/2020\/alltime"[^>]*>2020, all time</);
  assert.match(page, /href="\/top10\/2023"/);
});

test('finalize’s preview: both kinds, the one left unpublished said so, and a server from before kinds', () => {
  const ctx = ctxFor();
  const core = { players: { rows: 0, id: [], name: { at: () => '' } } };
  const results = { year: 2026, ballots: 6, ranking: [], stats: { writeups: 0, words: 0, subjects: 0 } };
  const both = String(finalizePreview(ctx, core, { dryRun: true, year: 2026, results: { year: results, alltime: null }, unpublished: [{ kind: 'alltime', ballots: 3 }], payouts: [], thanks: [] }));
  assert.match(both, /Top 10 of 2026/);
  assert.match(both, /Top 10 of all time/);
  assert.match(both, /Unpublished: 3 counted ballots/);
  assert.match(both, /6 counted ballots/);
  const old = String(finalizePreview(ctx, core, { dryRun: false, results, payouts: [], thanks: [] }));
  assert.doesNotMatch(old, /all time/);
  assert.match(old, /Finalized\./);
});

test('the mods’ log on your ballot: all-time targets name the right player and say which ballot', async () => {
  const { logLine } = await import('../src/views/top10-ballot.ts');
  const core = { players: { rows: 2, id: [111, 222], name: { at: row => ['Alice', 'bob'][row] } } };
  const ctx = ctxFor();
  assert.equal(logLine(ctx, core, { admin: 1, action: 'strike', target: 'writeup:111:222', reason: 'filler' }), 'Struck your write-up about bob: filler');
  assert.equal(logLine(ctx, core, { admin: 1, action: 'strike', target: 'writeup:alltime:111:222', kind: 'alltime', reason: null }), 'Struck your all-time write-up about bob');
  assert.equal(logLine(ctx, core, { admin: 1, action: 'void', target: 'ballot:alltime:111', reason: 'alt' }), 'Voided your all-time ballot: alt');
  assert.equal(logLine(ctx, core, { admin: 1, action: 'void', target: 'ballot:111', reason: 'alt' }), 'Voided your ballot: alt');
  assert.equal(logLine(ctxFor('pt'), core, { admin: 1, action: 'void', target: 'ballot:alltime:111' }), 'Anulou o teu boletim de sempre');
});
