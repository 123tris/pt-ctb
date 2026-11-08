// The Top 10 season's dates (TOP10-DESIGN.md §13.1, in the bot's repo). All times are UTC; Lisbon is UTC+0 in winter,
// so 23:59:59Z on 31 December is also 23:59:59 in Lisbon.
//
// The env var TOP10_SEASON (JSON with the same five fields) replaces the built-in season, so dev.ptcatch.com can run a
// mock season before December, e.g.
//   {"year":2026,"opens":"2026-11-20T00:00:00Z","closes":"2026-11-26T23:59:59Z","reveal":"2026-11-28T12:00:00Z","thanksUntil":"2026-11-30T23:59:59Z"}
// A value that doesn't parse, misses a field or has the dates out of order is ignored (with a warning in the log), and
// the built-in season stays.
//
// The phase is derived from the time: before → open (opens ≤ now ≤ closes) → closed → revealed (reveal ≤ now).

export const SEASON = Object.freeze({
  year: 2026,
  opens: '2026-12-01T00:00:00Z',
  closes: '2026-12-31T23:59:59Z',
  reveal: '2027-01-02T12:00:00Z',
  thanksUntil: '2027-01-31T23:59:59Z',
});

const TIMES = ['opens', 'closes', 'reveal', 'thanksUntil'];
const iso = t => new Date(t * 1000).toISOString().replace('.000Z', 'Z');

/**
 * A season as the code uses it: the five fields (times as ISO strings, normalised) and `at`, the same times in unix
 * seconds. Null when anything is missing or out of order (opens < closes < reveal ≤ thanksUntil).
 */
export function normalizeSeason(value) {
  if (!value || typeof value !== 'object') return null;
  const year = value.year;
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2100) return null;
  const at = {};
  for (const field of TIMES) {
    const t = typeof value[field] === 'string' ? Date.parse(value[field]) : NaN;
    if (!Number.isFinite(t)) return null;
    at[field] = Math.floor(t / 1000);
  }
  if (!(at.opens < at.closes && at.closes < at.reveal && at.reveal <= at.thanksUntil)) return null;
  return { year, ...Object.fromEntries(TIMES.map(f => [f, iso(at[f])])), at };
}

/** The season in force: TOP10_SEASON when it's set and valid, otherwise SEASON. */
export function seasonOf(env) {
  const raw = env?.TOP10_SEASON;
  if (raw) {
    let parsed = null;
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { /* reported below */ }
    const season = normalizeSeason(parsed);
    if (season) return season;
    console.warn('TOP10_SEASON is not a valid season (year, opens, closes, reveal, thanksUntil in order); using the built-in one.');
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

/** What the API shows: { year, opens, closes, reveal, thanksUntil, phase }. */
export const seasonView = (season, now) => ({
  year: season.year, opens: season.opens, closes: season.closes, reveal: season.reveal, thanksUntil: season.thanksUntil,
  phase: phaseOf(season, now),
});
