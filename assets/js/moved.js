// The site moved from GitHub Pages to CONFIG.production. Loaded before app.js: with CONFIG.leaveGithub on, the old
// github.io copy goes to the same page (the #/… route) on the release site, never the development one. localStorage is per address, so the "This is me" choice comes along once as
// ?me=…, and the new address takes it unless it already has one of its own.

import { CONFIG } from './config.js';
import { prefs } from './core/ui.js';

if (CONFIG.leaveGithub && CONFIG.production && location.hostname.endsWith('github.io')) {
  const to = new URL(CONFIG.production);
  const me = prefs.get('me', null);
  if (me) to.searchParams.set('me', me);
  to.hash = location.hash;
  location.replace(to);
} else if (new URLSearchParams(location.search).has('me')) {
  const me = Number(new URLSearchParams(location.search).get('me'));
  if (Number.isSafeInteger(me) && me > 0 && prefs.get('me', null) === null) prefs.set('me', me);
  history.replaceState(null, '', location.pathname + location.hash);
}
