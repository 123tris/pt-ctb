// "You" in the top bar, as assets/js/core/you.js has it. The site knows who a visitor is only from "Sign in with osu!":
// the /auth/* Functions (signin/oauth.js, set up with SETUP-HOSTING.md) ask osu! who they are and send back a 30-day
// session token (signin/session.js), kept in this browser as prefs 'osuSession'. While it lasts, their avatar sits in
// the bar with a small menu (their profile, compare, the shop, sign out), their rows are highlighted everywhere
// (client/ui.ts myId) and Bananas works: collecting the pouch, the paying daily game and spending (client/bananas.ts).
// Signed out, or where sign-in doesn't work (CONFIG.signIn off, another address), there is no "you" at all.
//
// The player comes from the core pack, the wallet from economy.json and the admins from admin.json.

import { html } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { avatar, rowOf } from '../ui/players.ts';
import { bananas } from '../ui/bananas.ts';
import { isAdmin } from '../ui/admins.ts';
import { store } from './boot.ts';
import { shellPlayers as players } from './players.ts';
import { prefs, myId } from './ui.ts';
import { toast } from './fun.ts';
import { track, identify } from './track.ts';
import { signInHere } from './bananas.ts';

const SIGN_IN_TTL = 15 * 60 * 1000;

/** Leaves for osu!'s "Authorise" page, remembering a one-time state and the page to come back to. */
export function signIn(): void {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const state = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  prefs.set('signin', { state, back: location.pathname + location.search, at: Date.now() });
  track('auth', 'start');
  location.assign(`/auth/login?state=${state}`);
}

/** What /auth/callback said: who signed in, or why not. */
export type SignInResult = { id: number; name: string; proof: string; token: string; error?: undefined } | { error: string };

/**
 * /auth/callback sends the browser back to #signin?id=…&name=…&state=… (or …&error=…). The app reads it first thing,
 * before the router sees the hash, and puts the page the visitor left from back in the address bar. The answer only
 * counts if its state is the one this browser just sent, so a crafted link can't sign anyone in.
 */
export function readSignIn(): SignInResult | null {
  if (!location.hash.startsWith('#signin?')) return null;
  const answer = new URLSearchParams(location.hash.slice('#signin?'.length));
  const pending: { state: string; back: string; at: number } | null = prefs.get('signin', null);
  prefs.set('signin', null);
  // `back` is the page's path, or its old #/ address from before the site had paths (the app turns that into the path).
  const back = pending?.back || '/';
  history.replaceState(null, '', back.startsWith('#') ? `/${back}` : back);
  if (!pending || pending.state !== answer.get('state') || Date.now() - pending.at > SIGN_IN_TTL) return { error: 'stale' };
  if (answer.get('error')) return { error: answer.get('error')! };
  const id = Number(answer.get('id'));
  const token = answer.get('token') ?? '';
  return Number.isSafeInteger(id) && id > 0 ? { id, name: answer.get('name') ?? '', proof: answer.get('proof') ?? '', token } : { error: 'osu' };
}

/** A JSON file the data has only once a feature is on (economy.json, admin.json), or null. */
const optional = <T>(name: string): Promise<T | null> => store.hasJson(name).then(has => (has ? store.json<T>(name) : null)).catch(() => null);

async function finishSignIn(ctx: Ctx, result: SignInResult): Promise<void> {
  const { t, th } = ctx;
  if (result.error !== undefined) {
    track('auth', 'error', result.error);
    const errors: Record<string, string> = {
      denied: t('Sign-in cancelled. Nothing was changed.'),
      stale: t('That sign-in had expired or was started in another browser. Try again.'),
      osu: t('osu! didn’t confirm who you are. Try again in a moment.'),
    };
    return toast(errors[result.error] ?? errors.osu);
  }
  const { id, name, proof, token } = result;
  const list = await players();
  const row = list ? rowOf(list, id) : -1;
  if (row < 0) {
    track('auth', 'not listed');
    return toast(th('Signed in as {name}, but you’re not on the Portuguese leaderboards yet, so there’s nothing to show as yours.', { name: html`<b>${name}</b>` }));
  }
  track('auth', 'ok');
  // Lets the usage counts check that it was osu! that said who this is (signin/proof.js).
  prefs.set('osuProof', proof ? { id, proof } : null);
  // The session: "<id>.<expiry>.<signature>" (signin/session.js); only the site's endpoints can check it.
  const [tokenId, exp] = token.split('.').map(Number);
  prefs.set('osuSession', tokenId === id && exp > Date.now() / 1000 ? { id, token, exp } : null);
  window.dispatchEvent(new Event('routechange')); // draw the page again with your rows highlighted
  toast(th('Signed in as {name}.', { name: html`<b>${list!.name.at(row)}</b>` }));
}

/** The You menu in the top bar, and the sign-in's last step when the page came back from osu! with `signedIn`. */
export function initYou(ctx: Ctx, signedIn: SignInResult | null): void {
  const { t } = ctx;
  // The site used to let anyone mark a profile "This is me" (prefs 'me', and 'osuMe' for the id an osu! sign-in gave).
  // It knows who a visitor is only from "Sign in with osu!" now, so a stored pick is dropped once, never promoted.
  try { localStorage.removeItem('ptctb:me'); localStorage.removeItem('ptctb:osuMe'); } catch { /* storage blocked */ }
  // The osu! app only knows CONFIG.home's callback, so pages.dev previews, the old github.io copy and localhost don't
  // offer it.
  const here = signInHere();
  const bar = document.querySelector('.topbar-inner')!;
  const box = document.createElement('div');
  box.className = 'you';
  box.hidden = true;
  bar.insertBefore(box, bar.querySelector('.nav-toggle'));

  const setMenu = (open: boolean) => {
    const menu = box.querySelector<HTMLElement>('.you-menu');
    const button = box.querySelector('.you-btn');
    if (!menu) return;
    menu.hidden = !open;
    button!.setAttribute('aria-expanded', String(open));
  };

  let drawn: string | null = null;
  const draw = async () => {
    const id = myId();
    const list = id ? await players() : null;
    const row = id && list ? rowOf(list, id) : -1;
    const state = row >= 0 ? String(id) : here ? 'signin' : null;
    if (drawn === state) return;
    drawn = state;
    box.hidden = !state;
    if (!state) { box.innerHTML = ''; return; }
    if (row < 0) {
      box.innerHTML = String(html`<button class="you-signin" type="button" aria-label="${t('Sign in with osu!')}"
        title="${t('Sign in with your osu! account to collect your bananas and see your rows highlighted on any device')}">${t('Sign in')}</button>`);
      return;
    }
    const name = list!.name.at(row);
    identify(name);
    const [eco, panel] = await Promise.all([
      optional<{ players?: Record<string, { b: number }> }>('economy.json'), optional<{ admins?: { osuId: number }[] }>('admin.json'),
    ]);
    const wallet = eco?.players?.[id!] ?? null;
    box.innerHTML = String(html`
      <button class="you-btn" type="button" aria-expanded="false" aria-controls="you-menu"
        aria-label="${t('You: {name}', { name })}" title="${t('You: {name}', { name })}">${avatar(ctx, list!, row, 'avatar-sm')}</button>
      <div class="you-menu" id="you-menu" hidden>
        <a class="you-head" href="/player/${id}" aria-label="${t('Your profile: {name}', { name })}">${avatar(ctx, list!, row, 'avatar-md')}<div><span class="you-label">${t('You')}</span><b>${name}</b></div></a>
        <a href="/player/${id}">${t('Your profile')}</a>
        <a href="/compare/${id}">${t('Compare with someone')}</a>
        ${wallet ? html`<a href="/shop">${t('Shop')} <span class="faint">· ${bananas(ctx, wallet.b)}</span></a>` : ''}
        ${isAdmin(id, panel) ? html`<a href="/admin">${t('Admin')}</a>` : ''}
        <button class="you-forget" type="button">${t('Sign out')}</button>
        <p class="you-note">${t('Signed in with osu! in this browser.')}</p>
      </div>`);
  };

  box.addEventListener('click', e => {
    const target = e.target as Element;
    if (target.closest('.you-signin, [data-signin]')) signIn();
    else if (target.closest('.you-btn')) setMenu(Boolean(box.querySelector<HTMLElement>('.you-menu')!.hidden));
    else if (target.closest('.you-forget')) {
      track('auth', 'sign out');
      prefs.set('osuProof', null);
      prefs.set('osuSession', null);
      // Draw the current page again so its highlights and Bananas parts drop the old "you".
      window.dispatchEvent(new Event('routechange'));
    } else if (target.closest('a')) setMenu(false);
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'Escape') { setMenu(false); box.querySelector<HTMLElement>('.you-btn')?.focus(); }
  });
  document.addEventListener('click', e => { if (!box.contains(e.target as Node)) setMenu(false); });
  // A disclosure, not a menu: it closes when focus leaves it (APG disclosure navigation).
  box.addEventListener('focusout', e => { if (e.relatedTarget && !box.contains(e.relatedTarget as Node)) setMenu(false); });
  window.addEventListener('routechange', () => setMenu(false));
  window.addEventListener('ptctb:pref', e => { if ((e as CustomEvent<{ key: string }>).detail.key === 'osuSession') draw(); });
  // Any page's "Sign in with osu!" (ui/bananas.ts signInButton) starts the same sign-in.
  document.addEventListener('click', e => { if (!box.contains(e.target as Node) && (e.target as Element).closest?.('[data-signin]')) signIn(); });
  window.addEventListener('storage', e => { if (e.key === 'ptctb:osuSession') draw(); }); // another tab signed in or out
  draw();
  if (signedIn) finishSignIn(ctx, signedIn);
}
