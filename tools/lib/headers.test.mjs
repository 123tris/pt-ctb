// node --test tools/lib/headers.test.mjs
// The release build's _headers must keep one /data/* block with both its cache rule and the CORS header.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHeaders, addHeader, assertOneBlock } from './headers.mjs';

const repoHeaders = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '_headers'), 'utf8');

test('the release build adds CORS inside the one /data/* block', () => {
  const text = addHeader(repoHeaders, '/data/*', 'Access-Control-Allow-Origin', 'https://dev.example');
  assertOneBlock(text, '/data/*', ['Cache-Control', 'Access-Control-Allow-Origin']);
  const [block] = parseHeaders(text).filter(b => b.path === '/data/*');
  assert.deepEqual(block.headers, [['Cache-Control', 'public, max-age=604800'], ['Access-Control-Allow-Origin', 'https://dev.example']]);
  // The JS and CSS rules stay as they were.
  assert.deepEqual(parseHeaders(text).find(b => b.path === '/assets/js/*').headers, [['Cache-Control', 'no-cache']]);
  assert.deepEqual(parseHeaders(text).find(b => b.path === '/assets/css/*').headers, [['Cache-Control', 'no-cache']]);
});

test('a second block for the same path is caught', () => {
  const twice = `${repoHeaders}\n/data/*\n  Access-Control-Allow-Origin: https://dev.example\n`;
  assert.throws(() => assertOneBlock(twice, '/data/*', ['Cache-Control', 'Access-Control-Allow-Origin']), /expected one \/data\/\* block, found 2/);
  assert.throws(() => assertOneBlock(repoHeaders, '/data/*', ['Cache-Control', 'Access-Control-Allow-Origin']), /missing Access-Control-Allow-Origin/);
});

test('works with LF and CRLF line ends', () => {
  for (const eol of ['\n', '\r\n']) {
    const text = ['/a/*', '  X-One: 1', '', '/data/*', '  Cache-Control: no-cache', '/b/*', '  X-Two: 2', ''].join(eol);
    const out = addHeader(text, '/data/*', 'X-New', 'yes');
    assert.equal(out, ['/a/*', '  X-One: 1', '', '/data/*', '  Cache-Control: no-cache', '  X-New: yes', '/b/*', '  X-Two: 2', ''].join(eol));
  }
});
