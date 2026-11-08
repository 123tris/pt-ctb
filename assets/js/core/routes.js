// The site's page addresses: /player/123?tab=x → the pattern 'player/:id/:tab?'. Shared by the router (app.js, which
// pairs each pattern with its page module), the Function that answers page addresses with their link preview
// (functions/[[path]].js, embed/embed.js) and the local server (tools/serve.mjs). No DOM here.

export const PAGES = [
  '',
  'rankings/:board?',
  'players',
  'player/:id/:tab?',
  'maps',
  'map/:id',
  'activity',
  'challenges/:tab?',
  'duel/:id',
  'games/:game?',
  'calculator',
  'compare/:a?/:b?',
  'records',
  'shop',
  'admin',
  'recap/:id/:year?',
  'commands',
  'join',
  'team',
  'glossary',
  'privacy',
  'top10/:view?/:id?/:year?',
];

/** Old addresses that moved: the Dan course is now a tab of Challenges (/dan?stage=3 → /challenges/dan?stage=3). */
export const MOVED = { dan: 'challenges/dan', verify: 'join' };

/** The path with a moved first part replaced ('dan/x' → 'challenges/dan/x'), or the path itself. */
export function unmoved(path) {
  const [first, ...rest] = path.split('/');
  return MOVED[first] ? [MOVED[first], ...rest].join('/') : path;
}

/** The page a path (no leading slash, no query) is: { pattern, params }, or null when there's no such page. */
export function matchPage(path) {
  const parts = path.split('/').filter(Boolean);
  for (const pattern of PAGES) {
    const keys = pattern.split('/').filter(Boolean);
    const params = {};
    let ok = parts.length <= keys.length;
    for (let i = 0; ok && i < keys.length; i++) {
      const key = keys[i];
      if (key.startsWith(':')) {
        const optional = key.endsWith('?');
        if (parts[i] === undefined && !optional) ok = false;
        else if (parts[i] !== undefined) {
          try { params[key.slice(1).replace('?', '')] = decodeURIComponent(parts[i]); } catch { ok = false; }
        }
      } else if (parts[i] !== key) ok = false;
    }
    if (ok) return { pattern, params };
  }
  return null;
}
