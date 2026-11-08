// The site moved from GitHub Pages to CONFIG.production, as assets/js/moved.js has it, run first thing by the app:
// with CONFIG.leaveGithub on, the old github.io copy goes to the same page (its #/… address, which the release site
// turns into the path) on the release site, never the development one. Old links that still carry ?me=… (the
// hand-picked "you" the site no longer has) lose it.
//
// The github.io copy is served from the repo as it is, without the bundle, so it runs moved.js itself (index.html);
// this is for any other copy that is somehow on github.io.

import { CONFIG } from './config.ts';

export function moved(): void {
  if (CONFIG.leaveGithub && CONFIG.production && location.hostname.endsWith('github.io')) {
    const to = new URL(CONFIG.production);
    to.hash = location.hash;
    location.replace(to);
  } else if (new URLSearchParams(location.search).has('me')) {
    history.replaceState(null, '', location.pathname + location.hash);
  }
}
