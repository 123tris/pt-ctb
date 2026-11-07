// The router's page table and the pure rules around it, as assets/js/app.js has them: which module draws each page
// address, which route params only pick a view within a page, and what the usage counts call a page. No DOM here, so
// the app (app.ts), tools/build-site.mjs (each page's modules, preloaded from index.html) and the tests share it.
// The addresses themselves are assets/js/core/routes.js's, which the edge and the link previews read too.

import { matchPage, unmoved, PAGES as PATTERNS } from '../../assets/js/core/routes.js';

export type Params = Record<string, string | undefined>;
export type Query = Record<string, string | undefined>;

/** A page address matched: its pattern in routes.js and the params read from the path. */
export interface Found {
  pattern: string;
  params: Params;
}

/**
 * Each page in routes.js and its modules: the new client's entry (web/src/entries/<entry>.ts, assets/web/<entry>.js)
 * and the old page that stands in where that can't load (assets/js/pages/<old>.js; the github.io copy, served from
 * the repo, has no assets/web). app.ts loads the entries; build-site.mjs preloads a page's from index.html.
 */
export const PAGE_MODULES: Readonly<Record<string, { entry: string; old: string }>> = {
  '': { entry: 'home', old: 'home' },
  'rankings/:board?': { entry: 'rankings', old: 'rankings' },
  'players': { entry: 'players', old: 'players' },
  'player/:id/:tab?': { entry: 'player', old: 'player' },
  'maps': { entry: 'maps', old: 'maps' },
  'map/:id': { entry: 'map', old: 'map' },
  'activity': { entry: 'activity', old: 'activity' },
  'challenges/:tab?': { entry: 'challenges', old: 'challenges' },
  'duel/:id': { entry: 'duel', old: 'duel' },
  'games/:game?': { entry: 'games', old: 'games' },
  'calculator': { entry: 'calculator', old: 'calculator' },
  'compare/:a?/:b?': { entry: 'compare', old: 'compare' },
  'records': { entry: 'records', old: 'records' },
  'shop': { entry: 'shop', old: 'shop' },
  'admin': { entry: 'admin', old: 'admin' },
  'recap/:id/:year?': { entry: 'recap', old: 'wrapped' },
  'commands': { entry: 'commands', old: 'commands' },
  'join': { entry: 'join', old: 'join' },
  'team': { entry: 'team', old: 'team' },
  'glossary': { entry: 'glossary', old: 'glossary' },
  'privacy': { entry: 'privacy', old: 'privacy' },
  // Top 10 of the year: no old page (the old app shows its error page there).
  'top10/:view?/:id?/:year?': { entry: 'top10', old: 'top10' },
};

// Every address routes.js knows has its modules here, and nothing else: a page added there and not here would match
// and then have nothing to draw it.
for (const pattern of PATTERNS) if (!PAGE_MODULES[pattern]) throw new Error(`pages.ts: no modules for the page ${pattern}`);

/** The page a path (no leading slash, no query) shows, or null when the site has no such page. */
export const match = (path: string): Found | null => matchPage(path) as Found | null;

/** The path with a moved first part replaced ('dan/x' → 'challenges/dan/x'), or the path itself. */
export const moved = (path: string): string => unmoved(path);

/**
 * Route params that only pick a view within a page: a profile's score list, a leaderboard, a challenge. Changing one
 * keeps the page where it is: no scroll to the top, the old view (dimmed if the new one takes a moment) instead of the
 * loader, and focus back on the tab that was picked. The profile redraws just its list (views/player.mount.ts); the
 * others redraw the page.
 */
export const SUB_VIEWS: Readonly<Record<string, string>> = { 'player/:id/:tab?': 'tab', 'rankings/:board?': 'board', 'challenges/:tab?': 'tab' };

/** Which page an address's path shows, the same for two paths that differ only in a sub-view. */
export function pageOf(pathname: string | null | undefined): string {
  const path = unmoved((pathname ?? '').replace(/^\/+/, ''));
  const found = match(path);
  const sub = found && SUB_VIEWS[found.pattern];
  if (!sub) return path;
  const { [sub]: _, ...rest } = found.params;
  return `${found.pattern} ${JSON.stringify(rest)}`;
}

// Route parts that are ids, left out of the usage key so "which pages get used" doesn't split by player or map.
const ID_PARAMS = new Set(['id', 'a', 'b', 'year']);

/** The page's name for the usage counts: the route without ids, plus a sub-view kept in the query (?view, ?mode). */
export function pageKey(found: Found, path: string, query: Query): string {
  const parts = path.split('/').filter(Boolean);
  const keys = found.pattern.split('/').filter(Boolean);
  const name = keys.map((k, i) => (!k.startsWith(':') ? k : ID_PARAMS.has(k.slice(1).replace('?', '')) ? '' : parts[i] ?? ''))
    .filter(Boolean).join('/') || 'home';
  if (found.pattern.startsWith('compare')) return `${name}${found.params.b ? '/pair' : found.params.a ? '/one' : ''}`;
  const extra = query.view || query.mode;
  return extra ? `${name}/${extra}` : name;
}

/** What a page is about, for the usage counts: p123 a player, m456 a map, p1|p2 a comparison (client/track.ts). */
export function pageObject(found: Found): string {
  const { id, a, b } = found.params;
  const n = (v: string | undefined) => /^\d{1,10}$/.test(v ?? '');
  if (/^(player|recap)\//.test(found.pattern) && n(id)) return `p${id}`;
  if (found.pattern.startsWith('map/') && n(id)) return `m${id}`;
  if (found.pattern.startsWith('compare') && n(a)) return n(b) ? `p${a}|p${b}` : `p${a}`;
  return '';
}
