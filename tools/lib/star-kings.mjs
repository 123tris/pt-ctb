import { MODE } from '../../assets/js/core/model.js';

/**
 * Count the current PT #1 on each map, using the same ordered boards as the map pages.
 * Split by native mode (including loved/unranked in each), using unrounded nomod catch stars.
 * 10★ and above share one range. Equal totals share the title; empty ranges have no king.
 * Unknown convert difficulty is omitted.
 * Each range's `board` is everyone with a #1 there, [[playerId, count]], most first (then by id); the page ranks ties
 * together (model.js sharedRanks).
 */
export function starKings(boards, beatmaps) {
  const counts = { catch: new Map(), converts: new Map() };
  for (const [id, board] of boards) {
    const raw = beatmaps.get(id);
    const mode = Number(raw?.playmode);
    const source = mode === MODE.CATCH ? 'catch' : mode === MODE.OSU ? 'converts' : null;
    const stars = raw?.difficultyrating;
    if (!source || !board.entries.length || !Number.isFinite(stars) || stars < 0 ||
        (source === 'converts' && raw.catch_difficulty !== true)) continue;
    const band = Math.min(10, Math.floor(stars));
    if (!counts[source].has(band)) counts[source].set(band, new Map());
    const players = counts[source].get(band);
    const winner = board.entries[0][0];
    players.set(winner, (players.get(winner) || 0) + 1);
  }
  return Object.fromEntries(Object.entries(counts).map(([source, bands]) => [source,
    [...bands].sort(([a], [b]) => a - b).map(([stars, counts]) => {
      const board = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      const count = board[0][1];
      return { stars, count, players: board.filter(([, n]) => n === count).map(([id]) => id), board };
    }),
  ]));
}
