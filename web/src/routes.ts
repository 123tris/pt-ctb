// The pages the new client draws, and the packs each one's first view needs: what the edge puts in the page
// (edge/inline.ts) and what the client entry checks before drawing. Every other page is the old app's.

/** The Leaderboards tabs the old page still draws: they need data that isn't in packs yet. */
const OLD_BOARDS = new Set(['mods', 'plays', 'kings']);

/** The packs a page address's first view needs, or null for a page the new client doesn't draw. */
export function firstPacks(pathname: string): string[] | null {
  const [section, sub] = pathname.replace(/^\/+/, '').split('/');
  if (section === 'rankings' && !OLD_BOARDS.has(sub)) return ['packs/core.ptcb'];
  return null;
}
