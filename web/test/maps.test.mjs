// node --test web/test/maps.test.mjs
// The Maps page, drawn in Node from an export's packs (as web/test/packs.test.mjs finds them; skipped without), and its
// search checked against the old page's: the same maps, in the same order, for many queries, filters and sorts.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore, readSearch } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { mapIndex, findMaps } from '../src/ui/map-search.ts';
import * as range from '../src/ui/star-range.ts';
import { render, readState } from '../src/views/maps.ts';
import { firstData, CORE, SEARCH } from '../src/routes.ts';
import { decodeMapsSearch } from '../../assets/js/core/maps-search.js';
import * as oldRange from '../../assets/js/core/star-range.js';
import { lang as oldLang } from '../../assets/js/core/i18n.js';
import { PT } from '../../assets/js/core/pt.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'search.ptcb')) && `no packs in ${dir}`;
const pack = name => {
  const bytes = fs.readFileSync(path.join(dir, 'packs', name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

const ctxFor = (lang, now = 1.8e9) => {
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me: null };
};

// The old page's search (assets/js/pages/maps.js, which needs a browser to load), as it was: its filter and its sorts,
// over maps-search.json's rows as the old decoder gives them. Each row's text is made once here instead of once per
// query, which changes nothing but the time.
const OLD_SORTS = {
  players: (a, b) => b[7] - a[7] || a[0] - b[0],
  stars: (a, b) => b[5] - a[5],
  easy: (a, b) => (a[5] || 99) - (b[5] || 99),
  new: (a, b) => b[0] - a[0],
};
function oldSearch(list, texts, { q, cat, stars, sort }) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = list.filter((r, i) => {
    if (cat && r[6] !== cat) return false;
    if (!oldRange.inStars(r[5], stars)) return false;
    if (!words.length) return true;
    const text = texts[i];
    return words.every(w => text.includes(w));
  });
  return filtered.sort(OLD_SORTS[sort]);
}

/** A small seeded random generator (mulberry32), so the sampled queries are the same each run. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let loaded = null;
function load() {
  loaded ??= (() => {
    const core = readCore(pack('core.ptcb'));
    const search = readSearch(pack('search.ptcb'));
    const list = decodeMapsSearch(json('maps-search.json'));
    const texts = list.map(r => `${r[0]} ${r[2]} ${r[3]} ${r[4]}`.toLowerCase());
    return { core, search, index: mapIndex(search), list, texts };
  })();
  return loaded;
}

const idsOf = (search, found) => Array.from(found, i => search.maps.id[i]);

/** The same maps in the same order; on a difference, where it starts (a full diff of 55k ids would take minutes). */
function sameMaps(actual, expected, label) {
  let at = 0;
  while (at < actual.length && actual[at] === expected[at]) at++;
  if (at === actual.length && at === expected.length) return;
  assert.fail(`${label}: ${actual.length} maps, the old page ${expected.length}; from #${at}: ${actual.slice(at, at + 5)} vs ${expected.slice(at, at + 5)}`);
}
const rowIds = page => [...page.matchAll(/<a class="plain-link row card-link" href="\/map\/(\d+)">/g)].map(m => Number(m[1]));

test('which pages the new client draws: /maps, with the core and search packs first', () => {
  assert.deepEqual(firstData('/maps'), { packs: [CORE, SEARCH], json: ['maps-top.json'] });
  assert.deepEqual(firstData('/maps/'), { packs: [CORE, SEARCH], json: ['maps-top.json'] });
  assert.equal(firstData('/maps/123'), null);
  assert.deepEqual(firstData('/map/123'), { packs: [CORE], json: ['maps/123.json', 'bounties.json'] }, 'a map is another page');
});

test('the star range reads, writes, labels and matches as the old one', () => {
  const ctx = ctxFor(oldLang === 'pt' ? 'pt' : 'en');
  const queries = [{}, { stars: '4-7' }, { stars: '7-' }, { stars: '-4' }, { stars: '0-4' }, { stars: '3.45-3.46' }, { stars: '9-3' },
    { stars: ' 2.7 - 4 ' }, { stars: '12-' }, { stars: '0-0' }, { stars: '10-10' }, { stars: 'x' }, { stars: '-' }, { stars: '0-10' },
    { diff: 'platter' }, { diff: 'dose' }, { diff: 'toString' }, { diff: 'nope' }, { stars: '1-2', diff: 'rain' }];
  for (const query of queries) {
    const [lo, hi] = range.parseStars(query);
    assert.deepEqual([lo, hi], oldRange.parseStars(query), JSON.stringify(query));
    assert.equal(range.formatStars([lo, hi]), oldRange.formatStars([lo, hi]), JSON.stringify(query));
    assert.equal(range.starsLabel(ctx, [lo, hi]), oldRange.starsLabel([lo, hi]), JSON.stringify(query));
    for (const stars of [0, 0.01, 1.99, 2, 2.7, 2.71, 3.99, 4, 4.01, 5.3, 9.99, 10, 10.01, 96.17]) {
      assert.equal(range.inStars(stars, [lo, hi]), oldRange.inStars(stars, [lo, hi]), `${stars} in ${JSON.stringify(query)}`);
    }
  }
  for (const r of [[0, 0], [4, 4], [10, 10], [3.04, 3.06], [7, 2], [-1, 12]]) assert.deepEqual(range.clampRange(r), oldRange.clampRange(r));
});

test('the search finds what the old page found, in the same order: queries × sorts', { skip }, () => {
  const { search, index, list, texts } = load();
  assert.equal(search.maps.rows, list.length);
  const queries = ['', ' ', 'a', 'e', 'x', 'z', 'the', 'love', 'feat.', 'remix', 'rain', 'cup', 'platter', 'insane', 'TV Size',
    '(tv size)', 'Elmo cookie', 'cookie butter', 'ASCENDANCE', '1207082', '12', '0', '9', '[', ']', '-', '.', "'", '&', 'ß', 'İ',
    'tsu·ba·sa', 'TSU·BA·SA', '·', 'ü', 'é', ' a ', 'a　b', '\uD83D', '😀', 'Σ', 'σ', 'zz no such map zz',
    'a b c d e', 'the the', 'ar od', '  Rain   hard  ', 'camellia', 'xi', 'nekodex', 'freedom dive', 'ascendance', 'muzzle',
    "kirby's", 'normal', 'salad', 'overdose', 'deluxe', 'extra', 'hard insane', 'expert', 'collab', 'gd', 'tv'];
  for (const q of queries) {
    for (const sort of ['players', 'stars', 'easy', 'new']) {
      const query = { q, cat: '', stars: range.ANY_STARS, sort };
      sameMaps(idsOf(search, findMaps(index, query)), oldSearch(list, texts, query).map(r => r[0]), `${JSON.stringify(q)} by ${sort}`);
    }
  }
});

test('the search with every category and star range', { skip }, () => {
  const { search, index, list, texts } = load();
  const ranges = [range.ANY_STARS, [0, 2], [2, 2.7], [2.7, 4], [4, 5.3], [5.3, 10], [0.1, 10], [0, 0.1], [9.9, 10], [4.3, 4.4], [3, 3.1]];
  const sorts = ['players', 'stars', 'easy', 'new'];
  let n = 0;
  for (const q of ['', 'a', 'the', '1']) {
    for (const cat of ['', 'c', 'u', 'r']) {
      for (const stars of ranges) {
        const query = { q, cat, stars, sort: sorts[n++ % sorts.length] };
        sameMaps(idsOf(search, findMaps(index, query)), oldSearch(list, texts, query).map(r => r[0]), JSON.stringify(query));
      }
    }
  }
});

test('the search on queries sampled from the maps themselves, with random filters and sorts', { skip }, () => {
  const { search, index, list, texts } = load();
  const rand = random(20261104);
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const snippet = () => {
    const r = pick(list);
    const field = String(pick([r[0], r[2], r[3], r[4]]));
    const at = Math.floor(rand() * field.length);
    const text = field.slice(at, at + 1 + Math.floor(rand() * 8));
    return rand() < 0.3 ? text.toUpperCase() : text;
  };
  const ranges = [range.ANY_STARS, range.ANY_STARS, [0, 2], [2.7, 4], [5.3, 10], [1.5, 6.2]];
  let matched = 0;
  for (let k = 0; k < 400; k++) {
    const q = rand() < 0.25 ? `${snippet()} ${snippet()}` : rand() < 0.1 ? ` ${snippet()}\t` : snippet();
    const query = rand() < 0.5
      ? { q, cat: '', stars: range.ANY_STARS, sort: 'players' }
      : { q, cat: pick(['', 'c', 'u', 'r']), stars: pick(ranges), sort: pick(['players', 'stars', 'easy', 'new']) };
    const expected = oldSearch(list, texts, query).map(r => r[0]);
    matched += expected.length > 0;
    sameMaps(idsOf(search, findMaps(index, query)), expected, JSON.stringify(query));
  }
  assert.ok(matched > 300, `most sampled queries find something (${matched})`);
});

test('the first view: the most played maps, as the old page drew them from maps-top.json', { skip }, () => {
  const { core, search, index, list } = load();
  const ctx = ctxFor('en');
  const data = { core, index };
  const page = String(render(ctx, data, readState({})));
  const top = json('maps-top.json');
  assert.equal(top.total, search.maps.rows);
  assert.deepEqual(rowIds(page), [...top.rows].sort(OLD_SORTS.players).slice(0, 50).map(r => r[0]));
  assert.match(page, new RegExp(`<p class="result-count" id="count">${ctx.fmt.num(top.total)} maps</p>`));
  assert.ok(page.includes(`<p>${ctx.fmt.num(top.total)} maps with Portuguese plays.`));
  assert.ok(page.includes(`<span>Page 1 of ${ctx.fmt.num(Math.ceil(top.total / 50))}</span>`));
  assert.match(page, /data-page="prev" disabled>/);
  assert.match(page, /<option value="players" selected>Most players<\/option>/);
  assert.match(page, /<button class="chip active" type="button" data-cat="" aria-pressed="true">All<\/button>/);
  assert.match(page, /<span class="range-out" id="stars-out">Any<\/span>/);
  assert.match(page, /id="stars-reset" hidden>/);

  // Each row as the old page's row() drew it: the #1's name from players.json, or — for someone not on the site.
  const names = new Map(json('players.json').map(p => [p.id, p.name]));
  const byId = new Map(list.map(r => [r[0], r]));
  const rows = page.split('<a class="plain-link row card-link"').slice(1);
  assert.equal(rows.length, 50);
  for (const html of rows) {
    const r = byId.get(Number(/href="\/map\/(\d+)"/.exec(html)[1]));
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    assert.ok(html.includes(`<span class="map-title">${esc(r[3] ? `${r[2]} - ${r[3]}` : `Map #${r[0]}`)}</span>`), r[0]);
    assert.ok(html.includes(`${esc(r[3] ? `[${r[4]}]` : 'No map details')}</span>`), r[0]);
    assert.ok(html.includes(`<span class="cat cat-${r[6]}">`), r[0]);
    assert.ok(html.includes(`<span>${r[7]} player${r[7] === 1 ? '' : 's'}</span>`), r[0]);
    assert.ok(html.includes(`<span class="faint">#1</span> ${esc(names.get(r[8]) ?? '—')}</span>`), r[0]);
    assert.ok(html.includes(r[1] ? `src="https://assets.ppy.sh/beatmaps/${r[1]}/covers/list.jpg"` : '<span class="map-cover"></span>'), r[0]);
  }
  // A map whose set has no details reads "Map #id".
  const untitled = list.find(r => !r[3]);
  if (untitled) {
    const found = String(render(ctx, data, readState({ q: String(untitled[0]) })));
    assert.ok(found.includes(`<span class="map-title">Map #${untitled[0]}</span>`));
  }
});

test('the address: search, category, stars, sort and page, and only that page drawn', { skip }, () => {
  const { core, search, index, list, texts } = load();
  const ctx = ctxFor('en');
  const data = { core, index };
  const query = { q: 'a', cat: 'r', stars: '4-', sort: 'stars', page: '3' };
  const page = String(render(ctx, data, readState(query)));
  const expected = oldSearch(list, texts, { q: 'a', cat: 'r', stars: [4, 10], sort: 'stars' }).map(r => r[0]);
  assert.deepEqual(rowIds(page), expected.slice(100, 150));
  assert.match(page, new RegExp(`${ctx.fmt.num(expected.length)} of ${ctx.fmt.num(search.maps.rows)} maps`));
  assert.ok(page.includes('value="a"'));
  assert.match(page, /<option value="stars" selected>/);
  assert.match(page, /data-cat="r" aria-pressed="true"/);
  assert.match(page, /<span class="range-out on" id="stars-out">4★\+<\/span>/);
  assert.match(page, /style="--lo:40%;--hi:100%"/);
  // A page past the end shows the last one; nonsense shows the first.
  const last = String(render(ctx, data, readState({ ...query, page: '9999' })));
  assert.deepEqual(rowIds(last), expected.slice(Math.floor((expected.length - 1) / 50) * 50));
  assert.match(last, /data-page="next" disabled>/);
  assert.deepEqual(rowIds(String(render(ctx, data, readState({ ...query, page: 'x' })))), expected.slice(0, 50));
  // Unknown values are the defaults, as on the old page.
  assert.deepEqual(readState({ cat: 'x', sort: 'toString', page: '-2' }), { q: '', cat: '', stars: range.ANY_STARS, sort: 'players', page: 0 });
  // An old ?diff= link: that difficulty's star band.
  const platter = String(render(ctx, data, readState({ diff: 'platter' })));
  assert.match(platter, /id="stars-min" min="0" max="10" step="0.1" value="2.7"/);
  assert.match(platter, /id="stars-max" min="0" max="10" step="0.1" value="4"/);
  assert.match(platter, /<span class="range-out on" id="stars-out">2.7★ – 4★<\/span>/);
});

test('nothing found: the filters in words, and the way back', { skip }, () => {
  const { core, index } = load();
  const ctx = ctxFor('en');
  const none = String(render(ctx, { core, index }, readState({ q: 'zz no such map zz' })));
  assert.deepEqual(rowIds(none), []);
  assert.ok(none.includes('No maps match “zz no such map zz”.'));
  assert.match(none, /data-clear>Clear filters<\/button>/);
  assert.ok(!none.includes('class="pager"'));
  assert.match(none, /<p class="result-count" id="count">0 of [\d,]+ maps<\/p>/);
  const filtered = String(render(ctx, { core, index }, readState({ q: 'zz', cat: 'u', stars: '9.5-' })));
  assert.ok(filtered.includes('No maps match “zz” · Loved &amp; Unranked · 9.5★+.'));
});

test('Portuguese: the same page in the visitor’s language', { skip }, () => {
  const { core, index } = load();
  const page = String(render(ctxFor('pt'), { core, index }, readState({ stars: '2.5-' })));
  assert.ok(page.includes(`<h1>${PT.Maps}</h1>`));
  assert.ok(page.includes(PT['Most players']));
  assert.ok(page.includes('2,5★+'));
  assert.ok(!page.includes('<h1>Maps</h1>'));
});

test('a first visit’s first pages from maps-top.json are the pack’s, to the character', { skip }, () => {
  const core = readCore(pack('core.ptcb'));
  const index = mapIndex(readSearch(pack('search.ptcb')));
  const top = JSON.parse(fs.readFileSync(path.join(dir, 'maps-top.json'), 'utf8'));
  const text = makeText('en', {});
  const now = core.info.generatedAt[0];
  const ctx = { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me: null };
  for (const page of ['1', '2']) {
    const state = readState({ page });
    // The count differs on purpose: "54,908 maps" either way, but from the total until the pack is in.
    const fromPack = String(render(ctx, { core, index }, state));
    const fromTop = String(render(ctx, { core, index: null, top }, state));
    assert.equal(fromTop, fromPack, `page ${page}`);
  }
});
