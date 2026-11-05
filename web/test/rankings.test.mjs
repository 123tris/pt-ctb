// node --test web/test/rankings.test.mjs
// The new client's first page, drawn in Node from an export's packs (as web/test/packs.test.mjs finds them; skipped
// without), and the edge's slice of packs.json that comes with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { render, readState } from '../src/views/rankings.ts';
import { inlineData } from '../edge/inline.ts';
import { firstData } from '../src/routes.ts';
import { PT } from '../../assets/js/core/pt.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;

const ctxFor = (lang, now) => {
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me: null };
};
const rowsOf = page => [...page.matchAll(/<tr( class="([^"]*)")? data-name="([^"]*)"/g)].map(m => ({ cls: m[2] ?? '', name: m[3] }));

test('which pages the new client draws, and their first data', () => {
  assert.deepEqual(firstData('/rankings'), { packs: ['packs/core.ptcb'], json: [] });
  assert.deepEqual(firstData('/rankings/ranked/'), { packs: ['packs/core.ptcb'], json: [] });
  assert.deepEqual(firstData('/rankings/mods'), { packs: ['packs/core.ptcb'], json: ['modrankings.json'] });
  assert.equal(firstData('/nowhere/123'), null);
});

test('the edge puts the page’s slice of the manifests and preloads in its <head>, and nothing elsewhere', () => {
  const packs = { generatedAt: 5, files: { 'packs/core.ptcb': 'AbCdEfGh_-', 'packs/player/1.ptcb': 'x</script>' } };
  const page = '<html><head><title>x</title></head><body></body></html>';
  const out = inlineData(page, '/rankings/loved', { packs, meta: null }, 'https://data.example/');
  assert.match(out, /<link rel="preload" href="https:\/\/data\.example\/packs\/core\.AbCdEfGh_-\.ptcb" as="fetch" crossorigin>\n<script type="application\/json" id="ptc-data">\{"packs":\{"generatedAt":5,"files":\{"packs\/core\.ptcb":"AbCdEfGh_-"\}\}\}<\/script>\n<\/head>/);
  assert.equal(inlineData(page, '/nowhere/1', { packs, meta: null }, 'https://data.example/'), page);
  assert.equal(inlineData(page, '/rankings', { packs: null, meta: null }, 'https://data.example/'), page);
  // Nothing in the data can close the script tag.
  const odd = inlineData(page, '/rankings', { packs: { generatedAt: 1, files: { 'packs/core.ptcb': '</script>' } }, meta: null }, '');
  assert.ok(!odd.slice(odd.indexOf('id="ptc-data"')).replace('</script>\n</head>', '').includes('</script>'));
});

test('the three boards: every player in the board’s order, as players.json ranks them', { skip }, () => {
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  const core = readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const players = JSON.parse(fs.readFileSync(path.join(dir, 'players.json'), 'utf8'));
  const ctx = ctxFor('en', core.info.generatedAt[0]);
  for (const [slug, cat] of [['converts', 'c'], ['loved', 'u']]) {
    const page = String(render(ctx, core, readState(slug, {})));
    const expected = players.filter(p => p.rank[cat]).sort((a, b) => a.rank[cat] - b.rank[cat]).map(p => p.name.toLowerCase());
    assert.deepEqual(rowsOf(page).map(r => r.name), expected, slug);
    assert.match(page, new RegExp(`<p class="result-count" id="count">${expected.length} players</p>`));
  }
  const ranked = String(render(ctx, core, readState('ranked', {})));
  const official = players.filter(p => p.rank.r || (p.inactive && p.pp > 0)).sort((a, b) => b.pp - a.pp || (a.rank.r ?? Infinity) - (b.rank.r ?? Infinity));
  assert.deepEqual(rowsOf(ranked).map(r => r.name), official.map(p => p.name.toLowerCase()));
});

test('the filter and the inactive players: rows hidden in the first paint, the count, and the empty state', { skip }, () => {
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  const core = readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const ctx = ctxFor('en', core.info.generatedAt[0]);
  const all = rowsOf(String(render(ctx, core, readState('converts', {}))));
  const name = all[0].name;
  const filtered = rowsOf(String(render(ctx, core, readState('converts', { q: name.toUpperCase() }))));
  const shown = filtered.filter(r => !r.cls.split(' ').includes('hidden'));
  assert.ok(shown.length >= 1 && shown.every(r => r.name.includes(name)));
  const none = String(render(ctx, core, readState('converts', { q: 'zz no such player zz' })));
  assert.match(none, /class="table-wrap hidden"/);
  assert.match(none, /No player on this leaderboard matches “zz no such player zz”\./);
  const active = rowsOf(String(render(ctx, core, readState('converts', { legends: '0' }))));
  assert.ok(active.every(r => !r.cls.includes('inactive') || r.cls.includes('hidden')));
});

test('Portuguese: the same board in the visitor’s language', { skip }, () => {
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  const core = readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const page = String(render(ctxFor('pt', core.info.generatedAt[0]), core, readState('converts', {})));
  assert.ok(page.includes(`<h1>${PT.Leaderboards}</h1>`));
  assert.ok(!page.includes('<h1>Leaderboards</h1>'));
});

test('Mods, Top plays and Star kings: the boards the JSON gives, in its order', { skip }, async () => {
  const boards = await import('../src/views/boards.ts');
  const kings = await import('../src/views/kings.ts');
  const { topPlaysView, parseModFilter } = await import('../../assets/js/core/model.js');
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  const core = readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const ctx = ctxFor('en', core.info.generatedAt[0]);
  const ids = page => [...String(page).matchAll(/href="\/player\/(\d+)"/g)].map(m => Number(m[1]));

  const mods = json('modrankings.json');
  for (const [src, mod] of [['r', 'HD'], ['c', 'DT'], ['u', mods.filters.at(-1)]]) {
    const data = { slug: 'mods', core, mods };
    const page = boards.render(ctx, data, boards.readState(data, { src, mod }));
    assert.deepEqual(ids(page), (mods.sources[src][mod] ?? []).map(r => r[0]), `mods ${src} ${mod}`);
  }
  const plays = fs.existsSync(path.join(dir, 'topplays.json')) ? json('topplays.json') : null;
  if (plays) {
    for (const [src, mod] of [['r', 'Any'], ['c', 'HR'], ['u', 'NM']]) {
      const data = { slug: 'plays', core, plays };
      const page = boards.render(ctx, data, boards.readState(data, { src, mod }));
      const rows = topPlaysView(plays.plays, src, mod === 'Any' ? null : parseModFilter(mod), plays.cap);
      assert.deepEqual(ids(page), rows.map(r => r[0]), `plays ${src} ${mod}`);
    }
  }
  const records = json('records.json');
  const all = String(kings.render(ctx, { core, kings: records.kings }, kings.readState(records.kings, {})));
  assert.equal((all.match(/class="king-title"/g) ?? []).length, records.kings.catch.length + records.kings.converts.length);
  const range = records.kings.catch.find(r => r.board?.length);
  if (range) {
    const one = kings.render(ctx, { core, kings: records.kings }, kings.readState(records.kings, { stars: String(range.stars) }));
    assert.deepEqual(ids(one), range.board.map(([id]) => id));
  }
});

test('a file the data doesn’t have is in the slice as null, with no preload, so the client needn’t ask meta.json', async () => {
  const { Store } = await import('../src/kernel/store.ts');
  const page = '<html><head></head><body></body></html>';
  const out = inlineData(page, '/player/1', { packs: { generatedAt: 1, files: { 'packs/core.ptcb': 'CCCCCCCCCC' } }, meta: { generatedAt: 1, files: { 'players/1-head.json': 'HHHHHHHHHH', 'bounties.json': 'BBBBBBBBBB' } } }, 'd/');
  const slice = JSON.parse(out.match(/id="ptc-data">([^<]*)</)[1]);
  assert.equal(slice.meta.files['economy.json'], null);
  assert.ok(!/<link[^>]*economy/.test(out), 'no preload for it');
  let asked = 0;
  const store = new Store('d/', slice, async () => { asked++; return { generatedAt: 1, files: {} }; });
  assert.equal(await store.hasJson('economy.json'), false);
  assert.equal(await store.hasJson('bounties.json'), true);
  assert.equal(asked, 0, 'no manifest fetched');
});
