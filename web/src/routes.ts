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

/** Each ported page: its address (as assets/js/core/routes.js writes it, as a pattern) and its first data. */
const ROUTES: { pattern: RegExp; first: (m: RegExpMatchArray) => First | null }[] = [
  { pattern: /^rankings(?:\/([^/]*))?$/, first: m => (OLD_BOARDS.has(m[1]) ? null : { packs: [CORE], json: [] }) },
  { pattern: /^players$/, first: () => ({ packs: [CORE], json: [] }) },
  // The bot's list; an export without one shows the hand-written list.
  { pattern: /^commands$/, first: () => ({ packs: [], json: ['commands.json'] }) },
  // Text only: nothing to fetch, so nothing for the edge to add.
  { pattern: /^(?:glossary|privacy|join|team)$/, first: () => ({ packs: [], json: [] }) },
];

/** The data a page address's first view needs, or null for a page the new client doesn't draw. */
export function firstData(pathname: string): First | null {
  const path = pathname.replace(/^\/+|\/+$/g, '');
  for (const route of ROUTES) {
    const m = path.match(route.pattern);
    if (m) return route.first(m);
  }
  return null;
}
