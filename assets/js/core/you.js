// "You" in the top bar. The site knows who a visitor is only from "Sign in with osu!": the /auth/* Functions
// (signin/oauth.js, set up with SETUP-HOSTING.md) ask osu! who they are and send back a 30-day session token
// (signin/session.js), kept in this browser as prefs 'osuSession'. While it lasts, their avatar sits in the bar with a
// small menu (their profile, compare, the shop, sign out), their rows are highlighted everywhere (ui.js myId) and
// Bananas works: collecting the pouch, the paying daily game and spending (core/bananas.js). Signed out, or where
// sign-in doesn't work (CONFIG.signIn off, another address), there is no "you" at all.

import { html } from './html.js';
import { playerIndex } from './data.js';
import { avatar, prefs, myId } from './ui.js';
import { toast } from './fun.js';
import { track, identify } from './track.js';
import { t, th } from './i18n.js';
import { economy, bananas, signInHere } from './bananas.js';

const SIGN_IN_TTL = 15 * 60 * 1000;
// The osu! app only knows CONFIG.home's callback, so pages.dev previews, the old github.io copy and localhost don't offer it.
const SIGN_IN_HERE = signInHere();

/** Leaves for osu!'s "Authorise" page, remembering a one-time state and the page to come back to. */
export function signIn() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const state = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  prefs.set('signin', { state, back: location.hash, at: Date.now() });
  track('auth', 'start');
  location.assign(`/auth/login?state=${state}`);
}

// /auth/callback sends the browser back to #signin?id=…&name=…&state=… (or …&error=…). Read it here, while the modules
// load and before the router sees the hash, and put the page the visitor left from back in the address bar. The
// answer only counts if its state is the one this browser just sent, so a crafted link can't sign anyone in.
const signInResult = (() => {
  if (!location.hash.startsWith('#signin?')) return null;
  const answer = new URLSearchParams(location.hash.slice('#signin?'.length));
  const pending = prefs.get('signin', null);
  prefs.set('signin', null);
  history.replaceState(null, '', location.pathname + location.search + (pending?.back || '#/'));
  if (!pending || pending.state !== answer.get('state') || Date.now() - pending.at > SIGN_IN_TTL) return { error: 'stale' };
  if (answer.get('error')) return { error: answer.get('error') };
  const id = Number(answer.get('id'));
  const token = answer.get('token') ?? '';
  return Number.isSafeInteger(id) && id > 0 ? { id, name: answer.get('name') ?? '', proof: answer.get('proof') ?? '', token } : { error: 'osu' };
})();

const SIGN_IN_ERRORS = {
  denied: t('Sign-in cancelled. Nothing was changed.'),
  stale: t('That sign-in had expired or was started in another browser. Try again.'),
  osu: t('osu! didn’t confirm who you are. Try again in a moment.'),
};

async function finishSignIn({ id, name, proof, token, error }) {
  if (error) {
    track('auth', 'error', error);
    return toast(SIGN_IN_ERRORS[error] ?? SIGN_IN_ERRORS.osu);
  }
  const p = (await playerIndex().catch(() => null))?.get(id);
  if (!p) {
    track('auth', 'not listed');
    return toast(th('Signed in as {name}, but you’re not on the Portuguese leaderboards yet, so there’s nothing to show as yours.', { name: html`<b>${name}</b>` }));
  }
  track('auth', 'ok');
  // Lets the usage counts check that it was osu! that said who this is (signin/proof.js).
  prefs.set('osuProof', proof ? { id, proof } : null);
  // The session: "<id>.<expiry>.<signature>" (signin/session.js); only the site's endpoints can check it.
  const [tokenId, exp] = token.split('.').map(Number);
  prefs.set('osuSession', tokenId === id && exp > Date.now() / 1000 ? { id, token, exp } : null);
  window.dispatchEvent(new HashChangeEvent('hashchange')); // re-render the page with your rows highlighted
  toast(th('Signed in as {name}.', { name: html`<b>${p.name}</b>` }));
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
    const id = myId();
    const p = id ? (await playerIndex().catch(() => null))?.get(id) : null;
    const state = p ? String(id) : SIGN_IN_HERE ? 'signin' : null;
    if (drawn === state) return;
    drawn = state;
    box.hidden = !state;
    if (!state) { box.innerHTML = ''; return; }
    if (p) identify(p.name);
    if (!p) {
      box.innerHTML = String(html`<button class="you-signin" type="button" aria-label="${t('Sign in with osu!')}"
        title="${t('Sign in with your osu! account to collect your bananas and see your rows highlighted on any device')}">${t('Sign in')}</button>`);
      return;
    }
    const wallet = (await economy().catch(() => null))?.players?.[id] ?? null;
    box.innerHTML = String(html`
      <button class="you-btn" type="button" aria-expanded="false" aria-controls="you-menu"
        aria-label="${t('You: {name}', { name: p.name })}" title="${t('You: {name}', { name: p.name })}">${avatar(id, 'avatar-sm')}</button>
      <div class="you-menu" id="you-menu" hidden>
        <a class="you-head" href="#/player/${id}" aria-label="${t('Your profile: {name}', { name: p.name })}">${avatar(id, 'avatar-md')}<div><span class="you-label">${t('You')}</span><b>${p.name}</b></div></a>
        <a href="#/player/${id}">${t('Your profile')}</a>
        <a href="#/compare/${id}">${t('Compare with someone')}</a>
        ${wallet ? html`<a href="#/shop">${t('Shop')} <span class="faint">· ${bananas(wallet.b)}</span></a>` : ''}
        <button class="you-forget" type="button">${t('Sign out')}</button>
        <p class="you-note">${t('Signed in with osu! in this browser.')}</p>
      </div>`);
  };

  box.addEventListener('click', e => {
    if (e.target.closest('.you-signin, [data-signin]')) signIn();
    else if (e.target.closest('.you-btn')) setMenu(box.querySelector('.you-menu').hidden);
    else if (e.target.closest('.you-forget')) {
      track('auth', 'sign out');
      prefs.set('osuProof', null);
      prefs.set('osuSession', null);
      // Re-render the current page so its highlights and Bananas parts drop the old "you".
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
  window.addEventListener('ptctb:pref', e => { if (e.detail.key === 'osuSession') draw(); });
  // Any page's "Sign in with osu!" (core/bananas.js signInButton) starts the same sign-in.
  document.addEventListener('click', e => { if (!box.contains(e.target) && e.target.closest('[data-signin]')) signIn(); });
  window.addEventListener('storage', e => { if (e.key === 'ptctb:osuSession') draw(); }); // another tab signed in or out
  draw();
  if (signInResult) finishSignIn(signInResult);
}
