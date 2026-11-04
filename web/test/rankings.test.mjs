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
import { inlinePacks } from '../edge/inline.ts';
import { firstPacks } from '../src/routes.ts';
import { PT } from '../../assets/js/core/pt.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;

const ctxFor = (lang, now) => {
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me: null };
};
const rowsOf = page => [...page.matchAll(/<tr( class="([^"]*)")? data-name="([^"]*)"/g)].map(m => ({ cls: m[2] ?? '', name: m[3] }));

test('which pages the new client draws, and their first packs', () => {
  assert.deepEqual(firstPacks('/rankings'), ['packs/core.ptcb']);
  assert.deepEqual(firstPacks('/rankings/ranked'), ['packs/core.ptcb']);
  assert.equal(firstPacks('/rankings/mods'), null);
  assert.equal(firstPacks('/player/123'), null);
});

test('the edge puts the page’s slice of packs.json and a preload in its <head>, and nothing elsewhere', () => {
  const manifest = { generatedAt: 5, files: { 'packs/core.ptcb': 'AbCdEfGh_-', 'packs/player/1.ptcb': 'x</script>' } };
  const page = '<html><head><title>x</title></head><body></body></html>';
  const out = inlinePacks(page, '/rankings/loved', manifest, 'https://data.example/');
  assert.match(out, /<link rel="preload" href="https:\/\/data\.example\/packs\/core\.AbCdEfGh_-\.ptcb" as="fetch" crossorigin>\n<script type="application\/json" id="ptc-packs">\{"generatedAt":5,"files":\{"packs\/core\.ptcb":"AbCdEfGh_-"\}\}<\/script>\n<\/head>/);
  assert.equal(inlinePacks(page, '/player/1', manifest, 'https://data.example/'), page);
  assert.equal(inlinePacks(page, '/rankings', null, 'https://data.example/'), page);
  // Nothing in the data can close the script tag.
  const odd = inlinePacks(page, '/rankings', { generatedAt: 1, files: { 'packs/core.ptcb': '</script>' } }, '');
  assert.ok(!odd.slice(odd.indexOf('id="ptc-packs"')).replace('</script>\n</head>', '').includes('</script>'));
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
