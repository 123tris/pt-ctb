// DESIGN.md's checkable rules hold for the styles and the page markup (tools/design-check.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from './design-check.mjs';

test('the styles and markup follow DESIGN.md: scale, radii, colours in :root, no glass, glows, pills or emoji', () => {
  const found = check().map(f => `${f.file}:${f.line} [${f.rule}] ${f.message}`);
  assert.deepEqual(found, [], 'node tools/design-check.mjs lists these; DESIGN.md says why');
});
