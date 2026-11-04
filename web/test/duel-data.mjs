// Made-up duels for the view tests (challenges, player, duel), in exactly the shapes the exporter writes: the bot's
// Duels/ files as tools/lib/duels.mjs reads them, run through its own duelsBlock(). Exports from before duels have
// none, and the bot hasn't played any yet. `ids` are players on the site (the core pack's); OFF is someone it doesn't
// list, which a duel can still name.

import { duelsBlock } from '../../tools/lib/duels.mjs';

export const OFF = 999000111;
/** A map with details in duels.json (the rest have none, as for a map the export doesn't know). */
export const MAP = 4242;
export const MAP_TUPLE = ['Artist', 'A <Title>', 'Insane', 1234, 5.55, 9, 4, 8, 5, 180, 200, 900, 1, 2, 'Mapper', null, null];

const iso = t => new Date(t * 1000).toISOString();

/** { block, a, b, c, d }: duelsBlock()'s result, and the four players on the site it uses. */
export function duelData(ids, now) {
  const [a, b, c, d] = ids;
  const at = hours => iso(now - hours * 3600);
  const side = (u, points, before, after, rd = 90) => ({
    osuId: u, name: u === OFF ? 'Ghost <Duelist>' : `p${u}`, points, discordId: '209017408016318464',
    ...(before !== undefined ? { ratingBefore: before, ratingAfter: after, rdAfter: rd } : {}),
  });
  const score = (u, s, extra = {}) => ({ osuId: u, score: s, acc: 97.456, combo: 500, misses: 2, passed: true, ...extra });
  const round = (n, winner, x, y, extra = {}) => ({
    n, beatmapId: n === 1 ? MAP : 1000 + n, stars: 6.123, winner, void: null,
    scores: [score(x, winner === x ? 900000 : 800000), score(y, winner === y ? 900000 : 800000)], ...extra,
  });
  const matches = [];
  // 24 ordinary duels between a and b, every other one unranked, oldest first.
  for (let i = 1; i <= 24; i++) {
    const ranked = i % 2 === 0, aWins = i % 3 !== 0;
    matches.push({
      id: i, code: `AB${i}`, ranked, bestOf: 5, status: 'finished', startedAt: at(200 - i), endedAt: at(199.5 - i), matchId: 118000000 + i,
      stars: { min: 5.9, max: 6.9 }, wager: i === 2 ? 50 : null, winner: aWins ? a : b,
      players: ranked ? [side(a, aWins ? 3 : 1, 1500, aWins ? 1512 : 1488), side(b, aWins ? 1 : 3, 1500, aWins ? 1488 : 1512)] : [side(a, aWins ? 3 : 1), side(b, aWins ? 1 : 3)],
      rounds: [round(1, a, a, b), round(2, b, a, b), round(3, aWins ? a : b, a, b), round(4, aWins ? a : b, a, b)],
    });
  }
  // A ranked forfeit (b won), an abandoned ranked duel, an unranked one with c.
  matches.push({ id: 25, code: null, ranked: true, bestOf: 3, status: 'forfeit', startedAt: at(20), endedAt: at(19), matchId: null, stars: null, wager: null, winner: b,
    players: [side(a, 0, 1530, 1521), side(b, 1, 1470, 1479)], rounds: [round(1, b, a, b)] });
  matches.push({ id: 26, code: 'AB26', ranked: true, bestOf: 5, status: 'abandoned', startedAt: at(10), endedAt: at(9), matchId: 118000026, stars: { min: 6, max: 7 }, wager: 20, winner: a,
    players: [side(a, 1, 1521, 1521), side(c, 1, 1700, 1700)], rounds: [round(1, a, a, c), round(2, c, a, c)] });
  matches.push({ id: 27, code: 'AB27', ranked: false, bestOf: null, status: 'forfeit', startedAt: at(8), endedAt: at(7.5), matchId: 118000027, stars: null, wager: null, winner: c,
    players: [side(c, 2), side(d, 0)], rounds: [] });
  // Ranked, against someone the site doesn't list, with every void reason, a tie, a missing score and a fail.
  matches.push({
    id: 128, code: 'GH128', ranked: true, bestOf: 7, status: 'finished', startedAt: at(5), endedAt: at(4), matchId: 118000128, stars: { min: 6.12, max: 7.345 }, wager: 100, winner: a,
    players: [side(a, 4, 1521, 1533.6, 80), side(OFF, 2, 1550, 1538.4, 60)],
    rounds: [
      round(1, a, a, OFF), round(2, OFF, a, OFF), round(3, a, a, OFF),
      { n: 4, beatmapId: 1004, stars: 6.5, winner: null, void: 'wrong-map', scores: [score(a, 1), score(OFF, 2)] },
      { n: 5, beatmapId: 1005, stars: 6.5, winner: null, void: 'WrongMode', scores: [] },
      { n: 6, beatmapId: 1006, stars: 6.5, winner: null, void: 'not_score_v2', scores: [score(a, 1)] },
      { n: 7, beatmapId: 1007, stars: 6.5, winner: null, void: 'Mods', scores: [score(a, 1)] },
      { n: 8, beatmapId: 1008, stars: 6.5, winner: null, void: 'missing player', scores: [score(a, 1)] },
      { n: 9, beatmapId: 1009, stars: 6.5, winner: null, void: 'Lobby <crashed>', scores: [score(a, 1)] },
      { n: 10, beatmapId: 1010, stars: null, winner: null, void: null, scores: [score(a, 0, { passed: false, acc: null }), score(OFF, 0, { passed: false, misses: 0 })] },
      round(11, OFF, a, OFF), round(12, a, a, OFF), { n: 13, beatmapId: 1013, stars: 6.4, winner: a, void: null, scores: [score(a, 700000)] },
      round(14, a, a, OFF),
    ],
  });
  const ratings = {
    [a]: { name: `p${a}`, r: 1533.6, rd: 80, w: 14, l: 9, streak: 2, peak: 1560.2, lastAt: at(4) },
    [b]: { name: `p${b}`, r: 1479, rd: 95, w: 9, l: 14, streak: -1, peak: 1520, lastAt: at(19) },
    [c]: { name: `p${c}`, r: 1700, rd: 200, w: 2, l: 0, streak: 2, peak: 1700, lastAt: null },
    [d]: { name: `p${d}`, r: 1500, rd: 350, w: 0, l: 0 },
    [OFF]: { name: 'Ghost <Duelist>', r: 1538.4, rd: 60, w: 3, l: 1, streak: -1, peak: 1550, lastAt: at(4) },
  };
  // Enough rated players for the ladder's second page.
  for (const [i, u] of ids.slice(4, 60).entries()) ratings[u] = { name: `p${u}`, r: 1300 + i * 3.3, rd: 70, w: 1 + (i % 4), l: i % 3, streak: (i % 5) - 2, peak: 1500, lastAt: at(24 * i) };
  const active = [
    { id: 300, code: 'LIVE', ranked: true, bestOf: 5, startedAt: at(0.5), matchId: 120000001, players: [{ osuId: a, name: `p${a}`, points: 2 }, { osuId: b, name: `p${b}`, points: 1 }] },
    { id: 301, code: null, ranked: false, bestOf: null, startedAt: null, matchId: null, players: [{ osuId: OFF, name: 'Ghost <Duelist>', points: 0 }, { osuId: c, name: `p${c}`, points: 0 }] },
  ];
  const block = duelsBlock({ ratings, matches, active }, () => true);
  block.file.maps[MAP] = MAP_TUPLE;
  for (const page of Object.values(block.pages)) if (MAP in page.maps) page.maps[MAP] = MAP_TUPLE;
  return { block, a, b, c, d };
}
