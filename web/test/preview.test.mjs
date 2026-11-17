// node --test web/test/preview.test.mjs
// Song previews (ui/maps.ts, client/preview.ts plays them): osu!'s clip by set, and the button on a map's page, drawn in
// Node without an export (the map is a tuple made here; nobody has played it).

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { M, STATUS } from '../src/kernel/model.ts';
import { previewButton, previewUrl } from '../src/ui/maps.ts';
import { render } from '../src/views/map.ts';
import { PT } from '../../assets/js/core/pt.js';

const NOW = 1_763_400_000;
const ctxFor = lang => {
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => NOW }), now: () => NOW, data: 'https://data.example/', me: null };
};

/** A ranked map's tuple (M): set 1, the first one osu! has. */
const meta = (set = 1) => {
  const m = [];
  Object.assign(m, {
    [M.ARTIST]: 'Kenji Ninuma', [M.TITLE]: 'DISCO★PRINCE', [M.VERSION]: 'Normal', [M.SET]: set, [M.STARS]: 2.41,
    [M.AR]: 6, [M.CS]: 4, [M.OD]: 6, [M.HP]: 6, [M.BPM]: 119.99, [M.LENGTH]: 142, [M.MAX_COMBO]: 314,
    [M.STATUS]: STATUS.RANKED, [M.MODE]: 0, [M.CREATOR]: 'peppy', [M.RANKED_AT]: null, [M.UPDATED_AT]: null,
  });
  return m;
};
const page = (lang, m) => String(render(ctxFor(lang), { id: 75, core: { players: {} }, entry: null, meta: m, diffs: null, bounties: null, site: {} }));

test('the clip is osu!’s own, by set (an .mp3 address that serves Ogg Vorbis)', () => {
  assert.equal(previewUrl(1), 'https://b.ppy.sh/preview/1.mp3');
});

test('a preview button names its set and starts at rest; no set, no button', () => {
  const en = String(previewButton(ctxFor('en'), 123));
  assert.match(en, /^<button class="btn btn-small preview-btn" type="button" data-preview="123" aria-pressed="false" title="Plays osu!’s 10-second preview of the song">Listen<\/button>$/);
  assert.match(String(previewButton(ctxFor('en'), 123, 'btn')), /^<button class="btn preview-btn" /);
  assert.match(String(previewButton(ctxFor('pt'), 123)), /title="Toca o excerto de 10 segundos da música, do osu!">Ouvir<\/button>$/);
  assert.equal(previewButton(ctxFor('en'), 0), '');
  assert.equal(previewButton(ctxFor('en'), null), '');
  assert.equal(previewButton(ctxFor('en'), undefined), '');
});

test('a map’s page offers its set’s preview next to the osu! button, and none without the map’s details', () => {
  const html = page('en', meta(1));
  assert.equal(html.match(/data-preview="/g)?.length, 1);
  assert.match(html, /<div class="mt-4 btn-row">\s*<button class="btn btn-small preview-btn" type="button" data-preview="1" /);
  assert.ok(html.indexOf('data-preview="1"') < html.indexOf('osu://b/75'), 'Listen comes before Open in osu!');
  assert.doesNotMatch(page('en', null), /data-preview/);
  assert.doesNotMatch(page('en', meta(0)), /data-preview/);
});
