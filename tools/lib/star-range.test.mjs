// node --test tools/lib/star-range.test.mjs
// The Maps page's star filter: reading it from the URL, writing it back, its readout and which maps it lets through.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStars, formatStars, starsLabel, inStars, clampRange, STAR_MAX } from '../../assets/js/core/star-range.js';

test('reads both ends, open ends and nothing', () => {
  assert.deepEqual(parseStars({ stars: '4-7' }), [4, 7]);
  assert.deepEqual(parseStars({ stars: '3.5-6.25' }), [3.5, 6.3]);
  assert.deepEqual(parseStars({ stars: '7-' }), [7, STAR_MAX]);
  assert.deepEqual(parseStars({ stars: '-4' }), [0, 4]);
  assert.deepEqual(parseStars({ stars: '0-4' }), [0, 4]);
  assert.deepEqual(parseStars({}), [0, STAR_MAX]);
  assert.deepEqual(parseStars(), [0, STAR_MAX]);
});

test('keeps odd input on the scale', () => {
  assert.deepEqual(parseStars({ stars: '7-4' }), [4, 7]);
  assert.deepEqual(parseStars({ stars: '2-60' }), [2, STAR_MAX]);
  assert.deepEqual(parseStars({ stars: '5-5' }), [4.9, 5]);
  assert.deepEqual(parseStars({ stars: '0-0' }), [0, 0.1]);
  for (const junk of ['', '-', 'abc', '4', '4-7-9', 'x-7']) assert.deepEqual(parseStars({ stars: junk }), [0, STAR_MAX], junk);
});

test('old difficulty-name links become star bands; a stars range wins over them', () => {
  assert.deepEqual(parseStars({ diff: 'platter' }), [2.7, 4]);
  assert.deepEqual(parseStars({ diff: 'overdose' }), [5.3, STAR_MAX]);
  assert.deepEqual(parseStars({ diff: 'dose' }), [5.3, STAR_MAX]);
  assert.deepEqual(parseStars({ diff: 'constructor' }), [0, STAR_MAX]);
  assert.deepEqual(parseStars({ diff: 'cup', stars: '6-' }), [6, STAR_MAX]);
});

test('writes back what it reads, and nothing for the full range', () => {
  for (const s of ['4-7', '7-', '0-4', '3.5-6.3']) assert.equal(formatStars(parseStars({ stars: s })), s);
  assert.equal(formatStars([0, STAR_MAX]), '');
  assert.equal(formatStars(clampRange([0.1 + 0.2, 7.1])), '0.3-7.1');
});

test('reads out the range', () => {
  assert.equal(starsLabel([0, STAR_MAX]), 'Any');
  assert.equal(starsLabel([7, STAR_MAX]), '7★+');
  assert.equal(starsLabel([0, 4]), 'Up to 4★');
  assert.equal(starsLabel([3.5, 7]), '3.5★ – 7★');
});

test('filters by stars, with no ceiling at the top and unknown stars only unfiltered', () => {
  assert.ok(inStars(5, [4, 7]));
  assert.ok(inStars(4, [4, 7]) && inStars(7, [4, 7]));
  assert.ok(!inStars(7.01, [4, 7]) && !inStars(3.99, [4, 7]));
  assert.ok(inStars(96.17, [7, STAR_MAX]));
  assert.ok(inStars(0, [0, STAR_MAX]));
  assert.ok(!inStars(0, [0, 4]));
});
