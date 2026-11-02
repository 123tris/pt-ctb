// node --test tools/lib/maps-search.test.mjs
// The compact maps index must decode to exactly the rows it was made from.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeMapsSearch, decodeMapsSearch, rankMaps, beatmapIdOf, encodeSearchMaps, decodeSearchMaps } from '../../assets/js/core/maps-search.js';

const byId = rows => [...rows].sort((a, b) => a[0] - b[0]);

test('round-trips rows, including untitled maps, shared sets and unknown stars', () => {
  const rows = [
    [4172054, 2005921, 'WangleLine', 'Dice', 'Highroll', 6.4, 'c', 7, 13294871, 'Nao Tomori'],
    [4172053, 2005921, 'WangleLine', 'Dice', 'Lowroll', 5.12, 'c', 2, 3821475, 'Nao Tomori'],
    [2328679, 1114770, 'MAXIMUM THE HORMONE', 'ChuChu', 'Malding Bunny', 6.39, 'c', 2, 3821475, 'Nao Tomori'],
    [99, 0, '', '', '', 0, 'u', 1, 13294871, ''],
    [5000000, 2400000, 'nanahira', 'Song', '[Rain]', 4.07, 'r', 1, 2788013, 'Ascendance'],
  ];
  const file = JSON.parse(JSON.stringify(encodeMapsSearch(rows))); // as the site gets it
  assert.equal(file.sets.length, 4); // Dice's two difficulties share one set entry
  assert.deepEqual(byId(decodeMapsSearch(file)), byId(rows));
  assert.deepEqual(file.mappers, ['', 'Nao Tomori', 'Ascendance']); // each name once
});

test('a file from before mappers decodes with an empty mapper', () => {
  const file = JSON.parse(JSON.stringify(encodeMapsSearch([[1, 2, 'A', 'T', 'V', 3, 'r', 1, 5, 'M']])));
  delete file.mappers;
  file.sets = file.sets.map(s => s.slice(0, 3));
  assert.equal(decodeMapsSearch(file)[0][9], '');
});

test('round-trips the exported maps-search.json, when there is one', t => {
  const exported = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'maps-search.json');
  if (!fs.existsSync(exported)) return t.skip('no export in data/');
  const rows = decodeMapsSearch(JSON.parse(fs.readFileSync(exported, 'utf8')));
  assert.deepEqual(byId(decodeMapsSearch(JSON.parse(JSON.stringify(encodeMapsSearch(rows))))), byId(rows));
});

test('header search: maps match artist, title, difficulty and mapper; a title that starts with the text comes first', () => {
  const rows = [
    [1, 10, 'Camellia', 'Ghost', 'Extra', 6.1, 'c', 3, 7, 'Nao Tomori'],
    [2, 11, 'Some Band', 'Ghost Rule', 'Insane', 5.2, 'r', 9, 7, 'Ascendance'],
    [3, 12, 'Ghostfinal', 'Other', 'Hard', 4.0, 'r', 20, 7, 'Someone'],
    [4, 13, 'X', 'Y', 'Ghostly diff', 3.0, 'r', 1, 7, 'Zed'],
  ];
  const hay = rows.map(r => `${r[3]} ${r[2]} ${r[4]} ${r[9]}`.toLowerCase());
  const ids = text => rankMaps(rows, hay, text).map(m => m.row[0]);
  assert.deepEqual(ids('ghost'), [2, 1, 3, 4]); // titles first (most played first), then the rest, at most 4
  assert.deepEqual(ids('nao'), [1]); // the mapper
  assert.deepEqual(ids('insane ghost'), [2]); // every word, any order
  assert.deepEqual(ids('g'), []); // two characters at least
});

test('header search: an exact beatmap id or osu! link finds that map, even one nobody here has played', () => {
  const rows = [[2018512, 900, 'A', 'T', 'V', 5, 'r', 2, 7, 'M']];
  const hay = ['t a v m'];
  for (const text of ['2018512', 'https://osu.ppy.sh/beatmapsets/900#fruits/2018512', 'https://osu.ppy.sh/beatmaps/2018512', 'https://osu.ppy.sh/b/2018512']) {
    assert.equal(beatmapIdOf(text), 2018512, text);
    assert.equal(rankMaps(rows, hay, text)[0].row[3], 'T', text);
  }
  assert.deepEqual(rankMaps(rows, hay, '42')[0].row.slice(0, 2), [42, 0]);
  assert.equal(beatmapIdOf('osu.ppy.sh/users/123'), null);
});

test('the search index keeps id, set, artist, title, difficulty, stars, category, players and mapper', () => {
  const rows = [
    [4172054, 2005921, 'WangleLine', 'Dice', 'Highroll', 6.43, 'c', 7, 13294871, 'Nao Tomori'],
    [4172053, 2005921, 'WangleLine', 'Dice', 'Lowroll', 5.12, 'c', 2, 3821475, 'Nao Tomori'],
    [5000000, 2400000, 'nanahira', 'Song', '[Rain]', 4.07, 'r', 3, 2788013, 'Ascendance'],
  ];
  const back = byId(decodeSearchMaps(JSON.parse(JSON.stringify(encodeSearchMaps(rows)))));
  assert.deepEqual(back.map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[9]]), byId(rows).map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[9]]));
});
