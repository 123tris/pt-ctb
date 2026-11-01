// The site moved from GitHub Pages to CONFIG.production. Loaded before app.js: with CONFIG.leaveGithub on, the old
// github.io copy goes to the same page (the #/… route) on the release site, never the development one. Old links that
// still carry ?me=… (the hand-picked "you" the site no longer has) lose it.

import { CONFIG } from './config.js';

if (CONFIG.leaveGithub && CONFIG.production && location.hostname.endsWith('github.io')) {
  const to = new URL(CONFIG.production);
  to.hash = location.hash;
  location.replace(to);
} else if (new URLSearchParams(location.search).has('me')) {
  history.replaceState(null, '', location.pathname + location.hash);
}
