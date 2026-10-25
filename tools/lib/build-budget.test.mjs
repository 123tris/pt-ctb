// node --test tools/lib/build-budget.test.mjs
// The Cloudflare Pages build budget the pre-push hook enforces (tools/build-budget.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, parseReflog, countBuilds, checkPush, pushedBranches } from './build-budget.mjs';

const NOW = 1_800_000_000;
const DAY = 86400;

test('reflog entries become build times; deletions are not builds', () => {
  const text = [
    'refs/remotes/origin/dev@{1792944578}|update by push',
    'refs/remotes/origin/dev@{1792944362}|fetch: fast-forward',
    'refs/remotes/origin/dev@{1792940000}|update by push: delete',
    '',
  ].join('\n');
  assert.deepEqual(parseReflog(text), [1792944578, 1792944362]);
});

test('builds are counted over 31 days, previews apart, and previews over the last 24 hours', () => {
  const counts = countBuilds({
    main: [NOW - 10, NOW - 5 * DAY, NOW - 40 * DAY],
    dev: [NOW - 60, NOW - 2 * DAY, NOW - 30 * DAY],
    'some-feature': [NOW - 3600],
  }, NOW);
  assert.deepEqual(counts, { total: 6, preview: 4, previewToday: 2 });
});

test('a push within every limit goes ahead, and warns as a limit gets close', () => {
  assert.deepEqual(checkPush({ total: 10, preview: 5, previewToday: 1 }, ['dev']), { ok: true, reasons: [], warnings: [] });
  const close = checkPush({ total: 320, preview: 100, previewToday: 1 }, ['main']);
  assert.equal(close.ok, true);
  assert.match(close.warnings[0], /321 of 450/);
});

test('too many previews today refuses dev but still lets a release through', () => {
  const counts = { total: 100, preview: 80, previewToday: LIMITS.previewPerDay };
  const dev = checkPush(counts, ['dev']);
  assert.equal(dev.ok, false);
  assert.match(dev.reasons[0], /last 24 hours/);
  assert.equal(checkPush(counts, ['main']).ok, true);
});

test('the 31-day preview share and the overall cap', () => {
  assert.equal(checkPush({ total: 300, preview: LIMITS.preview, previewToday: 0 }, ['dev']).ok, false);
  assert.equal(checkPush({ total: 300, preview: LIMITS.preview, previewToday: 0 }, ['main']).ok, true);
  const full = checkPush({ total: LIMITS.total, preview: 0, previewToday: 0 }, ['main']);
  assert.equal(full.ok, false);
  assert.match(full.reasons[0], /Cloudflare free plan/);
  // Two branches in one push are two builds.
  assert.equal(checkPush({ total: LIMITS.total - 1, preview: 0, previewToday: 0 }, ['main', 'dev']).ok, false);
});

test('the hook builds a list of pushed branches, leaving out deletions and tags', () => {
  const stdin = [
    'refs/heads/dev 1111111111111111111111111111111111111111 refs/heads/dev 2222222222222222222222222222222222222222',
    'refs/heads/x 0000000000000000000000000000000000000000 refs/heads/x 3333333333333333333333333333333333333333',
    'refs/tags/v1 4444444444444444444444444444444444444444 refs/tags/v1 0000000000000000000000000000000000000000',
    '',
  ].join('\n');
  assert.deepEqual(pushedBranches(stdin), ['dev']);
});
