// The Top 10 season's dates (TOP10-DESIGN.md §13.1, in the bot's repo). All times are UTC; Lisbon is UTC+0 in winter,
// so 23:59:59Z on 31 December is also 23:59:59 in Lisbon.
//
// The env var TOP10_SEASON (JSON with the same fields) replaces the built-in season, so dev.ptcatch.com can run a
// mock season before December, e.g.
//   {"year":2026,"opens":"2026-11-20T00:00:00Z","closes":"2026-11-26T23:59:59Z","reveal":"2026-11-28T12:00:00Z","thanksUntil":"2026-11-30T23:59:59Z"}
// A value that doesn't parse, misses a field or has the dates out of order is ignored (with a warning in the log), and
// the built-in season stays.
//
// The phase is derived from the time: before → open (opens ≤ now ≤ closes) → closed → revealed (reveal ≤ now).
//
// The score showcase has a window of its own (§4.1): from showcaseOpens to closes, so players can add their best scores
// before voting starts. showcaseOpens is optional (left out, it's `opens`) and never after `opens`. Adding to the
// showcase follows this window; ballots, write-ups, thanks and finalize follow voting's.

export const SEASON = Object.freeze({
  year: 2026,
  showcaseOpens: '2026-11-08T00:00:00Z',
  opens: '2026-12-01T00:00:00Z',
  closes: '2026-12-31T23:59:59Z',
  reveal: '2027-01-02T12:00:00Z',
  thanksUntil: '2027-01-31T23:59:59Z',
});

const TIMES = ['opens', 'closes', 'reveal', 'thanksUntil'];
const iso = t => new Date(t * 1000).toISOString().replace('.000Z', 'Z');
const seconds = v => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};

/**
 * A season as the code uses it: the fields (times as ISO strings, normalised; showcaseOpens filled in from opens when
 * it's left out) and `at`, the same times in unix seconds. Null when anything is missing or out of order
 * (showcaseOpens ≤ opens < closes < reveal ≤ thanksUntil).
 */
export function normalizeSeason(value) {
  if (!value || typeof value !== 'object') return null;
  const year = value.year;
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2100) return null;
  const at = {};
  for (const field of TIMES) {
    at[field] = seconds(value[field]);
    if (at[field] === null) return null;
  }
  const given = value.showcaseOpens !== undefined && value.showcaseOpens !== null;
  at.showcaseOpens = given ? seconds(value.showcaseOpens) : at.opens;
  if (at.showcaseOpens === null) return null;
  if (!(at.showcaseOpens <= at.opens && at.opens < at.closes && at.closes < at.reveal && at.reveal <= at.thanksUntil)) return null;
  return { year, showcaseOpens: iso(at.showcaseOpens), ...Object.fromEntries(TIMES.map(f => [f, iso(at[f])])), at };
}

/** The season in force: TOP10_SEASON when it's set and valid, otherwise SEASON. */
export function seasonOf(env) {
  const raw = env?.TOP10_SEASON;
  if (raw) {
    let parsed = null;
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { /* reported below */ }
    const season = normalizeSeason(parsed);
    if (season) return season;
    console.warn('TOP10_SEASON is not a valid season (year, showcaseOpens?, opens, closes, reveal, thanksUntil in order); using the built-in one.');
  }
  return normalizeSeason(SEASON);
}

/** 'before' | 'open' | 'closed' | 'revealed' at `now` (unix seconds). */
export function phaseOf(season, now) {
  if (now < season.at.opens) return 'before';
  if (now <= season.at.closes) return 'open';
  if (now < season.at.reveal) return 'closed';
  return 'revealed';
}

/** The showcase's window at `now`: 'before' | 'open' (showcaseOpens ≤ now ≤ closes) | 'closed'. */
export function showcaseOf(season, now) {
  if (now < season.at.showcaseOpens) return 'before';
  return now <= season.at.closes ? 'open' : 'closed';
}

/** What the API shows: { year, showcaseOpens, opens, closes, reveal, thanksUntil, phase, showcase }. */
export const seasonView = (season, now) => ({
  year: season.year, showcaseOpens: season.showcaseOpens, opens: season.opens, closes: season.closes, reveal: season.reveal,
  thanksUntil: season.thanksUntil, phase: phaseOf(season, now), showcase: showcaseOf(season, now),
});
