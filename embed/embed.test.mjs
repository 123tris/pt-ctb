import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, withData, withHead, pageFor, dataFor, isPreviewBot } from './embed.js';
import { PAGES, matchPage } from '../assets/js/core/routes.js';

const INDEX = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const PLAYERS = [
  { id: 19423459, name: '_wb', pp: 9116.17, acc: 99.43, plays: 31926, global: 976, country: 4 },
  { id: 16589307, name: 'Rosa', pp: 4401.2, acc: 99.36, plays: 12254, global: 3284, country: 25 },
];
const MAP = { m: ['Hinoi Team', 'Aishiteru', 'Crusin', 46, 1.13, 4, 5, 4, 4, 135, 71, 134, 1, 0, 'MCXD'], c: 'c', s: [[16589307, 128], [19423459, 100]] };

test('every page has its own title and description', () => {
  const seen = new Set();
  for (const pattern of PAGES) {
    const address = `/${pattern.split('/').filter(k => !k.endsWith('?')).map(k => (k.startsWith(':') ? '1' : k)).join('/')}`;
    const embed = describe(address);
    assert.ok(embed, address);
    assert.ok(embed.title && embed.description.length > 30, address);
    assert.ok(!seen.has(embed.description), `${address} repeats another page's description`);
    seen.add(embed.description);
  }
});

test('sub-pages, moved addresses and unknown ones', () => {
  assert.match(describe('/rankings/plays').title, /^Top plays/);
  assert.match(describe('/challenges/hill').description, /crown/);
  assert.match(describe('/games/higher-lower').title, /^Higher or lower/);
  assert.equal(describe('/dan').title, describe('/challenges/dan').title);
  assert.equal(describe('/rankings/').title, describe('/rankings').title);
  assert.equal(describe('/nope'), null);
  assert.equal(describe('/auth/login'), null);
  assert.equal(describe('/player/1/2/3'), null);
  assert.equal(describe('/map/%E0%A4%A'), null);
});

test('a player, a map, a recap and a comparison name their subject', () => {
  const player = withData(describe('/player/19423459/best'), { players: PLAYERS });
  assert.equal(player.title, '_wb · PT Catch');
  assert.match(player.description, /#4 in Portugal and #976 in the world · 9,116 pp · 99\.43% accuracy · 31,926 plays/);
  assert.equal(player.image, 'https://a.ppy.sh/19423459');

  const map = withData(describe('/map/128'), { players: PLAYERS, map: MAP });
  assert.equal(map.title, 'Hinoi Team - Aishiteru [Crusin] · PT Catch');
  assert.match(map.description, /^1\.13★ osu!catch map by MCXD\. 2 Portuguese players have scores on it; Rosa holds the #1\.$/);
  assert.equal(map.image, 'https://assets.ppy.sh/beatmaps/46/covers/cover.jpg');

  assert.equal(withData(describe('/recap/16589307/2025'), { players: PLAYERS }).title, 'Rosa in 2025 · PT Catch');
  assert.match(withData(describe('/recap/16589307'), { players: PLAYERS }).description, /^Rosa’s year in osu!catch/);
  assert.equal(withData(describe('/compare/19423459/16589307'), { players: PLAYERS }).title, '_wb vs Rosa · PT Catch');

  const duel = {
    id: 7, ranked: true, bestOf: 5, status: 'finished', stars: [5.9, 6.9], winner: 16589307,
    players: [{ u: 19423459, name: 'old name', pts: 1 }, { u: 16589307, name: 'Rosa', pts: 3 }],
  };
  const duelEmbed = withData(describe('/duel/7'), { players: PLAYERS, duel });
  assert.equal(duelEmbed.title, '_wb vs Rosa · PT Catch');
  assert.match(duelEmbed.description, /^Rosa beat _wb 3–1 in a ranked best of 5 osu!catch duel at 5\.9–6\.9★\./);
  assert.equal(duelEmbed.image, 'https://a.ppy.sh/16589307');
  assert.match(withData(describe('/duel/7'), { players: PLAYERS, duel: { ...duel, status: 'abandoned', winner: null } }).description, /was abandoned at 1–3/);
  assert.equal(describe('/duel/0').kind, undefined);

  // Unknown ids, or no data, keep the address-only text.
  assert.deepEqual(withData(describe('/player/5'), { players: PLAYERS }), describe('/player/5'));
  assert.deepEqual(withData(describe('/map/5'), {}), describe('/map/5'));
});

test('the head gets the preview, once, escaped, with <base>', () => {
  const page = withHead(INDEX, { title: 'A "b" <c> · PT Catch', description: 'x & y', image: 'https://a.ppy.sh/1' }, 'https://ptcatch.com/player/1');
  assert.match(page, /<title>A &quot;b&quot; &lt;c&gt; · PT Catch<\/title>/);
  assert.match(page, /<meta name="description" content="x &amp; y">/);
  assert.match(page, /<meta property="og:title" content="A &quot;b&quot; &lt;c&gt;">/);
  assert.match(page, /<meta property="og:url" content="https:\/\/ptcatch.com\/player\/1">/);
  assert.equal(page.match(/property="og:description"/g).length, 1);
  assert.equal(page.match(/<base href="\/">/g).length, 1);
  assert.ok(page.indexOf('<base') < page.indexOf('assets/css/site.css'));
  assert.doesNotMatch(page, /The front page's link preview/);
});

test('only crawlers wait for data', async () => {
  let fetched = 0;
  const files = { 'meta.json': { files: { 'players.json': 'AAAAAAAAAA', 'maps/0.json': 'BBBBBBBBBB' } }, 'players.AAAAAAAAAA.json': PLAYERS, 'maps/0.BBBBBBBBBB.json': { 128: MAP } };
  const fetchJson = async url => { fetched++; const f = files[url.replace('https://data.test/', '')]; if (!f) throw new Error('404'); return f; };
  const opts = ua => ({ ua, base: 'https://data.test/', fetchJson });

  const human = await pageFor(INDEX, 'https://ptcatch.com/player/16589307', opts('Mozilla/5.0 Firefox/140.0'));
  assert.match(human, /<title>Player · PT Catch<\/title>/);
  assert.equal(fetched, 0);

  const bot = await pageFor(INDEX, 'https://ptcatch.com/map/128', opts('Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'));
  assert.match(bot, /<title>Hinoi Team - Aishiteru \[Crusin\] · PT Catch<\/title>/);
  assert.match(bot, /summary_large_image/);

  assert.equal(await pageFor(INDEX, 'https://ptcatch.com/nope', opts('Discordbot')), null);
  assert.deepEqual(await dataFor({ kind: 'player', id: 1 }, 'https://data.test/', () => Promise.reject(new Error('down'))), {});
  assert.ok(isPreviewBot('Mozilla/5.0 (compatible; Discordbot/2.0)'));
  assert.ok(!isPreviewBot('Mozilla/5.0 (Windows NT 10.0) Chrome/140'));
});

test('routes match the router', () => {
  assert.deepEqual(matchPage('player/5/best'), { pattern: 'player/:id/:tab?', params: { id: '5', tab: 'best' } });
  assert.equal(matchPage('player'), null);
});
