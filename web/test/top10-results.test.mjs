// node --test web/test/top10-results.test.mjs
// A Top 10's results page (views/top10-results.ts, TOP10-DESIGN.md §5, §13.5, §13.10), without packs: the ranking from
// GET /api/top10/results as production serves the past editions (trimmed), shared spots and the tie-breaks between
// players level on score, names from the site's index or the edition's own, the switch between 2020's two lists, what
// shows before the reveal, and the hub handing a year's results to this view, in both languages.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { answerOf, editionsOf, nameOf, render, revealable, spotText, tieBreak, title, yearLabel } from '../src/views/top10-results.ts';
import { render as hub } from '../src/views/top10-hub.ts';
import { PT } from '../../assets/js/core/pt.js';

const NOW = Date.parse('2026-11-08T12:00:00Z') / 1000;
const ctxFor = (lang = 'en') => {
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => NOW, timeZone: 'UTC' }), now: () => NOW, data: 'https://data.example/', me: null };
};
const SEASON = { year: 2026, opens: '2026-12-01T00:00:00Z', closes: '2026-12-31T23:59:59Z', reveal: '2027-01-02T12:00:00Z', thanksUntil: '2027-01-31T23:59:59Z' };
// GET /api/top10 on production, 2026-11-08.
const HUB = {
  season: SEASON, turnout: 0, turnouts: { year: 0, alltime: 0 }, finalized: false,
  editions: [
    { year: 2025, kind: 'year', label: '2025' }, { year: 2024, kind: 'year', label: '2023–24' }, { year: 2022, kind: 'year', label: '2022' },
    { year: 2021, kind: 'year', label: '2021' }, { year: 2020, kind: 'year', label: '2020' }, { year: 2020, kind: 'alltime', label: 'All time (2020)' },
  ],
};

/** A core pack's players, as much of it as the view reads: no thumbnails, no name colours. */
function playersOf(list) {
  const ids = list.map(([id]) => id);
  const names = list.map(([, name]) => name);
  return {
    rows: ids.length, id: ids, name: { at: r => names[r] }, avatar64: { at: () => '' }, avatar128: { at: () => '' },
    colour: ids.map(() => 0), colourUntil: ids.map(() => 0),
  };
}

const ranked = (id, rank, score, more = {}) => ({
  id, rank, score, points: 0, lists: 0, eligible: 0, firsts: 0, positions: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], best: 1, worst: 1, mentions: 0, watch: 0, ...more,
});

// 2025 as production serves it (top 3, 10th and 11th), with its thread, names and lists.
const Y2025 = {
  year: 2025, kind: 'year', ballots: 9, edition: '2025', label: '2025', past: true, thread: 'https://osu.ppy.sh/community/forums/topics/2172025',
  ranking: [
    ranked(14917517, 1, 10, { points: 80, lists: 8, eligible: 8, firsts: 8, positions: [8, 0, 0, 0, 0, 0, 0, 0, 0, 0] }),
    ranked(24642612, 2, 8.63, { points: 69, lists: 8, eligible: 8, firsts: 1, positions: [1, 3, 4, 0, 0, 0, 0, 0, 0, 0] }),
    ranked(16935754, 3, 8.63, { points: 69, lists: 8, eligible: 8, firsts: 0, positions: [0, 5, 3, 0, 0, 0, 0, 0, 0, 0] }),
    ranked(10067533, 10, 2.25, { points: 18, lists: 7, eligible: 8, positions: [0, 0, 0, 0, 0, 0, 0, 4, 3, 0] }),
    ranked(4095868, 11, 1, { points: 9, lists: 9, eligible: 9, positions: [0, 0, 0, 0, 0, 0, 0, 0, 0, 9] }),
  ],
  mentions: [{ id: 23114439, count: 5 }], watch: [{ id: 18649724, count: 2 }],
  names: { 14917517: 'suzuhiro77', 24642612: 'anomi', 16935754: 'ExPin', 10067533: 'TRUE_PLAYER36', 4095868: 'Nelson', 23114439: 'iPPC', 18649724: 'Warp' },
  lists: [{ voter: 14917517, post: 'https://osu.ppy.sh/community/forums/posts/10124622' }],
};
// The site's index has everyone but anomi (24642612), whose osu! profile is gone.
const PLAYERS = playersOf([[14917517, 'suzuhiro77'], [16935754, 'ExPin'], [10067533, 'TRUE_PLAYER36'], [4095868, 'Nelson'], [23114439, 'iPPC'], [18649724, 'Warp']]);
const data = (more = {}) => ({ year: 2025, kind: 'year', season: SEASON, phase: 'before', hub: HUB, results: Y2025, missing: null, trouble: null, players: PLAYERS, ...more });

test('the endpoint’s answer: results, not out yet, none for that year, or trouble', () => {
  assert.equal(answerOf(200, Y2025).results, Y2025);
  assert.deepEqual(answerOf(404, { code: 'not_yet', reveal: SEASON.reveal }), { results: null, missing: 'not_yet', trouble: null });
  assert.deepEqual(answerOf(404, { code: 'not_published' }), { results: null, missing: 'none', trouble: null });
  assert.deepEqual(answerOf(404, {}), { results: null, missing: 'none', trouble: null });
  assert.equal(answerOf(0, {}).trouble, 'offline');
  assert.equal(answerOf(500, {}).trouble, 'error');
  assert.equal(answerOf(200, { error: 'odd' }).trouble, 'error');
});

test('shared spots read "=2", and players level on score say which tie-break put one ahead', () => {
  const r = Y2025.ranking;
  assert.equal(tieBreak(r[1], r[2]), 'firsts');
  assert.equal(tieBreak(r[0], r[1]), null);
  // 2021: [SS]Bell and PTrollYO both 2.33, Bell on more lists.
  assert.equal(tieBreak(ranked(1, 8, 2.33, { lists: 5 }), ranked(2, 9, 2.33, { lists: 4 })), 'lists');
  assert.equal(tieBreak(ranked(1, 4, 5, { lists: 3, positions: [0, 2, 0, 1, 0, 0, 0, 0, 0, 0] }), ranked(2, 5, 5, { lists: 3, positions: [0, 0, 3, 0, 0, 0, 0, 0, 0, 0] })), 'median');
  assert.equal(tieBreak(ranked(1, 4, 5, { lists: 1, positions: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0], mentions: 2 }), ranked(2, 5, 5, { lists: 1, positions: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0] })), 'mentions');
  const tied = [ranked(1, 1, 9), ranked(2, 2, 6), ranked(3, 2, 6), ranked(4, 4, 3)];
  assert.deepEqual(tied.map((_, i) => spotText(tied, i)), ['1', '=2', '=2', '4']);
  assert.equal(tieBreak(tied[1], tied[2]), 'shared');

  const out = String(render(ctxFor(), data({ results: { ...Y2025, ranking: tied, names: { 1: 'a', 2: 'b', 3: 'c', 4: 'd' } }, players: null })));
  assert.match(out, /<span class="t10-spot">=2<\/span>/);
  assert.match(out, /Shares the spot with c/);
  assert.match(out, /Shares the spot with b/);
});

test('2025: the ranking, its figures and spots strip, the tie-break, the also-rans, the source and how it’s scored', () => {
  const out = String(render(ctxFor(), data()));
  assert.match(out, /Top 10 of 2025/);
  assert.match(out, /<b>8\.63<\/b><small>\/10<\/small>/);
  assert.match(out, /<b>10\.00<\/b>/);
  assert.match(out, /69 points\s+· on 8 of 8 lists · <b>1 #1 vote<\/b>/);
  assert.match(out, /<b>8 #1 votes<\/b>/);
  assert.match(out, /Same score as ExPin, ahead on #1 votes\./);
  assert.match(out, /aria-label="Spots on the lists: #1 ×1, #2 ×3, #3 ×4"/);
  assert.match(out, /Combined from the 9 lists posted in the osu! forum thread/);
  assert.match(out, /href="https:\/\/osu\.ppy\.sh\/community\/forums\/topics\/2172025"/);
  assert.match(out, /href="https:\/\/osu\.ppy\.sh\/community\/forums\/posts\/10124622"[^>]*>suzuhiro77 ↗/);
  // Nelson is 11th: below the top 10, under "also received votes".
  const [top, more] = out.split('Also received votes');
  assert.match(top, /TRUE_PLAYER36/);
  assert.doesNotMatch(top, /Nelson/);
  assert.match(more, /Nelson/);
  assert.match(out, /Honourable mentions[\s\S]*iPPC[\s\S]*×5/);
  assert.match(out, /Ones to watch[\s\S]*Warp/);
  assert.match(out, /How it’s scored/);
  assert.match(out, /Past editions are counted with today’s formula/);
  assert.doesNotMatch(out, /data-t10-reveal/);
  assert.equal(revealable(data()), false);
});

test('names: the site’s index (linked to the profile), else the edition’s own, else #id', () => {
  const d = data();
  assert.equal(nameOf(d, 16935754), 'ExPin');
  assert.equal(nameOf(d, 24642612), 'anomi');
  assert.equal(nameOf(d, 999), '#999');
  assert.equal(nameOf({ players: null, results: Y2025 }, 16935754), 'ExPin');
  const out = String(render(ctxFor(), d));
  assert.match(out, /href="\/player\/16935754"/);
  assert.doesNotMatch(out, /href="\/player\/24642612"/);
  assert.match(out, /<span class="player t10-res-name"><img class="avatar" src="https:\/\/a\.ppy\.sh\/24642612"[^>]*><span>anomi<\/span>/);
  // Without the core pack, nobody links, and the names still come.
  const bare = String(render(ctxFor(), data({ players: null })));
  assert.doesNotMatch(bare, /href="\/player\//);
  assert.match(bare, /ExPin/);
});

test('2020: the year’s list and the all-time one switch between each other; labels name the year, not "All time (2020)"', () => {
  const at = { ...Y2025, year: 2020, kind: 'alltime', edition: '2020', label: 'All time (2020)', ballots: 7 };
  const d = data({ year: 2020, kind: 'alltime', results: at });
  const out = String(render(ctxFor(), d));
  assert.match(out, /Top 10 of all time · 2020/);
  assert.match(out, /<nav class="chips t10-kinds"[^>]*><a class="chip " href="\/top10\/2020"[^>]*>🏆 Top 10 of 2020<\/a><a class="chip active" href="\/top10\/2020\/alltime" aria-current="page">👑 Top 10 of all time/);
  assert.match(out, /href="\/top10\/2020\/alltime"[^>]*>2020, all time<\/a>/);
  assert.doesNotMatch(out, /All time \(2020\)/);
  // No ones to watch on an all-time list.
  assert.doesNotMatch(out, /Ones to watch/);
  assert.equal(title(ctxFor(), d), 'Top 10 of all time · 2020');
  // 2025 has only its year's list: no switch.
  assert.doesNotMatch(String(render(ctxFor(), data())), /t10-kinds/);
  // 2023–24 is keyed 2024.
  assert.equal(yearLabel(2024, HUB), '2023–24');
  assert.equal(yearLabel(2024, null), '2023–24');
  assert.equal(yearLabel(2020, HUB), '2020');
  assert.equal(title(ctxFor(), data({ year: 2024, results: { ...Y2025, year: 2024, label: '2023–24' } })), 'Top 10 of 2023–24');
  assert.deepEqual(editionsOf(HUB).map(e => `${e.year}${e.kind === 'alltime' ? 'a' : ''}`), ['2020', '2020a', '2021', '2022', '2024', '2025']);
});

test('before the reveal, a year to come, or none: what the hub said, and the editions', () => {
  const soon = String(render(ctxFor(), data({ year: 2026, results: null, missing: 'not_yet' })));
  assert.match(soon, /The results come out/);
  assert.match(soon, /href="\/top10\/ballots"/);
  assert.match(soon, /href="\/top10\/2025"/);
  assert.match(String(render(ctxFor(), data({ year: 2027, results: null, missing: 'not_yet' }))), /There’s no Top 10 of 2027 yet/);
  assert.match(String(render(ctxFor(), data({ year: 2019, results: null, missing: 'none' }))), /There are no results for this one/);
  // This season's once they're out: the same view, ready for the reveal.
  const live = data({ year: 2026, phase: 'revealed', results: { year: 2026, kind: 'year', ballots: 12, ranking: Y2025.ranking } });
  assert.equal(revealable(live), true);
  const out = String(render(ctxFor(), live));
  assert.match(out, /data-t10-reveal/);
  assert.match(out, /12 ballots counted\./);
  assert.match(out, /href="\/top10\/ballots"/);
});

test('in Portuguese', () => {
  const out = String(render(ctxFor('pt'), data()));
  assert.match(out, /<b>8,63<\/b>/);
  assert.match(out, /69 pontos\s+· em 8 de 8 listas/);
  assert.match(out, /Mesma pontuação que ExPin, à frente nos votos em #1\./);
  assert.match(out, /Também receberam votos/);
  assert.match(out, /Como se pontua/);
});

test('the hub hands a year’s results to the results view, and its past chips name 2020’s all-time list right', () => {
  const page = String(hub(ctxFor(), { season: SEASON, phase: 'before', hub: HUB, trouble: null, signInHere: false, shown: data() }));
  assert.match(page, /t10-res-row/);
  assert.doesNotMatch(page, /t10-ballot-cards/);
  const own = String(hub(ctxFor(), { season: SEASON, phase: 'before', hub: HUB, trouble: null, signInHere: false }));
  assert.match(own, /t10-ballot-cards/);
  assert.match(own, /href="\/top10\/2020\/alltime"[^>]*>2020, all time</);
});
