// The consent prompt for the usage counts, as assets/js/core/consent.js has it. Off unless CONFIG.analyticsConsent is
// set ('identity' or 'all', see config.js): then a small strip at the bottom of the window asks once, and the answer is
// kept in this browser (ptctb:consent). Not a modal: the site stays usable and saying nothing means no. Browsers that
// send Do Not Track or Global Privacy Control, or opted out, are never asked.

import { html } from '../kernel/html.ts';
import type { Text } from '../kernel/i18n.ts';
import { CONFIG } from './config.ts';
import { trackingBlock, setConsent } from './track.ts';
import { prefs, myId } from './ui.ts';

export function initConsent({ t }: Text): void {
  const ask: Record<string, string> = {
    identity: t('Can we link how you use the site to your osu! player? It helps us see what players like you need.'),
    all: t('Can we record how you use the site? It helps us see what to improve. Nothing goes to anyone else.'),
  };
  const mode: string = CONFIG.analyticsConsent;
  if (!Object.hasOwn(ask, mode) || prefs.get('consent', null)) return;
  const block = trackingBlock();
  if (block && block !== 'consent') return;
  // 'identity' only matters once the visitor has signed in.
  const show = () => {
    if (document.querySelector('.consent') || prefs.get('consent', null) || (mode === 'identity' && !myId())) return;
    const bar = document.createElement('div');
    bar.className = 'consent';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', t('Usage counting'));
    bar.innerHTML = String(html`<p>${ask[mode]} <a href="/privacy">${t('What’s recorded')}</a></p>
      <div class="btn-row"><button class="btn btn-small btn-primary" type="button" data-yes>${t('Allow')}</button><button class="btn btn-small" type="button" data-no>${t('No thanks')}</button></div>`);
    bar.addEventListener('click', e => {
      const target = e.target as Element;
      const yes = target.closest('[data-yes]'), no = target.closest('[data-no]');
      if (!yes && !no) return;
      setConsent(Boolean(yes));
      bar.remove();
    });
    document.body.append(bar);
  };
  show();
  window.addEventListener('ptctb:pref', e => { if ((e as CustomEvent<{ key: string }>).detail.key === 'osuSession') show(); });
}
