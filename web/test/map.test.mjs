// node --test web/test/map.test.mjs
// A map's page, drawn in Node from an export (its core pack and JSON; skipped without, as web/test/rankings.test.mjs
// is): the leaderboards against the maps' buckets for maps of every kind, the set's difficulties, a map nobody here has
// played, and the pieces ported from the old modules (the map's tags and its story) against those modules themselves.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { S, M } from '../src/kernel/model.ts';
import { mapTags } from '../src/ui/badges.ts';
import { mapLore } from '../src/ui/lore.ts';
import { render, title } from '../src/views/map.ts';
import { firstData, mapBucket } from '../src/routes.ts';
import { PT } from '../../assets/js/core/pt.js';
import * as oldBadges from '../../assets/js/core/badges.js';
import * as oldLore from '../../assets/js/core/lore.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && `no packs in ${dir}`;

/** The biggest board in the test data, and maps of the other kinds: loved, loved and banned, a convert, a story. */
const BIG = 1207082;
const LOVED = 884085;
const BANNED = 944502;
const CONVERT = 17908;
const STORY = 553131;
/** Plays only from before the map was ranked; and both kinds. */
const PRE_ONLY = 5383045;
const PRE_AND_NOW = 3007106;
/** A set with 105 difficulties. */
const BIG_SET = 2377334;
const UNKNOWN = 999999999;

const files = new Map();
const json = name => {
  if (!files.has(name)) files.set(name, JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
  return files.get(name);
};
const bucketOf = id => json(mapBucket(id));
let core = null;
const coreOf = () => {
  if (core) return core;
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  return (core = readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
};
const ctxFor = (lang, { me = null } = {}) => {
  const now = coreOf().info.generatedAt[0];
  const text = makeText(lang, lang === 'pt' ? PT : {});
  return { ...text, fmt: makeFmt(text, { now: () => now }), now: () => now, data: 'https://data.example/', me };
};

/** A map's page data from the files, as entries/map.ts loads it. */
function dataFor(id) {
  const entry = bucketOf(id)[id] ?? null;
  const bounties = json('bounties.json');
  const site = json('meta.json');
  const meta = entry?.m ?? bounties.maps[id] ?? site.hill?.maps[id] ?? json('dan.json').stages.find(s => s.map === id)?.meta
    ?? json('challenges.json').maps[id] ?? null;
  const setFile = meta?.[M.SET] ? `sets/${meta[M.SET] % 128}.json` : null;
  const set = setFile && fs.existsSync(path.join(dir, setFile)) ? json(setFile)[meta[M.SET]] ?? null : null;
  return { id, core: coreOf(), entry, meta, diffs: set?.some(d => d[0] === id) ? set : null, bounties, site };
}
const draw = (id, { lang = 'en', me = null } = {}) => String(render(ctxFor(lang, { me }), dataFor(id)));

/** One of the board's views ('now' or 'pre'): its rows as { me, pos, player, pp }. */
function boardOf(page, view) {
  const at = page.indexOf(`<div data-view="${view}"`);
  if (at < 0) return null;
  const part = page.slice(at, page.indexOf('</tbody>', at) + 1 || undefined);
  return [...part.matchAll(/<tr class="(me)?">\s*<td class="rank">([\s\S]*?)<\/td>\s*<td class="cell-player"><a class="player" href="\/player\/(\d+)">[\s\S]*?<td class="num">([\s\S]*?)<\/td>/g)]
    .map(m => ({ me: Boolean(m[1]), pos: Number(m[2].match(/(\d+)\s*$/)?.[1] ?? m[2].match(/#(\d+)/)?.[1]), player: Number(m[3]), pp: m[4] }));
}
const count = (page, pattern) => [...page.matchAll(pattern)].length;

test('a map is drawn by the new client, with the core pack and the map’s bucket first', () => {
  assert.deepEqual(firstData(`/map/${BIG}`), { packs: ['packs/core.ptcb'], json: [`maps/${BIG % 128}.json`] });
  assert.deepEqual(firstData('/map/17908/'), { packs: ['packs/core.ptcb'], json: ['maps/116.json'] });
  assert.equal(firstData('/map/abc'), null);
  assert.equal(firstData('/map/1/2'), null);
  assert.equal(firstData('/maps'), null);
});

test('the biggest board: every play in the bucket’s order, numbered, with its pp, and the visitor’s row marked', { skip }, () => {
  const entry = bucketOf(BIG)[BIG];
  const me = entry.s[2][0];
  const page = draw(BIG, { me });
  const rows = boardOf(page, 'now');
  assert.equal(rows.length, entry.s.length);
  assert.ok(rows.length >= 40);
  assert.deepEqual(rows.map(r => r.player), entry.s.map(e => e[0]));
  assert.deepEqual(rows.map(r => r.pos), entry.s.map((_, i) => i + 1));
  const { fmt } = ctxFor('en');
  assert.deepEqual(rows.map(r => r.pp), entry.s.map(e => `<span class="pp">${fmt.pp(e[S.PP + 1])}<small>pp</small></span>`));
  assert.deepEqual(rows.map(r => r.me), entry.s.map((_, i) => i === 2));
  // Ranked: by score, as on osu!; no second view without plays from before ranking.
  assert.match(page, /<span class="cat cat-r">Ranked<\/span>/);
  assert.match(page, /Sorted by classic score, as on osu!\./);
  assert.equal(boardOf(page, 'pre'), null);
  assert.ok(!page.includes('board-views'));
  assert.equal(title(ctxFor('en'), dataFor(BIG)), `${entry.m[M.ARTIST]} - ${entry.m[M.TITLE]}`);
  // The details strip and the links under it.
  assert.match(page, new RegExp(`<dd>${fmt.num(entry.m[M.BPM])}</dd>`));
  assert.match(page, new RegExp(`<dd>${Math.floor(entry.m[M.LENGTH] / 60)}:${String(entry.m[M.LENGTH] % 60).padStart(2, '0')}</dd>`));
  assert.match(page, new RegExp(`href="osu://b/${BIG}"`));
  assert.match(page, new RegExp(`href="/calculator\\?map=${BIG}"`));
  assert.ok(!draw(BIG).includes('<tr class="me">'));
});

test('every map of a few buckets: its board’s players, positions and count, and the right empty state', { skip }, () => {
  const ctx = ctxFor('en');
  let maps = 0;
  for (const b of [0, 42, 77, 116]) {
    for (const [key, entry] of Object.entries(json(`maps/${b}.json`))) {
      const id = Number(key);
      const page = String(render(ctx, dataFor(id)));
      const now = boardOf(page, 'now'), pre = boardOf(page, 'pre');
      assert.deepEqual(now.map(r => r.player), entry.s.map(e => e[0]), String(id));
      assert.deepEqual(now.map(r => r.pos), entry.s.map((_, i) => i + 1), String(id));
      assert.equal(page.includes('No Portuguese player has a score on'), !entry.s.length, String(id));
      if (entry.pre?.length) assert.deepEqual(pre.map(r => r.player), entry.pre.map(e => e[0]), String(id));
      else assert.equal(pre, null, String(id));
      maps++;
    }
  }
  assert.ok(maps > 2000);
});

test('loved maps sort by pp, as in the bot, unless banned: then by score, and no pp', { skip }, () => {
  const loved = draw(LOVED);
  assert.equal(bucketOf(LOVED)[LOVED].c, 'u');
  assert.match(loved, /<span class="cat cat-u">Loved<\/span>/);
  assert.match(loved, /Sorted by pp, as in the bot\./);
  assert.ok(!loved.includes('Banned — no pp'));
  assert.deepEqual(boardOf(loved, 'now').map(r => r.player), bucketOf(LOVED)[LOVED].s.map(e => e[0]));
  assert.match(loved, /<dd>Loved<span class="status-date"> <time datetime="[^"]+">[^<]+<\/time><\/span><\/dd>/);

  const banned = draw(BANNED);
  assert.ok(bucketOf(BANNED)[BANNED].banned);
  assert.match(banned, /<span class="badge badge-red" title="Scores on this map are kept but give no pp">Banned — no pp<\/span>/);
  assert.match(banned, /Sorted by classic score, as on osu!\./);
});

test('a convert, and a map with a story: the card, with the board’s size and its full combos', { skip }, () => {
  const convert = draw(CONVERT);
  assert.match(convert, /<span class="cat cat-c">Converts<\/span>/);
  assert.equal(boardOf(convert, 'now').length, bucketOf(CONVERT)[CONVERT].s.length);

  const entry = bucketOf(STORY)[STORY];
  const page = draw(STORY);
  const fcs = entry.s.filter(e => e[S.MISS + 1] === 0).length;
  assert.match(page, /<span class="eyebrow">The eternal grind<\/span>/);
  assert.ok(page.includes(`${entry.s.length} Portuguese players on this diff alone.`));
  assert.ok(page.includes(`FC watch: ${fcs} of ${entry.s.length} Portuguese players ${fcs === 1 ? 'has' : 'have'} a full combo on this diff.`));
});

test('a set with many difficulties: each one linked in the set’s order, this one marked, the unplayed ones dimmed', { skip }, () => {
  const set = json(`sets/${BIG_SET % 128}.json`)[BIG_SET];
  assert.ok(set.length >= 100);
  const id = (set.find(d => d[3] > 0) ?? set[0])[0];
  const page = draw(id);
  const links = [...page.matchAll(/<a class="diff ([\w-]*)" href="\/map\/(\d+)"[^>]*aria-current="(\w+)"/g)];
  assert.deepEqual(links.map(m => Number(m[2])), set.map(d => d[0]));
  assert.deepEqual(links.map(m => m[3] === 'page'), set.map(d => d[0] === id));
  assert.deepEqual(links.map(m => m[1] === 'diff-new'), set.map(d => !d[3]));
  // A map whose set has one difficulty, or none in the data, has no switcher.
  assert.equal(count(draw(5248), /<nav class="diffs"/g), json(`sets/${770 % 128}.json`)[770] ? 1 : 0);
});

test('plays from before ranking: a second view, with plain positions and no pp', { skip }, () => {
  const only = draw(PRE_ONLY);
  const entry = bucketOf(PRE_ONLY)[PRE_ONLY];
  assert.equal(entry.s.length, 0);
  assert.match(only, /No Portuguese player has a score on the ranked version of this map yet\. Why not be the first\?/);
  assert.match(only, /<button class="chip active" type="button" data-board="now" aria-pressed="true">Ranked <span class="faint">0<\/span><\/button>/);
  assert.match(only, new RegExp(`data-board="pre" aria-pressed="false">Before ranking <span class="faint">${entry.pre.length}</span>`));
  const pre = boardOf(only, 'pre');
  assert.deepEqual(pre.map(r => r.player), entry.pre.map(e => e[0]));
  assert.deepEqual(pre.map(r => r.pos), entry.pre.map((_, i) => i + 1));
  assert.ok(pre.every(r => r.pp.includes('<span class="faint" title="Set before the map was ranked: counts toward nothing">—</span>')));
  assert.ok(!only.slice(only.indexOf('<div data-view="pre"')).includes('class="pos'));
  assert.match(only, /<div data-view="pre" hidden>/);

  const both = draw(PRE_AND_NOW);
  const counted = bucketOf(PRE_AND_NOW)[PRE_AND_NOW];
  assert.deepEqual(boardOf(both, 'now').map(r => r.player), counted.s.map(e => e[0]));
  assert.deepEqual(boardOf(both, 'pre').map(r => r.player), counted.pre.map(e => e[0]));
});

test('a map the data doesn’t have: its id, a link to osu!, and an empty board', { skip }, () => {
  const data = dataFor(UNKNOWN);
  assert.equal(data.entry, null);
  assert.equal(data.meta, null);
  const page = draw(UNKNOWN);
  assert.equal(title(ctxFor('en'), data), `Map #${UNKNOWN}`);
  assert.match(page, new RegExp(`<h1><a class="title-link" href="https://osu.ppy.sh/beatmaps/${UNKNOWN}\\?mode=fruits"[^>]*>Map #${UNKNOWN}</a></h1>`));
  assert.match(page, /<div class="sub">No map details<\/div>/);
  assert.match(page, /<div class="links">\s*<\/div>/);
  assert.ok(!page.includes('kv-strip') && !page.includes('/calculator') && !page.includes('<table>'));
  assert.match(page, /No Portuguese player has a score on this map yet\. Why not be the first\?/);
  assert.match(page, new RegExp(`href="osu://b/${UNKNOWN}"`));
});

test('Portuguese: the same page in the visitor’s language', { skip }, () => {
  const page = draw(BIG, { lang: 'pt' });
  for (const english of ['Portuguese leaderboard', 'Sorted by classic score', 'Open in osu!', 'Max combo', 'Difficulties']) {
    assert.ok(!page.includes(english), english);
  }
  assert.ok(page.includes(PT['Portuguese leaderboard']));
  assert.equal(boardOf(page, 'now').length, bucketOf(BIG)[BIG].s.length);
});

test('the map’s tags and its story are the old modules’ (badges.js mapTags, lore.js mapLore)', { skip }, () => {
  const ctx = ctxFor('en');
  let tagged = 0, stories = 0;
  for (let b = 0; b < 128; b++) {
    for (const entry of Object.values(json(`maps/${b}.json`))) {
      const tags = mapTags(ctx, entry.m, entry.s, entry.c);
      assert.deepEqual(tags, oldBadges.mapTags(entry.m, entry.s, entry.c));
      tagged += tags.length > 0;
      const lore = mapLore(ctx, entry.m), old = oldLore.mapLore(entry.m);
      assert.equal(lore?.title ?? null, old?.title ?? null);
      if (!lore) continue;
      stories++;
      assert.equal(Boolean(lore.tuga), Boolean(old.tuga));
      const top = entry.s.reduce((max, e) => Math.max(max, e[S.PP + 1]), 0);
      assert.equal(lore.text(entry.s.length, top), old.text(entry.s.length, top));
      assert.equal(lore.text(3, 120), old.text(3, 120));
    }
  }
  assert.ok(tagged > 1000 && stories > 20, `${tagged} tagged, ${stories} stories`);
});
