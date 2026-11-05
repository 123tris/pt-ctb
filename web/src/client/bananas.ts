// Bananas 🍌 in the browser, as assets/js/core/bananas.js has it: the signed-in session (client/you.ts keeps it), the
// calls to the site's endpoints (economy/api.js) and the requests the bot judges. The amounts, the rules and the request
// list's markup are pure: ui/bananas.ts and ui/requests.ts.
//
// The bot is the bank: the site forwards requests and the bot's answer comes back within 15 minutes.

import { CONFIG } from './config.ts';
import { text } from './i18n.ts';
import { prefs, myId, type Session } from './ui.ts';
import { toast } from './fun.ts';
import { track } from './track.ts';
import type { WalletRequest } from '../ui/requests.ts';

/** Sign-in only works on the build's own address (client/you.ts). */
export const signInHere = (): boolean => Boolean(CONFIG.signIn && (!CONFIG.home || location.origin === new URL(CONFIG.home).origin));

/** The signed-in player, { id, token, exp }, while the 30-day session lasts; null otherwise. */
export function session(): Session | null {
  return myId() ? prefs.get('osuSession', null) : null;
}

/** An endpoint's answer: { ok, status, body }. */
export interface Answer {
  ok: boolean;
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

/** Asks the site's endpoints, signed in. A refused session is forgotten. */
export async function api(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<Answer> {
  const { t } = text();
  const s = session();
  if (!s) return { ok: false, status: 401, body: { error: t('Sign in with osu! first.') } };
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, body: { error: t('The site couldn’t be reached. Check your connection and try again.') } };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) prefs.set('osuSession', null);
  return { ok: res.ok, status: res.status, body: data };
}

/** The endpoints' own messages (economy/store.js, economy/api.js), so they can be shown in Portuguese too. */
const SERVER_TEXT = /* i18n */ [
  'That isn’t a request the bot takes.', 'The bounty needs a map, a goal, a stake and a duration of 30, 60 or 90 days.',
  'Funding needs a bounty and an amount.', 'A tip needs a player and an amount.', 'You can’t tip yourself.', 'That isn’t in the shop.',
  'Shield needs on or off.', 'Pick one of the six maps.', 'You already tried that one.', 'Buy 1 to 52 periods at once.',
  'You’ve played today’s map. A new one comes at midnight, Lisbon time.',
];
void SERVER_TEXT;

/** What the site said went wrong, in the visitor's language where it's one of ours. */
function problem(status: number, body: { error?: string } | null | undefined): string {
  const { t } = text();
  return status === 401 ? t('Your sign-in has run out. Sign in with osu! again.')
    : status === 503 ? t('Bananas aren’t set up on this copy of the site.')
      : status === 429 ? t('You have several requests waiting for the bot already. It takes them every 15 minutes; try again after.')
        : body?.error ? t(body.error) : t('That didn’t go through. Try again in a moment.');
}

/**
 * Queues a request for the bot: { ok, message }. A success is a toast (the form closes); a failure's message is for the
 * form to show in its own line, next to what the player was doing.
 */
export async function sendRequest(type: string, payload: unknown): Promise<{ ok: boolean; message: string }> {
  const res = await api('/api/wallet/request', { method: 'POST', body: { type, payload } });
  track('use', 'bananas', type);
  if (res.ok) {
    toast(text().t('Sent to the bot. It answers within 15 minutes; your wallet shows the result.'));
    window.dispatchEvent(new CustomEvent('ptctb:requests'));
    return { ok: true, message: '' };
  }
  return { ok: false, message: problem(res.status, res.body) };
}

/** The signed-in player's requests (newest first), or null when they can't be read; `T` is the shape the page reads. */
export async function myRequests<T = WalletRequest>(): Promise<T[] | null> {
  const res = await api('/api/wallet/requests');
  return res.ok ? res.body.requests : null;
}

/** Esc closes an open form and puts focus back on what opened it (DESIGN.md §9 Menus): one handler per form. */
export function closeOnEscape(box: HTMLElement, close: () => void): void {
  box.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });
}
