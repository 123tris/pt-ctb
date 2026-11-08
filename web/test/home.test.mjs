// node --test web/test/home.test.mjs
// The home page, drawn in Node from an export's core pack and home.json (skipped without one, as packs.test.mjs finds
// it), against the files the old home page reads.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { render } from '../src/views/home.ts';
import { firstData } from '../src/routes.ts';
import { PT } from '../../assets/js/core/pt.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'home.json')) && `no home.json in ${dir}`;
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

test('the front page’s first data: the core pack and home.json', () => {
  assert.deepEqual(firstData('/'), { packs: ['packs/core.ptcb', 'packs/home.json'], json: [] });
});

test('the home page: its figures, boards and feed from the core pack and home.json', { skip }, () => {
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  const core = readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const home = json('packs/home.json');
  for (const lang of ['en', 'pt']) {
    const text = makeText(lang, lang === 'pt' ? PT : {});
    const now = core.info.generatedAt[0];
    const ctx = { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me: null };
    const page = String(render(ctx, { core, home, invite: 'https://discord.gg/x', signIn: false }));
    assert.equal((page.match(/class="event ev-/g) ?? []).length, Math.min(5, json('activity.json').events.length));
    assert.equal((page.match(/class="line /g) ?? []).length, 15, 'three boards of five');
    assert.ok(page.includes(ctx.fmt.num(json('meta.json').totals.scores)), 'the scores figure');
    assert.equal((page.match(/<li class="rung/g) ?? []).length, 19, 'every Dan stage on the ladder');
    if (home.week) assert.ok(page.includes(`href="/map/${home.week.map}"`), 'the map of the week');
  }
});
