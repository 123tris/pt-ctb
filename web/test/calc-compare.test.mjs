// node --test web/test/calc-compare.test.mjs
// The calculator and compare pages, which read player packs where the old pages read whole player files: their maths
// against model.js's on the JSON of the same export, and both pages drawn in Node. The data tests skip without an
// export with packs (PTCATCH_DATA, as web/test/packs.test.mjs finds it).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore, readPlayer } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { WeightedTotals, countedPp } from '../src/ui/playerpack.ts';
import { rowOf } from '../src/ui/players.ts';
import { shared, aura, render as renderCompare } from '../src/views/compare.ts';
import { render as renderCalculator, results, startInputs } from '../src/views/calculator.ts';
import { S, M, CATS, boardComparator, weightedTotal, countedPp as countedPpJson } from '../../assets/js/core/model.js';
import { PT } from '../../assets/js/core/pt.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;
const buffer = file => { const b = fs.readFileSync(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const ctxFor = (lang, now = 1793796270, me = null) => {
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me };
};

/** The old calculator's search for the play that passes a total (pages/calculator.js), sorting every time. */
function ppToReachOld(scores, target) {
  const totalWith = extra => weightedTotal([...scores, extra].sort((a, b) => b - a));
  if (totalWith(3000) <= target) return null;
  let lo = 0, hi = 3000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (totalWith(mid) > target) hi = mid; else lo = mid;
  }
  return hi;
}

test('weighted totals with one more play: the same as sorting and summing again', () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const n of [0, 1, 2, 5, 50, 700]) {
    const pp = Array.from({ length: n }, () => Math.round(random() * 90000) / 100).sort((a, b) => b - a);
    if (n > 3) pp[2] = pp[1]; // a tie
    const totals = new WeightedTotals(pp);
    assert.ok(Math.abs(totals.total - weightedTotal(pp)) < 1e-9);
    for (const extra of [0, pp[1] ?? 1, 123.45, 1000, 3000]) {
      const old = weightedTotal([...pp, extra].sort((a, b) => b - a));
      assert.ok(Math.abs(totals.with(extra) - old) < 1e-9, `${n} plays + ${extra}`);
    }
    for (const target of [0, weightedTotal(pp) + 50, weightedTotal(pp) + 5000]) {
      const [a, b] = [totals.toReach(target), ppToReachOld(pp, target)];
      assert.ok(a === b || Math.abs(a - b) < 1e-6, `to reach ${target}: ${a} vs ${b}`);
    }
  }
});

test('counted pp from a player pack: model.js countedPp on their file', { skip }, () => {
  for (const { id } of json('players.json').slice(0, 40)) {
    const pack = readPlayer(buffer(path.join(dir, 'packs', 'player', `${id}.ptcb`)));
    const file = json(`players/${id}.json`);
    for (const cat of ['c', 'u']) assert.deepEqual(countedPp(pack, cat), countedPpJson(file, cat), `${id} ${cat}`);
  }
});

test('maps in common, who wins each, and the aura: as the old page works them out from both files', { skip }, () => {
  const ids = [6205809, 7385703, 3821475, 3006672, 4095868];
  for (const [x, y] of [[0, 1], [2, 3], [3, 0], [4, 0]]) {
    const [a, b] = [ids[x], ids[y]];
    if (!fs.existsSync(path.join(dir, 'packs', 'player', `${a}.ptcb`)) || !fs.existsSync(path.join(dir, 'packs', 'player', `${b}.ptcb`))) continue;
    const [pa, pb] = [a, b].map(id => readPlayer(buffer(path.join(dir, 'packs', 'player', `${id}.ptcb`))));
    const [fa, fb] = [a, b].map(id => json(`players/${id}.json`));
    for (const cat of CATS) {
      const theirs = new Map(fb.scores[cat].map(s => [s[S.MAP], s]));
      const compare = boardComparator(cat);
      const old = [];
      for (const sa of fa.scores[cat]) {
        const sb = theirs.get(sa[S.MAP]);
        if (!sb) continue;
        const order = compare([0, ...sa], [0, ...sb]);
        old.push({ map: sa[S.MAP], when: Math.max(sa[S.TIME], sb[S.TIME]), winner: order < 0 ? 'a' : order > 0 ? 'b' : null });
      }
      old.sort((p, q) => q.when - p.when);
      const now = shared(pa, pb, cat);
      assert.deepEqual(now.map(s => [s.map, s.winner]), old.map(s => [s.map, s.winner]), `${a} vs ${b} ${cat}`);
    }
    const auraOld = file => CATS.reduce((n, cat) => n + file.scores[cat].filter(s => s[S.MISS] === 0 && file.maps[s[S.MAP]]?.[M.STARS] >= 7).length, 0);
    assert.equal(aura(pa), auraOld(fa));
    assert.equal(aura(pb), auraOld(fb));
  }
});

test('both pages drawn in Node, in English and Portuguese', { skip }, () => {
  const core = readCore(buffer(path.join(dir, 'packs', 'core.ptcb')));
  const [a, b] = [rowOf(core.players, 6205809), rowOf(core.players, 7385703)];
  const packs = [6205809, 7385703].map(id => readPlayer(buffer(path.join(dir, 'packs', 'player', `${id}.ptcb`))));
  for (const lang of ['en', 'pt']) {
    const ctx = ctxFor(lang);
    const page = String(renderCompare(ctx, { core, a, b, packs, cat: 'c' }));
    assert.match(page, /<h1>[^<]+ vs [^<]+<\/h1>/);
    assert.ok((page.match(/class="cmp-row/g) ?? []).length === 11, 'ten stat rows and the aura');
    const rows = (page.match(/<div class="row">/g) ?? []).length;
    assert.equal(rows, Math.min(30, shared(packs[0], packs[1], 'c').length));
    const pickers = String(renderCompare(ctx, { core, a: -1, b: -1, packs: null, cat: 'c' }));
    assert.match(pickers, lang === 'en' ? /Classic rivalries/ : new RegExp(PT['Classic rivalries']));
    const calc = String(renderCalculator(ctxFor(lang, 1793796270, 6205809), { core, mapId: null, meta: null }));
    assert.ok(calc.includes(`value="${core.players.name.at(a)}"`), 'the signed-in player is picked');
    assert.ok(calc.includes(results(ctx, startInputs(null)).pp), 'the first result is drawn in');
  }
});
