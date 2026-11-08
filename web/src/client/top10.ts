// Top 10's endpoints in the browser (contract §13.3, functions/api/top10/): the reads anyone can make, signed in or
// not, and the ballot, showcase, thanks and admin calls that need the session. Each answer is { ok, status, body };
// pages turn a status into what to show with ui/top10.ts troubleOf() (503: not on this copy, 401: sign in).
//
// While the backend isn't on a copy of the site, a local mock of the same answers (client/top10-mock.ts) stands in:
// only on a local address (localhost, 127.0.0.1), and only after ?top10mock=1 turned it on in this browser
// (?top10mock=0 turns it off). Production never loads it: the import below only runs when both hold.

import { prefs, myId } from './ui.ts';
import { session, type Answer } from './bananas.ts';
import { REPLAY_UPLOAD } from '../ui/top10.ts';

export type { Answer };

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const MOCK_KEY = 'top10mock';

/** Whether the mock answers instead of the site (local addresses only, once turned on). */
export function mockOn(): boolean {
  if (!LOCAL.test(location.hostname)) return false;
  const asked = new URLSearchParams(location.search).get('top10mock');
  if (asked === '1' || asked === '0') prefs.set(MOCK_KEY, asked === '1');
  return prefs.get(MOCK_KEY, false) === true;
}

type Handler = (method: string, path: string, body: unknown, me: number | null) => Promise<Answer>;
let mock: Promise<Handler> | null = null;

/** Asks Top 10's endpoints. Signed in, the session goes along; a refused session is forgotten, as client/bananas.ts does. */
export async function top10Api(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<Answer> {
  if (mockOn()) {
    mock ??= import('./top10-mock.ts').then(m => m.handle);
    return (await mock)(method, path, body === undefined || body instanceof FormData ? body : JSON.parse(JSON.stringify(body)), myId());
  }
  const s = session();
  if (method !== 'GET' && !s) return { ok: false, status: 401, body: {} };
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      // Form data sets its own Content-Type (multipart, with the boundary).
      headers: { ...(s ? { Authorization: `Bearer ${s.token}` } : {}), ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      keepalive: method === 'PUT',
    });
  } catch {
    return { ok: false, status: 0, body: {} };
  }
  const data = await res.json().catch(() => ({}));
  // Pages Functions not deployed on this copy: the static 404 (or the edge's HTML) instead of JSON.
  const status = res.status === 404 && !(data && typeof data === 'object' && 'error' in data) && path.split('?')[0] !== '/api/top10/results' ? 503 : res.status;
  if (status === 401 && s) prefs.set('osuSession', null);
  return { ok: res.ok, status, body: data };
}

/**
 * A showcase entry's body for POST /api/top10/plays: the fields as JSON, or with a replay file, as REPLAY_UPLOAD says
 * (ui/top10.ts): multipart form data (the fields, and the file as `replay`), or JSON with
 * `replay: { name, data: <base64> }`. The backend settles which (§13.9).
 */
export async function showcaseBody(fields: Record<string, unknown>, file: File | null): Promise<Record<string, unknown> | FormData> {
  if (!file) return fields;
  if (REPLAY_UPLOAD === 'base64') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ...fields, replay: { name: file.name, data: btoa(text) } };
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
  form.append('replay', file, file.name);
  return form;
}

/** The endpoints' messages that are ours (contract §13.3), so they show in Portuguese too. */
const SERVER_TEXT = /* i18n */ ['add it with /addscore first, or attach a clip'];
void SERVER_TEXT;

/** What went wrong with a call, in words. */
export function problemText(t: (s: string, v?: Record<string, unknown>) => string, res: Answer): string {
  if (res.status === 401) return t('Your sign-in has run out. Sign in with osu! again.');
  if (res.status === 503) return t('Top 10 voting isn’t set up on this copy of the site.');
  if (res.status === 403) return t('You can’t do that.');
  if (res.status === 0) return t('The site couldn’t be reached. Check your connection and try again.');
  const said = res.body?.error;
  return typeof said === 'string' && said ? t(said) : t('That didn’t go through. Try again in a moment.');
}
