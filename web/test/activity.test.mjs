// node --test web/test/activity.test.mjs
// The Activity page drawn in Node from an export (skipped without one): the feed, its filters, recent plays and the
// weekly recap, against activity.json and challenges.json.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { render, readState, shownEvents, FEED_STEP } from '../src/views/activity.ts';
import { PT } from '../../assets/js/core/pt.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

test('Activity: the feed a page at a time, each filter, recent plays and the week', { skip }, () => {
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  const data = { core: readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), activity: json('activity.json'), challenges: json('challenges.json') };
  for (const lang of ['en', 'pt']) {
    const text = makeText(lang, lang === 'pt' ? PT : {});
    const now = data.core.info.generatedAt[0];
    const ctx = { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me: null };
    const events = page => (String(page).match(/class="event ev-/g) ?? []).length;
    const all = render(ctx, data, readState(ctx, data, {}));
    assert.equal(events(all), Math.min(FEED_STEP, data.activity.events.length));
    for (const kind of ['plays', 'challenges', 'boards', 'tips', 'snipe']) {
      const state = readState(ctx, data, { kind });
      assert.equal(events(render(ctx, data, state)), Math.min(FEED_STEP, shownEvents(ctx, data, state.kind).length), kind);
    }
    const plays = String(render(ctx, data, readState(ctx, data, { view: 'plays' })));
    assert.equal((plays.match(/<div class="row">/g) ?? []).length, data.activity.recent.length);
    if (data.challenges.weekly) assert.match(String(render(ctx, data, readState(ctx, data, { view: 'week' }))), /<h2>/);
  }
});
