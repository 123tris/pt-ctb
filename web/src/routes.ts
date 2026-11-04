// The pages the new client draws, and the data each one's first view needs: what the edge puts in the page
// (edge/inline.ts), so the browser fetches it while it reads the page. Every other page is the old app's. A page's
// entry (entries/) decides the rest, such as a tab that isn't ported yet.

/** What a page's first view loads: packs (packs.json names) and JSON files (meta.json names). */
export interface First {
  packs: string[];
  json: string[];
}

/** The pack with every player and board, which nearly every page needs (names, avatars, colours). */
export const CORE = 'packs/core.ptcb';

/** The Leaderboards tabs the old page still draws: they need data that isn't in packs yet. */
const OLD_BOARDS = new Set(['mods', 'plays', 'kings']);

/** A player's pack, all their plays and the maps they're on. */
export const playerPack = (id: number | string) => `packs/player/${id}.ptcb`;

/** The map bucket a map's details and board are in (assets/js/core/data.js mapEntry). */
export const mapBucket = (id: number) => `maps/${id % 128}.json`;

/**
 * Each ported page: its address (as assets/js/core/routes.js writes it, as a pattern) and its first data, from the
 * match and the address's query.
 */
const ROUTES: { pattern: RegExp; first: (m: RegExpMatchArray, query: URLSearchParams) => First | null }[] = [
  { pattern: /^rankings(?:\/([^/]*))?$/, first: m => (OLD_BOARDS.has(m[1]) ? null : { packs: [CORE], json: [] }) },
  {
    pattern: /^calculator$/,
    first: (_, query) => ({ packs: [CORE], json: Number(query.get('map')) > 0 ? [mapBucket(Number(query.get('map')))] : [] }),
  },
  {
    pattern: /^compare(?:\/(\d+))?(?:\/(\d+))?$/,
    first: m => ({ packs: [CORE, ...(m[1] && m[2] ? [playerPack(m[1]), playerPack(m[2])] : [])], json: [] }),
  },
];

/** The data a page address's first view needs, or null for a page the new client doesn't draw. */
export function firstData(pathname: string, search = ''): First | null {
  const path = pathname.replace(/^\/+|\/+$/g, '');
  for (const route of ROUTES) {
    const m = path.match(route.pattern);
    if (m) return route.first(m, new URLSearchParams(search));
  }
  return null;
}
