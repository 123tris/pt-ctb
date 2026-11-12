// node --test web/test/router.test.mjs
// The app's page table and the pure rules around it (web/src/pages.ts) against the old app's own: assets/js/app.js
// needs a browser to load, so its LOADERS, SUB_VIEWS, pageOf(), pageKey() and pageObject() are read from its source and
// run here as they are, over the same addresses.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_MODULES, SUB_VIEWS, match, moved, pageOf, pageKey, pageObject } from '../src/pages.ts';
import { matchPage, unmoved, PAGES } from '../../assets/js/core/routes.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(repo, 'assets', 'js', 'app.js'), 'utf8');

/** The declaration in `code` that starts with `start`, to the end of its outermost braces (and a closing semicolon). */
function declaration(code, start) {
  const at = code.indexOf(start);
  assert.ok(at >= 0, `app.js has no ${start}`);
  let depth = 0;
  for (let i = code.indexOf('{', at); i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return code.slice(at, code[i + 1] === ';' ? i + 2 : i + 1);
  }
  throw new Error(`unbalanced ${start}`);
}

// The old app's own code. Its LOADERS hold import()s that are never called here.
const old = new Function('matchPage', 'unmoved', `${[
  'const LOADERS = {', 'function match(path)', 'const SUB_VIEWS = {', 'function pageOf(pathname)', 'function pageKey(found, path, query)',
  'function pageObject(found)',
].map(start => declaration(source, start)).join('\n')}
const ID_PARAMS = ${source.match(/const ID_PARAMS = (new Set\([^)]*\));/)[1]};
return { LOADERS, match, SUB_VIEWS, pageOf, pageKey, pageObject };`)(matchPage, unmoved);

test('the page table: every address the old app loads, with the same new entry and old page', () => {
  // Pages of the new client's only (Top 10) have no old page and no loader in the old app.
  const withOld = Object.keys(PAGE_MODULES).filter(pattern => PAGE_MODULES[pattern].old);
  assert.deepEqual(withOld, Object.keys(old.LOADERS));
  assert.deepEqual(Object.keys(PAGE_MODULES), PAGES);
  for (const [pattern, { entry, old: page }] of Object.entries(PAGE_MODULES)) {
    if (page) continue;
    assert.ok(fs.existsSync(path.join(repo, 'web', 'src', 'entries', `${entry}.ts`)), `${pattern}: web/src/entries/${entry}.ts`);
  }
  for (const [pattern, load] of Object.entries(old.LOADERS)) {
    const [, entry] = String(load).match(/import\('\.\.\/web\/([\w-]+)\.js'\)/);
    const [, page] = String(load).match(/import\('\.\/pages\/([\w-]+)\.js'\)/);
    assert.deepEqual(PAGE_MODULES[pattern], { entry, old: page }, pattern);
    assert.ok(fs.existsSync(path.join(repo, 'web', 'src', 'entries', `${entry}.ts`)), `web/src/entries/${entry}.ts`);
    assert.ok(fs.existsSync(path.join(repo, 'assets', 'js', 'pages', `${page}.js`)), `assets/js/pages/${page}.js`);
  }
  assert.deepEqual(SUB_VIEWS, old.SUB_VIEWS);
});

const ADDRESSES = [
  '', '/', 'rankings', 'rankings/loved', 'rankings/mods', 'rankings/', 'rankings/ranked/2024', 'rankings/converts/2024',
  'rankings/ranked/x', 'rankings/ranked/2024/x', 'players', 'player/3821475', 'player/3821475/loved',
  'player/3821475/converts', 'player/abc', 'player', 'player/1/2/3', 'maps', 'map/2311555', 'map', 'map/x', 'activity',
  'challenges', 'challenges/dan', 'challenges/hill', 'challenges/bounties', 'dan', 'dan/x', 'verify', 'duel/7', 'duel',
  'games', 'games/guess', 'games/daily', 'games/quiz', 'calculator', 'compare', 'compare/1', 'compare/1/2', 'compare/1/2/3',
  'compare/x/y', 'records', 'shop', 'admin', 'recap/3821475', 'recap/3821475/2024', 'recap', 'commands', 'join', 'team',
  'glossary', 'privacy', 'nope', 'Players', 'player/%E0%A4%A', 'map/%20', 'player/12345678901',
];
const QUERIES = [{}, { view: 'plays' }, { mode: 'daily' }, { view: 'x', mode: 'y' }, { tab: 'z', page: '2' }];

test('matching an address, a moved one, and what the usage counts call it', () => {
  for (const address of ADDRESSES) {
    const path = address.replace(/^\/+/, '');
    assert.equal(moved(path), unmoved(path), path);
    const found = match(moved(path));
    const oldFound = old.match(unmoved(path));
    assert.deepEqual(found, oldFound && { pattern: oldFound.pattern, params: oldFound.params }, path);
    assert.equal(pageOf(`/${path}`), old.pageOf(`/${path}`), path);
    if (!found) continue;
    for (const query of QUERIES) assert.equal(pageKey(found, moved(path), query), old.pageKey(oldFound, unmoved(path), query), `${path} ${JSON.stringify(query)}`);
    assert.equal(pageObject(found), old.pageObject(oldFound), path);
  }
  assert.equal(pageOf(null), old.pageOf(null));
});

test('a few keys spelled out: ids left out, a sub-view in the query kept, comparisons by how many', () => {
  const key = (path, query = {}) => pageKey(match(path), path, query);
  assert.equal(key(''), 'home');
  assert.equal(key('player/3821475/loved'), 'player/loved');
  assert.equal(key('recap/3821475/2024'), 'recap');
  assert.equal(key('activity', { view: 'plays' }), 'activity/plays');
  assert.equal(key('compare/1/2'), 'compare/pair');
  assert.equal(key('compare/1'), 'compare/one');
  assert.equal(key('rankings/ranked/2024'), 'rankings/ranked/year');
  assert.equal(key('rankings/ranked'), 'rankings/ranked');
  assert.equal(pageObject(match('compare/1/2')), 'p1|p2');
  assert.equal(pageObject(match('map/5')), 'm5');
  // Switching a profile's list is a new view, not a new page; another player is a new page.
  assert.equal(pageOf('/player/1/loved'), pageOf('/player/1'));
  assert.notEqual(pageOf('/player/1'), pageOf('/player/2'));
  // So is switching between the leaderboards, and between the Ranked board's years.
  assert.equal(pageOf('/rankings/ranked/2024'), pageOf('/rankings/ranked'));
  assert.equal(pageOf('/rankings/ranked/2024'), pageOf('/rankings/converts'));
});
