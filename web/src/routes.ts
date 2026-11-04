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

/** The pack with every map with Portuguese plays: the Maps page's list and search. */
export const SEARCH = 'packs/search.ptcb';

/** The Leaderboards tabs that add a JSON file to the core pack (the others are the core pack alone). */
const BOARD_JSON: Record<string, string> = { mods: 'modrankings.json', plays: 'topplays.json', kings: 'records.json' };

/** What the home page shows beyond the players: a small JSON file the engine writes with the packs. */
export const HOME = 'packs/home.json';

/** A player's pack, all their plays and the maps they're on. */
export const playerPack = (id: number | string) => `packs/player/${id}.ptcb`;

/** The map bucket a map's details and board are in (assets/js/core/data.js mapEntry). */
export const mapBucket = (id: number) => `maps/${id % 128}.json`;

/** The Challenges tabs that add a JSON file of their own to challenges.json and bounties.json. */
const TAB_JSON: Record<string, string> = { dan: 'dan.json', hill: 'hill.json', bounties: 'economy.json', completion: 'completion.json' };

/** The JSON a Challenges tab's first view needs (an unknown tab shows the week). */
const challengesJson = (tab: string | undefined) =>
  ['challenges.json', 'bounties.json', ...(tab && Object.hasOwn(TAB_JSON, tab) ? [TAB_JSON[tab]] : [])];

/**
 * Each ported page: its address (as assets/js/core/routes.js writes it, as a pattern) and its first data, from the
 * match and the address's query.
 */
const ROUTES: { pattern: RegExp; first: (m: RegExpMatchArray, query: URLSearchParams) => First | null }[] = [
  { pattern: /^$/, first: () => ({ packs: [CORE, HOME], json: [] }) },
  { pattern: /^rankings(?:\/([^/]*))?$/, first: m => ({ packs: [CORE], json: BOARD_JSON[m[1]] ? [BOARD_JSON[m[1]]] : [] }) },
  {
    pattern: /^calculator$/,
    first: (_, query) => ({ packs: [CORE], json: Number(query.get('map')) > 0 ? [mapBucket(Number(query.get('map')))] : [] }),
  },
  {
    pattern: /^compare(?:\/(\d+))?(?:\/(\d+))?$/,
    first: m => ({ packs: [CORE, ...(m[1] && m[2] ? [playerPack(m[1]), playerPack(m[2])] : [])], json: [] }),
  },
  { pattern: /^players$/, first: () => ({ packs: [CORE], json: [] }) },
  // maps-top.json for a first visit's first page, which needn't wait for the search pack (entries/maps.ts).
  { pattern: /^maps$/, first: () => ({ packs: [CORE, SEARCH], json: ['maps-top.json'] }) },
  { pattern: /^activity$/, first: () => ({ packs: [CORE], json: ['activity.json', 'challenges.json'] }) },
  { pattern: /^records$/, first: () => ({ packs: [CORE], json: ['records.json', 'economy.json'] }) },
  // The bot's list; an export without one shows the hand-written list.
  { pattern: /^commands$/, first: () => ({ packs: [], json: ['commands.json'] }) },
  // Text only: nothing to fetch, so nothing for the edge to add.
  { pattern: /^(?:glossary|privacy|join|team)$/, first: () => ({ packs: [], json: [] }) },
  // A profile, every tab: the players and the player's head file (their whole file comes when a list needs it).
  // bounties.json and economy.json too, which the profile also reads, so it needn't wait for meta.json for them.
  { pattern: /^player\/(\d+)(?:\/([^/]*))?$/, first: m => ({ packs: [CORE], json: [`players/${m[1]}-head.json`, 'bounties.json', 'economy.json'] }) },
  // A map: the players, the map's bucket with its details and board, and the open bounties (the set's file comes once
  // the bucket names it).
  { pattern: /^map\/(\d+)$/, first: m => ({ packs: [CORE], json: [mapBucket(Number(m[1])), 'bounties.json'] }) },
  // Challenges, every tab: the players, challenges.json and bounties.json (the tabs' figures and chips), and the tab's
  // own file. A file the data doesn't have yet (hill.json, economy.json) is in the slice as missing, so the page needn't
  // ask meta.json. /dan is the Dan tab's old address, which the old router moves there.
  { pattern: /^challenges(?:\/([^/]*))?$/, first: m => ({ packs: [CORE], json: challengesJson(m[1]) }) },
  { pattern: /^dan$/, first: () => ({ packs: [CORE], json: challengesJson('dan') }) },
  // The games: Guess the map (daily or practice; old /games/daily links too) from quiz.json, which the paying daily
  // doesn't need but a visitor signed out does; the map quizzes from the header search's maps (search-maps.json, less
  // than half the search pack, and often cached by the search already); the hub (and any other address under /games)
  // and Higher or lower draw players.
  {
    pattern: /^games(?:\/([^/]*))?$/,
    first: m => (m[1] === 'guess' || m[1] === 'daily' ? { packs: [], json: ['quiz.json'] }
      : m[1] === 'quiz' ? { packs: [], json: ['search-maps.json'] } : { packs: [CORE], json: [] }),
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
