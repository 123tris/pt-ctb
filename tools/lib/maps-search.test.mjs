// node --test tools/lib/maps-search.test.mjs
// The compact maps index must decode to exactly the rows maps-index.json holds.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeMapsSearch, decodeMapsSearch } from '../../assets/js/core/maps-search.js';

const byId = rows => [...rows].sort((a, b) => a[0] - b[0]);

test('round-trips rows, including untitled maps, shared sets and unknown stars', () => {
  const rows = [
    [4172054, 2005921, 'WangleLine', 'Dice', 'Highroll', 6.4, 'c', 7, 13294871],
    [4172053, 2005921, 'WangleLine', 'Dice', 'Lowroll', 5.12, 'c', 2, 3821475],
    [2328679, 1114770, 'MAXIMUM THE HORMONE', 'ChuChu', 'Malding Bunny', 6.39, 'c', 2, 3821475],
    [99, 0, '', '', '', 0, 'u', 1, 13294871],
    [5000000, 2400000, 'nanahira', 'Song', '[Rain]', 4.07, 'r', 1, 2788013],
  ];
  const file = JSON.parse(JSON.stringify(encodeMapsSearch(rows))); // as the site gets it
  assert.equal(file.sets.length, 4); // Dice's two difficulties share one set entry
  assert.deepEqual(byId(decodeMapsSearch(file)), byId(rows));
});

test('round-trips the exported maps-index.json, when there is one', t => {
  const exported = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'maps-index.json');
  if (!fs.existsSync(exported)) return t.skip('no export in data/');
  const rows = JSON.parse(fs.readFileSync(exported, 'utf8'));
  assert.deepEqual(byId(decodeMapsSearch(JSON.parse(JSON.stringify(encodeMapsSearch(rows))))), byId(rows));
});
