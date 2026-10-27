// The consent prompt for the usage counts. Off unless CONFIG.analyticsConsent is set ('identity' or 'all', see
// config.js): then a small strip at the bottom of the window asks once, and the answer is kept in this browser
// (ptctb:consent). Not a modal: the site stays usable and saying nothing means no. Browsers that send Do Not Track or
// Global Privacy Control, or opted out, are never asked.

import { html } from './html.js';
import { trackingBlock, setConsent } from './track.js';
import { prefs } from './ui.js';
import { CONFIG } from '../config.js';

const ASK = {
  identity: 'Can we link how you use the site to your osu! player? It helps us see what players like you need.',
  all: 'Can we record how you use the site? It helps us see what to improve. Nothing goes to anyone else.',
};

export function initConsent() {
  const mode = CONFIG.analyticsConsent;
  if (!ASK[mode] || prefs.get('consent', null)) return;
  const block = trackingBlock();
  if (block && block !== 'consent') return;
  // 'identity' only matters once the visitor has said who they are.
  const show = () => {
    if (document.querySelector('.consent') || prefs.get('consent', null) || (mode === 'identity' && !prefs.get('me', null))) return;
    const bar = document.createElement('div');
    bar.className = 'consent';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Usage counting');
    bar.innerHTML = String(html`<p>${ASK[mode]} <a href="#/privacy">What’s recorded</a></p>
      <div class="btn-row"><button class="btn btn-small btn-primary" type="button" data-yes>Allow</button><button class="btn btn-small" type="button" data-no>No thanks</button></div>`);
    bar.addEventListener('click', e => {
      const yes = e.target.closest('[data-yes]'), no = e.target.closest('[data-no]');
      if (!yes && !no) return;
      setConsent(Boolean(yes));
      bar.remove();
    });
    document.body.append(bar);
  };
  show();
  window.addEventListener('ptctb:pref', e => { if (e.detail.key === 'me') show(); });
}
