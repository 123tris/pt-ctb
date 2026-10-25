#!/usr/bin/env node
// Keeps pushes inside Cloudflare Pages' free plan (500 builds a month): run by the pre-push hook in tools/git-hooks/,
// or by hand to see the count. Rules and how builds are counted: tools/lib/build-budget.mjs.
//
//   node tools/build-budget.mjs                  # show this month's builds
//   node tools/build-budget.mjs pre-push origin  # (the hook) reads the pushed refs on stdin; exit 1 refuses the push
//
// One push that has to go out anyway (a hotfix on main past the cap, say): set PTCTB_BUILD_BUDGET=off for it.
// Turn the hook on for every worktree of this repo:  git config core.hooksPath tools/git-hooks

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { LIMITS, parseReflog, countBuilds, checkPush, pushedBranches } from './lib/build-budget.mjs';

const [mode, remote = 'origin'] = process.argv.slice(2);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const byBranch = {};
const prefix = `refs/remotes/${remote}/`;
for (const ref of git('for-each-ref', '--format=%(refname)', prefix).split('\n').filter(Boolean)) {
  const branch = ref.slice(prefix.length);
  if (branch === 'HEAD') continue;
  let log = '';
  try { log = git('log', '-g', '--format=%gD|%gs', '--date=unix', ref); } catch { /* no reflog for it */ }
  byBranch[branch] = parseReflog(log);
}
const now = Math.floor(Date.now() / 1000);
const counts = countBuilds(byBranch, now);
const summary = `Pages builds in the last 31 days: ${counts.total} of ${LIMITS.total} (all branches), `
  + `${counts.preview} of ${LIMITS.preview} previews, ${counts.previewToday} of ${LIMITS.previewPerDay} previews in 24 hours.`;

if (mode !== 'pre-push') {
  console.log(summary);
  process.exit(0);
}

const branches = pushedBranches(fs.readFileSync(0, 'utf8'));
if (!branches.length) process.exit(0);
const verdict = checkPush(counts, branches);
for (const w of verdict.warnings) console.error(`build budget: getting close: ${w}`);
if (verdict.ok) process.exit(0);

if (process.env.PTCTB_BUILD_BUDGET === 'off') {
  console.error(`build budget: OVER, pushing anyway because PTCTB_BUILD_BUDGET=off:\n  ${verdict.reasons.join('\n  ')}`);
  process.exit(0);
}
console.error([
  `build budget: push REFUSED (${branches.join(', ')}) to stay inside Cloudflare Pages' free plan.`,
  ...verdict.reasons.map(r => `  ${r}`),
  `  ${summary}`,
  '  Batch your commits and push later (the 24-hour window moves on), or, if this push really must go out now,',
  '  run it again with PTCTB_BUILD_BUDGET=off. How builds are counted: tools/lib/build-budget.mjs.',
].join('\n'));
process.exit(1);
