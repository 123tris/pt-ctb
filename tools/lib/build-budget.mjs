// Cloudflare Pages' free plan allows 500 builds a month, and every push to a branch of this repo is one build (main is
// the release site, dev and any other branch a preview). Builds can't be counted from the dashboard by a script, so
// this counts them from git: each time a remote-tracking branch moved (pushed from any worktree on this PC, or seen
// moving on a fetch), Cloudflare built once. Pushes made from another PC only show up when this one fetches them, and
// then as one build however many there were, so the count can only fall short when someone else pushes often.
//
// The window is the last 31 days rather than the calendar month, so it holds whenever Cloudflare's month starts.
// tools/build-budget.mjs (the pre-push hook in tools/git-hooks/) applies these rules. See notes/free-tier-audit.md.

export const LIMITS = {
  /** Builds in any 31 days, all branches: past this nothing is pushed (Cloudflare's cap is 500). */
  total: 450,
  /** Builds of branches other than main in any 31 days: the rest is kept for releases. */
  preview: 330,
  /** Builds of branches other than main in the last 24 hours: about a 31st of `preview`, so dev can't spend it in days. */
  previewPerDay: 12,
  /** Print a warning once this share of a limit is used. */
  warnAt: 0.7,
};

const DAY = 86400;

/**
 * Parses `git log -g --format=%gD|%gs --date=unix <ref>` output into build times (unix seconds): every entry that
 * moved the ref, except those that only deleted it.
 */
export function parseReflog(text) {
  const times = [];
  for (const line of text.split('\n')) {
    const m = line.match(/@\{(\d+)\}\|(.*)$/);
    if (m && !/delete/i.test(m[2])) times.push(Number(m[1]));
  }
  return times;
}

/** Counts builds in the windows the limits use, from { branch: [unix times] }. */
export function countBuilds(byBranch, now) {
  let total = 0, preview = 0, previewToday = 0;
  for (const [branch, times] of Object.entries(byBranch)) {
    for (const t of times) {
      if (t > now || now - t >= 31 * DAY) continue;
      total++;
      if (branch !== 'main') {
        preview++;
        if (now - t < DAY) previewToday++;
      }
    }
  }
  return { total, preview, previewToday };
}

/**
 * Decides whether pushing `branches` (each one build) fits the budget. Returns { ok, reasons, warnings }: reasons say
 * why not, warnings what is getting close.
 */
export function checkPush(counts, branches, limits = LIMITS) {
  const reasons = [];
  const warnings = [];
  const previews = branches.filter(b => b !== 'main').length;
  const check = (used, adding, limit, what) => {
    if (!adding) return;
    if (used + adding > limit) reasons.push(`${what}: ${used} of ${limit} used, this push adds ${adding}`);
    else if (used + adding >= limit * limits.warnAt) warnings.push(`${what}: ${used + adding} of ${limit} after this push`);
  };
  check(counts.total, branches.length, limits.total, 'Pages builds in the last 31 days (Cloudflare free plan: 500 a month)');
  check(counts.preview, previews, limits.preview, 'preview builds (branches other than main) in the last 31 days');
  check(counts.previewToday, previews, limits.previewPerDay, 'preview builds in the last 24 hours');
  return { ok: reasons.length === 0, reasons, warnings };
}

/** The branches a pre-push hook's stdin updates (deletions and tags build nothing). */
export function pushedBranches(stdin) {
  const branches = [];
  for (const line of stdin.split('\n')) {
    const [, localSha, remoteRef] = line.trim().split(/\s+/);
    if (!remoteRef?.startsWith('refs/heads/') || /^0+$/.test(localSha)) continue;
    branches.push(remoteRef.slice('refs/heads/'.length));
  }
  return branches;
}
