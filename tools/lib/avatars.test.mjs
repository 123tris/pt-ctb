// node --test tools/lib/avatars.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateAvatars, thumbNames, sharpResizer, RECHECK_MS } from './avatars.mjs';

const NOW = Date.UTC(2026, 9, 26);
/** A stand-in for sharp: the "thumbnail" says which image and size it came from. */
const resize = async (input, px) => Buffer.from(`${input}@${px}`);
/** A fake a.ppy.sh: `avatars` is { id: { body, etag } }; records each request's id and conditional headers. */
function fakeCdn(avatars) {
  const calls = [];
  const fetchImpl = async (url, { headers }) => {
    const id = Number(url.split('/').pop());
    calls.push({ id, headers });
    const a = avatars[id];
    if (!a) return new Response('', { status: 500 });
    if (headers['If-None-Match'] === a.etag) return new Response(null, { status: 304 });
    return new Response(a.body, { status: 200, headers: { etag: a.etag, 'last-modified': 'Thu, 05 Mar 2020 09:49:07 GMT' } });
  };
  return { calls, fetchImpl };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'avatars-'));

test('a new player is fetched once and made in both sizes; within a day they are not asked for again', async () => {
  const outDir = tmp();
  const cdn = fakeCdn({ 7: { body: 'seven', etag: '"a"' } });
  const first = await updateAvatars({ ids: [7], outDir, now: NOW, resize, fetchImpl: cdn.fetchImpl });
  assert.deepEqual(Object.keys(first.files), thumbNames(7));
  assert.equal(fs.readFileSync(path.join(outDir, 'avatars/7-64.webp'), 'utf8'), 'seven@64');
  assert.equal(String(first.files['avatars/7-128.webp']), 'seven@128');
  assert.deepEqual(first.state[7], { etag: '"a"', modified: 'Thu, 05 Mar 2020 09:49:07 GMT', checked: NOW });
  assert.deepEqual(cdn.calls[0].headers, {}, 'nothing to compare against yet');

  const again = await updateAvatars({ ids: [7], outDir, state: first.state, now: NOW + RECHECK_MS - 1, resize, fetchImpl: cdn.fetchImpl });
  assert.equal(cdn.calls.length, 1);
  assert.equal(String(again.files['avatars/7-64.webp']), 'seven@64');
  assert.equal(again.stats.kept, 1);
});

test('after a day the avatar is re-checked: unchanged keeps the thumbnails, changed redraws them', async () => {
  const outDir = tmp();
  const avatars = { 7: { body: 'seven', etag: '"a"' } };
  const cdn = fakeCdn(avatars);
  const first = await updateAvatars({ ids: [7], outDir, now: NOW, resize, fetchImpl: cdn.fetchImpl });

  const later = NOW + RECHECK_MS;
  const same = await updateAvatars({ ids: [7], outDir, state: first.state, now: later, resize, fetchImpl: cdn.fetchImpl });
  assert.equal(cdn.calls[1].headers['If-None-Match'], '"a"');
  assert.equal(same.stats.unchanged, 1);
  assert.equal(same.state[7].checked, later);
  assert.equal(String(same.files['avatars/7-64.webp']), 'seven@64');

  avatars[7] = { body: 'new look', etag: '"b"' };
  const changed = await updateAvatars({ ids: [7], outDir, state: same.state, now: later + RECHECK_MS, resize, fetchImpl: cdn.fetchImpl });
  assert.equal(changed.stats.fetched, 1);
  assert.equal(fs.readFileSync(path.join(outDir, 'avatars/7-128.webp'), 'utf8'), 'new look@128');
  assert.equal(changed.state[7].etag, '"b"');
});

test('thumbnails are listed in the order of the ids, however the fetches finish (meta.json stays the same)', async () => {
  const cdn = fakeCdn({ 7: { body: 'seven', etag: '"a"' }, 8: { body: 'eight', etag: '"c"' } });
  const slowFirst = async (url, init) => {
    if (url.endsWith('/7')) await new Promise(r => setTimeout(r, 30));
    return cdn.fetchImpl(url, init);
  };
  const run = await updateAvatars({ ids: [7, 8], outDir: tmp(), now: NOW, resize, fetchImpl: slowFirst });
  assert.deepEqual(Object.keys(run.files), [...thumbNames(7), ...thumbNames(8)]);
});

test('missing thumbnails are fetched again, unconditionally, even when the state says they were checked', async () => {
  const outDir = tmp();
  const cdn = fakeCdn({ 7: { body: 'seven', etag: '"a"' } });
  const first = await updateAvatars({ ids: [7], outDir, now: NOW, resize, fetchImpl: cdn.fetchImpl });
  fs.rmSync(path.join(outDir, 'avatars'), { recursive: true });
  const again = await updateAvatars({ ids: [7], outDir, state: first.state, now: NOW + 1, resize, fetchImpl: cdn.fetchImpl });
  assert.deepEqual(cdn.calls[1].headers, {});
  assert.deepEqual(Object.keys(again.files), thumbNames(7));
});

test('a failed fetch keeps the previous thumbnails and retries next run; a player with none is left out', async () => {
  const outDir = tmp();
  const avatars = { 7: { body: 'seven', etag: '"a"' } };
  const cdn = fakeCdn(avatars);
  const first = await updateAvatars({ ids: [7], outDir, now: NOW, resize, fetchImpl: cdn.fetchImpl });
  delete avatars[7]; // a.ppy.sh answers 500 from now on
  const logged = [];
  const run = await updateAvatars({ ids: [7, 8], outDir, state: first.state, now: NOW + RECHECK_MS, resize, fetchImpl: cdn.fetchImpl, log: m => logged.push(m) });
  assert.deepEqual(Object.keys(run.files), thumbNames(7));
  assert.deepEqual(run.state[7], first.state[7], 'still due for a check');
  assert.equal(run.state[8], undefined);
  assert.equal(run.stats.failed, 2);
  assert.equal(logged.length, 2);
});

test('without sharp, existing thumbnails are kept and nothing is fetched', async () => {
  const outDir = tmp();
  const cdn = fakeCdn({ 7: { body: 'seven', etag: '"a"' }, 8: { body: 'eight', etag: '"c"' } });
  const first = await updateAvatars({ ids: [7], outDir, now: NOW, resize, fetchImpl: cdn.fetchImpl });
  const run = await updateAvatars({ ids: [7, 8], outDir, state: first.state, now: NOW + RECHECK_MS, resize: null, fetchImpl: cdn.fetchImpl });
  assert.equal(cdn.calls.length, 1);
  assert.deepEqual(Object.keys(run.files), thumbNames(7));
  assert.deepEqual(run.stats, { fetched: 0, unchanged: 0, failed: 0, kept: 1, missing: 1 });
});

test('sharp makes square WebP thumbnails of the asked size', async t => {
  let real;
  try { real = await sharpResizer(); } catch { t.skip('sharp isn’t installed'); return; }
  const { default: sharp } = await import('sharp');
  const wide = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#e44' } }).png().toBuffer();
  const out = await real(wide, 64);
  const info = await sharp(out).metadata();
  assert.deepEqual([info.format, info.width, info.height], ['webp', 64, 64]);
});
