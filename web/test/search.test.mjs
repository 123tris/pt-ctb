// node --test web/test/search.test.mjs
// The top bar's search (web/src/ui/header-search.ts) against the old one's (assets/js/core/search.js): the same pages,
// players and maps, in the same order and groups, with the same line for screen readers, for many texts. The old
// module needs a browser to load, so its ranking and page list are read from its source and run here as they are, over
// players.json; how it put the groups together is copied from its draw(). The new one reads the core pack. Both take
// the maps from search-maps.json. From an export with packs (PTCATCH_DATA=<folder>; skipped without).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCore } from '../src/gen/packs.ts';
import { makeText } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import { LIMIT, findAll, groups, resultsList, searchMaps, statusText } from '../src/ui/header-search.ts';
import { tierOf, rankMaps, beatmapIdOf, decodeSearchMaps } from '../../assets/js/core/maps-search.js';
import { PT } from '../../assets/js/core/pt.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.resolve(process.env.PTCATCH_DATA ?? path.join(repo, 'data'));
const skip = !(fs.existsSync(path.join(dir, 'packs', 'core.ptcb')) && fs.existsSync(path.join(dir, 'search-maps.json'))) && `no packs or search-maps.json in ${dir}`;
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const source = fs.readFileSync(path.join(repo, 'assets', 'js', 'core', 'search.js'), 'utf8');

const ctxFor = lang => {
  const text = makeText(lang, lang === 'pt' ? PT : {});
  const now = () => 1.8e9;
  return { ...text, fmt: makeFmt(text, { now }), now, data: 'https://data.example/', me: null };
};

/** The declaration in `code` that starts with `start`, to the end of its outermost brackets. */
function declaration(code, start) {
  const at = code.indexOf(start);
  assert.ok(at >= 0, `search.js has no ${start}`);
  let depth = 0;
  for (let i = code.slice(at).search(/[{[]/) + at; i < code.length; i++) {
    if ('{['.includes(code[i])) depth++;
    else if ('}]'.includes(code[i]) && --depth === 0) return code.slice(at, code[i + 1] === ';' ? i + 2 : i + 1);
  }
  throw new Error(`unbalanced ${start}`);
}

/** search.js's own rank(), PAGES, pageMatches() and detail(), in one language. */
const oldSearch = ctx => new Function('tierOf', 't', 'fmt', `${['function rank(list, text)', 'const PAGES = [', 'function pageMatches(text)', 'function detail(p)']
  .map(start => declaration(source, start)).join('\n')}
return { rank, pageMatches, detail, LIMIT: ${source.match(/const LIMIT = (\d+);/)[1]} };`)(tierOf, ctx.t, ctx.fmt);

/** What search.js's draw() put in the list, and the live region's line, for one text (copied from it). */
function oldResults(ctx, old, list, maps, text, looked) {
  const { t, tn, fmt } = ctx;
  const pages = old.pageMatches(text);
  const ranked = old.rank(list, text);
  let foundMaps = maps?.rows ? rankMaps(maps.rows, maps.hay, text) : [];
  const id = beatmapIdOf(text);
  if (id !== null && foundMaps[0] && !foundMaps[0].row[3]) {
    if (looked.get(id)) foundMaps = [{ tier: 0, row: looked.get(id) }];
  }
  const playersFirst = !foundMaps.length || (ranked.length > 0 && ranked[0].tier <= foundMaps[0].tier);
  const people = ranked.slice(0, Math.max(2, old.LIMIT - foundMaps.length - pages.length)).map(r => r.p);
  const mapItems = foundMaps.map(m => ({ map: m.row }));
  const groups = playersFirst
    ? [['', pages.map(page => ({ page }))], [t('Players'), people], [t('Maps'), mapItems]]
    : [['', pages.map(page => ({ page }))], [t('Maps'), mapItems], [t('Players'), people]];
  const results = groups.flatMap(([, items]) => items);
  const loadingMaps = maps && !maps.rows;
  const and = ` ${t('and')} `;
  const status = results.length
    ? t('{what} found', { what: [pages.length && tn(pages.length, '{names} page', '{names} pages', { names: pages.map(p => p.name).join(and) }),
      people.length && fmt.plural(people.length, 'player'), mapItems.length && fmt.plural(mapItems.length, 'map')].filter(Boolean).join(and) })
    : loadingMaps ? t('No players found. Looking through the maps…') : t('No players or maps found. This search has the maps two or more players here have played; Search all maps has the rest.');
  return {
    groups: groups.map(([label, items]) => [label, items.map(r => (r.page ? `page ${r.page.href}` : r.map ? `map ${r.map[0]}` : `player ${r.id}`))]),
    status,
    details: people.map(p => old.detail(p)),
  };
}

/** Texts to look for: bits of names, titles, artists and mappers, ids and links, page words, and some that find nothing. */
function texts(list, rows) {
  const out = new Set(['a', 'e', 'pt', 'dan', 'Dan', 'hill', 'week', 'pp', 'cal', 'join', 'desafio', 'recompensa', 'zz', 'xyzzy',
    'the', 'love', 'camellia', 'freedom dive', '  ', 'x', 'Records', '727', '1', '123', '2311555', '999999999',
    'https://osu.ppy.sh/beatmaps/2311555', 'https://osu.ppy.sh/beatmapsets/1#fruits/2311555', 'osu.ppy.sh/b/75', '#fruits/1',
    '[', '(', '-', 'sotarks', 'hard', 'insane', 'rain']);
  for (const p of list) {
    const name = p.name;
    out.add(name).add(name.slice(0, 1)).add(name.slice(0, 2)).add(name.slice(0, 3)).add(name.slice(1, 4)).add(name.toUpperCase());
  }
  for (let i = 0; i < rows.length; i += 997) {
    const [id, , artist, title, version, , , , , mapper] = rows[i];
    out.add(String(id)).add(title.split(' ')[0]).add(title.slice(0, 5)).add(artist).add(version).add(`${title} ${version}`.toLowerCase());
    if (mapper) out.add(mapper).add(mapper.slice(0, 3));
  }
  return [...out];
}

test('the same pages, players and maps in the same order, and the same line for screen readers', { skip }, () => {
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  const players = readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).players;
  const list = json('players.json');
  const rows = decodeSearchMaps(json('search-maps.json'));
  const maps = searchMaps(rows);
  const oldMaps = { rows, hay: rows.map(r => `${r[3]} ${r[2]} ${r[4]} ${r[9] ?? ''}`.toLowerCase()) };
  assert.deepEqual(maps.hay, oldMaps.hay);
  // A map found in its own file, for an id outside the index.
  const lookedRow = [999999999, 1, 'Artist', 'Title', 'Hard', 4.5, 'r', 1, null, 'Mapper'];
  const looked = new Map([[999999999, lookedRow]]);
  let compared = 0;
  for (const lang of ['en', 'pt']) {
    const ctx = ctxFor(lang);
    const old = oldSearch(ctx);
    assert.equal(old.LIMIT, LIMIT);
    for (const raw of texts(list, rows)) {
      const text = raw.trim();
      if (!text) continue;
      for (const loaded of [true, false]) {
        const found = findAll(ctx, players, loaded ? maps : null, text, id => looked.get(id) ?? (id === 123 ? undefined : null));
        const shown = groups(ctx, found).map(([label, items]) => [label, items.map(r => ('page' in r ? `page ${r.page.href}` : 'map' in r ? `map ${r.map[0]}` : `player ${players.id[r.player]}`))]);
        const want = oldResults(ctx, old, list, loaded ? oldMaps : { pending: true }, text, looked);
        assert.deepEqual(shown, want.groups, `${lang} "${text}"${loaded ? '' : ' (maps loading)'}`);
        assert.equal(statusText(ctx, found, !loaded), want.status, `${lang} "${text}" status`);
        // Each player's second line, from the pack as from players.json.
        const details = found.people.map(row => resultsList(ctx, players, [['', [{ player: row }]]], text).text.match(/<span class="search-detail">([^<]*)<\/span>/)[1]);
        assert.deepEqual(details, want.details.map(d => d.replace(/&/g, '&amp;')), `${lang} "${text}" details`);
        compared++;
      }
    }
  }
  assert.ok(compared > 500, `${compared} texts compared`);
});

test('an id the maps don’t have is looked up once: the first draw asks for it, later ones show what came back', { skip }, () => {
  const ctx = ctxFor('en');
  const rows = decodeSearchMaps(json('search-maps.json'));
  const maps = searchMaps(rows);
  const asked = findAll(ctx, null, maps, '999999999', () => undefined);
  assert.equal(asked.lookUp, 999999999);
  assert.deepEqual(asked.maps.map(r => r[0]), [999999999]);
  const none = findAll(ctx, null, maps, '999999999', () => null);
  assert.equal(none.lookUp, null);
  const titled = rows.find(r => r[3]);
  const known = findAll(ctx, null, maps, String(titled[0]), () => undefined);
  assert.equal(known.lookUp, null);
  assert.deepEqual(known.maps.map(r => r[0]), [titled[0]]);
});

test('the list’s markup: groups labelled, options numbered across them, the match marked (the mapper’s too)', { skip }, () => {
  const ctx = ctxFor('en');
  const bytes = fs.readFileSync(path.join(dir, 'packs', 'core.ptcb'));
  const players = readCore(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).players;
  const row = [5, 7, 'Artist', 'Title', 'Hard', 4.5, 'r', 3, null, 'Mapper'];
  const found = { pages: [], people: [0], maps: [row], playersFirst: true, lookUp: null };
  const out = resultsList(ctx, players, groups(ctx, found), 'map').text;
  assert.match(out, /role="group" aria-labelledby="search-g-0"[\s\S]*id="search-opt-0"[\s\S]*role="group" aria-labelledby="search-g-1"[\s\S]*id="search-opt-1"/);
  // The old search put the mapper's highlight through t(), which escaped it: "mapped by <mark>…" showed as text.
  assert.ok(out.includes('mapped by <mark>Map</mark>per'), out);
});
