// The Top 10 results and payouts (TOP10-DESIGN.md §5, §13.5 and §13.6). Pure: the store reads the ballots, this
// counts them, and finalize saves what comes out.
//
// Points: a pick at position p (1–10) gets 11 − p. A group tied at spot s with k members covers positions s … s+k−1,
// and each member gets the average of those positions' points (positions above 10 give 0). A player's score is their
// points ÷ the ballots that could have listed them: every counted ballot except their own, since nobody can vote for
// themselves. Order: score, then lists, then #1s, then the median spot (lower first), then honourable mentions; players
// still equal share the rank.

export const POSITIONS = 10;
export const MIN_PICKS = 5;
export const MAX_PICKS = 10;
export const MIN_BALLOTS = 5;
export const FULL_WORDS = 40;

const round2 = n => Math.round(n * 100) / 100;

/** The points for position p: 10 for #1 … 1 for #10, 0 below. */
export const positionPoints = p => (p >= 1 && p <= POSITIONS ? POSITIONS + 1 - p : 0);

/** What each member of a group of `size` tied at `spot` gets: the average points of the positions it covers. */
export function spotPoints(spot, size = 1) {
  let sum = 0;
  for (let p = spot; p < spot + size; p++) sum += positionPoints(p);
  return sum / size;
}

/**
 * Whether a list's spots follow the rule: they start at 1 and never go down; a tie repeats the spot above, and the
 * next spot skips the places the tie covered (1, 2, 3, 3, 5). So the i-th pick (from 0) is at i + 1 or tied with the
 * one above. An empty list passes (a draft).
 */
export const spotsValid = picks => picks.every((p, i) => (i === 0 ? p.spot === 1 : p.spot === i + 1 || p.spot === picks[i - 1].spot));

/** Each pick's points on one list: Map id → { spot, points }. */
export function listPoints(picks) {
  const size = new Map();
  for (const p of picks) size.set(p.spot, (size.get(p.spot) ?? 0) + 1);
  return new Map(picks.map(p => [p.id, { spot: p.spot, points: spotPoints(p.spot, size.get(p.spot)) }]));
}

const median = sorted => (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

/**
 * The results JSON (§13.5) from the counted ballots, [{ voter, picks: [{ id, spot }], mentions: [id], watch: [id] }],
 * and the write-ups to count in the stats, [{ voter, subject, words }] (the caller passes the ones that aren't struck).
 * Returns { results } or { error: 'turnout', ballots } below `minBallots` counted ballots (MIN_BALLOTS for a season;
 * past editions imported from the forum threads pass 1, since 2020 had a single list, top10/past.js).
 */
export function computeResults({ year, ballots, writeups = [], finalizedAt, minBallots = MIN_BALLOTS }) {
  if (ballots.length < Math.max(1, minBallots)) return { error: 'turnout', ballots: ballots.length };
  const voters = new Set(ballots.map(b => b.voter));
  const players = new Map();
  const entry = id => {
    if (!players.has(id)) players.set(id, { id, points: 0, lists: 0, firsts: 0, spots: [], positions: Array(POSITIONS).fill(0), mentions: 0, watch: 0 });
    return players.get(id);
  };
  const mentions = new Map();
  const watch = new Map();
  for (const b of ballots) {
    for (const [id, { spot, points }] of listPoints(b.picks)) {
      const e = entry(id);
      e.points += points;
      e.lists++;
      e.spots.push(spot);
      if (spot === 1) e.firsts++;
      if (spot >= 1 && spot <= POSITIONS) e.positions[spot - 1]++;
    }
    for (const id of new Set(b.mentions ?? [])) mentions.set(id, (mentions.get(id) ?? 0) + 1);
    for (const id of new Set(b.watch ?? [])) watch.set(id, (watch.get(id) ?? 0) + 1);
  }
  const ranked = [...players.values()].filter(e => e.points > 0).map(e => {
    const eligible = ballots.length - (voters.has(e.id) ? 1 : 0);
    const spots = e.spots.sort((a, b) => a - b);
    return {
      ...e, eligible, cents: Math.round((e.points / eligible) * 100), median: median(spots),
      mentions: mentions.get(e.id) ?? 0, watch: watch.get(e.id) ?? 0,
    };
  });
  const order = (a, b) => b.cents - a.cents || b.lists - a.lists || b.firsts - a.firsts || a.median - b.median || b.mentions - a.mentions;
  ranked.sort((a, b) => order(a, b) || a.id - b.id);
  const ranking = ranked.map(e => ({
    id: e.id,
    rank: 0,
    score: e.cents / 100,
    points: round2(e.points),
    lists: e.lists,
    eligible: e.eligible,
    firsts: e.firsts,
    positions: e.positions,
    best: e.spots[0],
    worst: e.spots[e.spots.length - 1],
    mentions: e.mentions,
    watch: e.watch,
  }));
  for (let i = 0; i < ranking.length; i++) ranking[i].rank = i > 0 && order(ranked[i - 1], ranked[i]) === 0 ? ranking[i - 1].rank : i + 1;
  const counts = map => [...map].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id - b.id);
  const written = writeups.filter(w => w.words > 0 && voters.has(w.voter));
  return {
    results: {
      year,
      ballots: ballots.length,
      finalizedAt,
      ranking,
      mentions: counts(mentions),
      watch: counts(watch),
      stats: { writeups: written.length, words: written.reduce((n, w) => n + w.words, 0), subjects: new Set(written.map(w => w.subject)).size },
    },
  };
}

/**
 * The requests finalize queues for the bot (§13.6), in order: one `top10.payout` per counted ballot, then one
 * `top10.thanks` per thanks so far on an approved write-up.
 *
 * - `ballots`: the counted ballots, [{ voter, picks }].
 * - `writeups`: every write-up on them, [{ voter, subject, words, flags: [...], mod: 'ok' | 'struck' }].
 * - `thanks`: [{ subject, voter }], the subject thanking the voter's write-up about them.
 *
 * A payout lists the approved, unflagged write-ups on picks (in list order). A struck write-up anywhere on the ballot
 * costs the ballot all its write-up bananas (§3.3 rule 4, §8): its payout then lists none, and allFull is false; the
 * ballot's own 20 stays. allFull: every pick has an approved, unflagged write-up of FULL_WORDS or more.
 * Returns [{ osuId, type, payload }].
 */
export function payoutsFor({ year, ballots, writeups, thanks = [] }) {
  const byVoter = new Map();
  for (const w of writeups) {
    if (!byVoter.has(w.voter)) byVoter.set(w.voter, new Map());
    byVoter.get(w.voter).set(w.subject, w);
  }
  const counted = new Set(ballots.map(b => b.voter));
  const payouts = ballots.map(b => {
    const mine = byVoter.get(b.voter) ?? new Map();
    const struck = [...mine.values()].some(w => w.mod === 'struck');
    const paid = struck ? [] : b.picks.map(p => mine.get(p.id)).filter(w => w && w.mod === 'ok' && !w.flags.length && w.words > 0)
      .map(w => ({ subject: w.subject, words: w.words }));
    const allFull = !struck && b.picks.length > 0 && b.picks.every(p => paid.some(w => w.subject === p.id && w.words >= FULL_WORDS));
    return { osuId: b.voter, type: 'top10.payout', payload: { year, ballot: true, writeups: paid, allFull } };
  });
  const thanked = thanks.filter(t => counted.has(t.voter) && byVoter.get(t.voter)?.get(t.subject)?.mod === 'ok')
    .sort((a, b) => a.voter - b.voter || a.subject - b.subject)
    .map(t => ({ osuId: t.voter, type: 'top10.thanks', payload: { year, subject: t.subject } }));
  return [...payouts, ...thanked];
}
