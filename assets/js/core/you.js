// "You" in the top bar: once a visitor marks a profile with "This is me", their avatar sits in the bar with a small
// menu (their profile, compare, and "This isn't me" to forget it). The choice lives in localStorage (prefs 'me'),
// so it is per browser.
//
// With CONFIG.signIn on, the bar also offers "Sign in with osu!" while nobody is chosen: the site's /auth/* Functions
// (signin/oauth.js, set up with SETUP-HOSTING.md) ask osu! who the visitor is, so they get the same "me" on every
// device without hunting for their profile. It still only fills prefs 'me'; nothing else is kept anywhere.

import { html } from './html.js';
import { playerIndex } from './data.js';
import { avatar, prefs } from './ui.js';
import { toast } from './fun.js';
import { CONFIG } from '../config.js';

const SIGN_IN_TTL = 15 * 60 * 1000;
// The osu! app only knows CONFIG.home's callback, so pages.dev previews, the old github.io copy and localhost don't offer it.
const SIGN_IN_HERE = CONFIG.signIn && (!CONFIG.home || location.origin === new URL(CONFIG.home).origin);

/** Leaves for osu!'s "Authorise" page, remembering a one-time state and the page to come back to. */
function signIn() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const state = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  prefs.set('signin', { state, back: location.hash, at: Date.now() });
  location.assign(`/auth/login?state=${state}`);
}

// /auth/callback sends the browser back to #signin?id=…&name=…&state=… (or …&error=…). Read it here, while the modules
// load and before the router sees the hash, and put the page the visitor left from back in the address bar. The
// answer only counts if its state is the one this browser just sent, so a crafted link can't pick "me" for anyone.
const signInResult = (() => {
  if (!location.hash.startsWith('#signin?')) return null;
  const answer = new URLSearchParams(location.hash.slice('#signin?'.length));
  const pending = prefs.get('signin', null);
  prefs.set('signin', null);
  history.replaceState(null, '', location.pathname + location.search + (pending?.back || '#/'));
  if (!pending || pending.state !== answer.get('state') || Date.now() - pending.at > SIGN_IN_TTL) return { error: 'stale' };
  if (answer.get('error')) return { error: answer.get('error') };
  const id = Number(answer.get('id'));
  return Number.isSafeInteger(id) && id > 0 ? { id, name: answer.get('name') ?? '' } : { error: 'osu' };
})();

const SIGN_IN_ERRORS = {
  denied: 'Sign-in cancelled. Nothing was changed.',
  stale: 'That sign-in had expired or was started in another browser. Try again.',
  osu: 'osu! didn’t confirm who you are. Try again in a moment.',
};

async function finishSignIn({ id, name, error }) {
  if (error) return toast(SIGN_IN_ERRORS[error] ?? SIGN_IN_ERRORS.osu);
  const p = (await playerIndex().catch(() => null))?.get(id);
  if (!p) return toast(html`Signed in as <b>${name}</b>, but you’re not on the Portuguese leaderboards yet, so there’s nothing to show as yours.`);
  prefs.set('osuMe', id);
  prefs.set('me', id);
  window.dispatchEvent(new HashChangeEvent('hashchange')); // re-render the page with your rows highlighted
  toast(html`Signed in as <b>${p.name}</b>.`);
}

export function initYou() {
  const bar = document.querySelector('.topbar-inner');
  const box = document.createElement('div');
  box.className = 'you';
  box.hidden = true;
  bar.insertBefore(box, bar.querySelector('.nav-toggle'));

  const setMenu = open => {
    const menu = box.querySelector('.you-menu');
    const button = box.querySelector('.you-btn');
    if (!menu) return;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };

  let drawn = null;
  const draw = async () => {
    const id = prefs.get('me', null);
    const p = id ? (await playerIndex().catch(() => null))?.get(id) : null;
    const viaOsu = !!p && prefs.get('osuMe', null) === id;
    const state = p ? `${id}:${viaOsu}` : SIGN_IN_HERE ? 'signin' : null;
    if (drawn === state) return;
    drawn = state;
    box.hidden = !state;
    if (!state) { box.innerHTML = ''; return; }
    if (!p) {
      box.innerHTML = String(html`<button class="you-signin" type="button" aria-label="Sign in with osu!"
        title="Sign in with your osu! account to see your rows highlighted on any device">Sign in</button>`);
      return;
    }
    box.innerHTML = String(html`
      <button class="you-btn" type="button" aria-expanded="false" aria-controls="you-menu"
        aria-label="You: ${p.name}" title="You: ${p.name}">${avatar(id, 'avatar-sm')}</button>
      <div class="you-menu" id="you-menu" hidden>
        <div class="you-head">${avatar(id, 'avatar-md')}<div><span class="you-label">You</span><b>${p.name}</b></div></div>
        <a href="#/player/${id}">Your profile</a>
        <a href="#/compare/${id}">Compare with someone</a>
        <button class="you-forget" type="button">${viaOsu ? 'Sign out' : 'This isn’t me'}</button>
        <p class="you-note">${viaOsu ? 'Signed in with osu! in this browser.' : 'Remembered in this browser.'}</p>
      </div>`);
  };

  box.addEventListener('click', e => {
    if (e.target.closest('.you-signin')) signIn();
    else if (e.target.closest('.you-btn')) setMenu(box.querySelector('.you-menu').hidden);
    else if (e.target.closest('.you-forget')) {
      prefs.set('osuMe', null);
      prefs.set('me', null);
      // Re-render the current page so its highlights and "This is me" button drop the old choice.
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else if (e.target.closest('a')) setMenu(false);
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'Escape') { setMenu(false); box.querySelector('.you-btn')?.focus(); }
  });
  document.addEventListener('click', e => { if (!box.contains(e.target)) setMenu(false); });
  // A disclosure, not a menu: it closes when focus leaves it (APG disclosure navigation).
  box.addEventListener('focusout', e => { if (e.relatedTarget && !box.contains(e.relatedTarget)) setMenu(false); });
  window.addEventListener('hashchange', () => setMenu(false));
  window.addEventListener('ptctb:pref', e => { if (e.detail.key === 'me') draw(); });
  window.addEventListener('storage', e => { if (e.key === 'ptctb:me') draw(); }); // another tab changed it
  draw();
  if (signInResult) finishSignIn(signInResult);
}
