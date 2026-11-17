// Tests for where the bot's map links go (maplinks/maplinks.js). Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapId, choiceOf, choiceCookie, siteHasMap, destination, mapLink, chooseLinks, osuMap, MAX_AGE } from './maplinks.js';

const DATA = 'https://data.example/';
const PLAYED = 1207082;   // on its bucket's board
const WEEK = 1290997;     // the map of the week, with no plays here yet
const HILL = 4295633;     // in King of the hill's pool
const BOUNTY = 3734428;   // an open bounty's map
const NOBODY = 4079879;   // nothing here at all

const META = {
  week: { map: WEEK, end: 1795392000 },
  hill: { pool: [['NM', 'open', 1699518, null], ['NM', 'challenger', HILL, null]] },
  files: { [`maps/${PLAYED % 128}.json`]: 'bucketHash', [`maps/${NOBODY % 128}.json`]: 'emptyHash0', 'bounties.json': 'bountyHash' },
};
const FILES = {
  [`${DATA}meta.json`]: META,
  [`${DATA}maps/${PLAYED % 128}.bucketHash.json`]: { [PLAYED]: { m: null, c: 'r', s: [[123, 1]] } },
  [`${DATA}maps/${NOBODY % 128}.emptyHash0.json`]: { 1: { m: null, c: 'r', s: [] } },
  [`${DATA}bounties.bountyHash.json`]: { maps: { [BOUNTY]: ['Artist', 'Title'] } },
};
/** fetchJson over FILES, counting what it's asked for; anything else is a 404. */
function fakeData(files = FILES) {
  const asked = [];
  const fetchJson = async url => {
    asked.push(url);
    if (!(url in files)) throw new Error(`404 ${url}`);
    return files[url];
  };
  return { fetchJson, asked };
}
const get = (path, cookie) => new Request(`https://ptcatch.com${path}`, { headers: cookie ? { Cookie: cookie } : {} });

test('a map id is 1 to 10 digits within osu!’s ids', () => {
  assert.equal(mapId('1207082'), 1207082);
  assert.equal(mapId(1207082), 1207082);
  assert.equal(mapId('2147483647'), 2147483647);
  for (const junk of ['0', '-1', '12a', '1.5', '', ' 1', '2147483648', '99999999999', null, undefined]) assert.equal(mapId(junk), null, String(junk));
});

test('the choice is read off the Cookie header, and only a known one counts', () => {
  assert.equal(choiceOf('maplinks=osu'), 'osu');
  assert.equal(choiceOf('a=1; maplinks=ptcatch; b=2'), 'ptcatch');
  assert.equal(choiceOf('xmaplinks=osu; maplinks=osu'), 'osu');
  assert.equal(choiceOf('maplinks=elsewhere'), null);
  assert.equal(choiceOf('maplinksx=osu'), null);
  assert.equal(choiceOf(''), null);
  assert.equal(choiceOf(null), null);
});

test('the cookie lasts 400 days on the whole site, Secure except on plain http', () => {
  assert.equal(MAX_AGE, 400 * 86400);
  assert.equal(choiceCookie('osu'), `maplinks=osu; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax; Secure`);
  assert.equal(choiceCookie('ptcatch', false), `maplinks=ptcatch; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`);
});

test('the site has a map with plays here or a challenge on it, and nothing else', async () => {
  const { fetchJson } = fakeData();
  for (const id of [PLAYED, WEEK, HILL, BOUNTY]) assert.equal(await siteHasMap(id, DATA, fetchJson), true, String(id));
  assert.equal(await siteHasMap(NOBODY, DATA, fetchJson), false);
  // A bucket the data doesn't list (no map in it has plays) is no page either, and isn't asked for.
  const empty = fakeData();
  assert.equal(await siteHasMap(64, DATA, empty.fetchJson), false);
  assert.ok(!empty.asked.some(url => url.includes('/maps/64')));
  // Data that can't be read is an error, which destination() takes as "no".
  await assert.rejects(siteHasMap(PLAYED, DATA, fakeData({}).fetchJson));
});

test('where /b/ goes: osu! by choice, here otherwise, and osu! for a map the site has nothing on', async () => {
  const yes = async () => true, no = async () => false, broken = async () => { throw new Error('R2 is down'); };
  assert.equal(await destination(5, 'osu', yes), osuMap(5));
  assert.equal(await destination(5, 'ptcatch', yes), '/map/5');
  assert.equal(await destination(5, null, yes), '/map/5?via=bot', 'no choice yet: the map page offers it');
  assert.equal(await destination(5, 'ptcatch', no), osuMap(5));
  assert.equal(await destination(5, null, broken), osuMap(5));
  assert.equal(osuMap(5), 'https://osu.ppy.sh/beatmaps/5?mode=fruits');
  // Choosing osu! never waits on the data.
  let asked = false;
  await destination(5, 'osu', async () => { asked = true; return true; });
  assert.equal(asked, false);
});

test('GET /b/<id> redirects, never cached, and keeps the visitor’s choice fresh', async () => {
  const data = { data: DATA, fetchJson: fakeData().fetchJson };

  let res = await mapLink(get(`/b/${PLAYED}`), String(PLAYED), data);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `https://ptcatch.com/map/${PLAYED}?via=bot`);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(res.headers.get('Set-Cookie'), null, 'no choice, nothing to keep');

  res = await mapLink(get(`/b/${PLAYED}`, 'maplinks=ptcatch'), String(PLAYED), data);
  assert.equal(res.headers.get('Location'), `https://ptcatch.com/map/${PLAYED}`);
  assert.match(res.headers.get('Set-Cookie'), /^maplinks=ptcatch; Path=\/; Max-Age=34560000; SameSite=Lax; Secure$/);

  res = await mapLink(get(`/b/${PLAYED}`, 'maplinks=osu'), String(PLAYED), data);
  assert.equal(res.headers.get('Location'), osuMap(PLAYED));
  assert.match(res.headers.get('Set-Cookie'), /^maplinks=osu;/);

  res = await mapLink(get(`/b/${NOBODY}`, 'maplinks=ptcatch'), String(NOBODY), data);
  assert.equal(res.headers.get('Location'), osuMap(NOBODY), 'nothing here: osu!');

  assert.equal(await mapLink(get('/b/abc'), 'abc', data), null, 'no map id: the 404');

  // Locally (http://localhost) the cookie can't be Secure.
  res = await mapLink(new Request(`http://localhost:8080/b/${PLAYED}`, { headers: { Cookie: 'maplinks=osu' } }), String(PLAYED), data);
  assert.doesNotMatch(res.headers.get('Set-Cookie'), /Secure/);
});

test('GET /maplinks/<choice> keeps it, then shows the map by it or the Bot commands page', () => {
  let res = chooseLinks(get(`/maplinks/osu?map=${PLAYED}`), 'osu');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `https://ptcatch.com/b/${PLAYED}`);
  assert.match(res.headers.get('Set-Cookie'), /^maplinks=osu; Path=\/; Max-Age=34560000; SameSite=Lax; Secure$/);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');

  res = chooseLinks(get('/maplinks/ptcatch'), 'ptcatch');
  assert.equal(res.headers.get('Location'), 'https://ptcatch.com/commands');
  assert.match(res.headers.get('Set-Cookie'), /^maplinks=ptcatch;/);

  res = chooseLinks(get('/maplinks/elsewhere?map=x'), 'elsewhere');
  assert.equal(res.headers.get('Location'), 'https://ptcatch.com/commands');
  assert.equal(res.headers.get('Set-Cookie'), null, 'an unknown choice changes nothing');
});
