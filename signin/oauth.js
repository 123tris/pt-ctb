// "Sign in with osu!" for the PT-CTB site: the two steps a static page can't do itself, because osu!'s OAuth needs
// the app's client secret and osu! sends no CORS headers. Served by Cloudflare Pages Functions (functions/auth/login.js
// and callback.js call these) on the release site and the development one, which share ONE osu! app. osu! only knows
// one callback URL, the release site's, so every sign-in goes through it:
//
//   dev.ptcatch.com/auth/login?state=N ──► ptcatch.com/auth/login?site=https://dev.ptcatch.com&state=N
//   ptcatch.com/auth/login ──► osu! authorize (state=d.N) ──► ptcatch.com/auth/callback?code=…&state=d.N
//   ──► https://dev.ptcatch.com/#signin?id=…&name=…&state=N
//
// N is a one-time random value the site made and kept in the visitor's browser. It comes back to the site, which only
// accepts the answer when it matches, so a crafted #signin link can't sign anyone in as somebody else. The letter in
// front of it says which site to return to, and only the sites in SITES exist: anything else is refused before osu!,
// or ends up on the release site. Changing that letter can at most send an answer to the other of our two sites,
// whose browser never stored that N, so it's thrown away there. That keeps this stateless: no cookies, no signing
// key, nothing stored. The osu! token lives only inside one request; it is revoked straight after reading the profile
// and never logged. The release site needs OSU_CLIENT_ID and OSU_CLIENT_SECRET; the development one needs nothing.
// The answer also carries a `proof` (signin/proof.js), which only the usage counts use.

import { CONFIG } from '../assets/js/config.js';
import { makeProof } from './proof.js';

/** The only places a sign-in starts from and returns to, by the letter `state` carries. */
const SITES = { p: CONFIG.production, d: CONFIG.development };
const RELEASE = SITES.p;
const CALLBACK = `${RELEASE}/auth/callback`; // the one Application Callback URL registered with osu!

const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const OSU_STATE = /^(?:([a-z])\.)?([A-Za-z0-9_-]{16,128})$/;
const siteKey = origin => Object.keys(SITES).find(key => SITES[key] === origin);

/** Sends the visitor to osu!'s "Authorise" page, by way of the release site when it starts anywhere else. */
export function login(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  if (!NONCE.test(state)) return text('Missing or malformed state. Start the sign-in from the site.', 400);

  // Not the release site: hand over to it (it holds the osu! app), saying where to come back to.
  if (url.origin !== RELEASE) {
    const handover = new URL('/auth/login', RELEASE);
    handover.search = new URLSearchParams({ site: url.origin, state });
    return redirect(handover);
  }

  if (!env.OSU_CLIENT_ID) return text('Sign-in is not configured yet.', 503);
  const key = siteKey(url.searchParams.get('site') ?? RELEASE);
  if (!key) return text(`Sign-in only works on ${Object.values(SITES).join(' and ')}.`, 400);
  const authorize = new URL('/oauth/authorize', osu(env));
  authorize.search = new URLSearchParams({
    client_id: env.OSU_CLIENT_ID,
    redirect_uri: CALLBACK,
    response_type: 'code',
    scope: 'identify',
    state: `${key}.${state}`,
  });
  return redirect(authorize);
}

/** osu! sends the visitor back here with a one-time code; trade it for who they are and send them to their site. */
export async function callback(request, env) {
  const url = new URL(request.url);
  if (!env.OSU_CLIENT_ID || !env.OSU_CLIENT_SECRET) return text('Sign-in is not configured yet.', 503);
  const [, key, state] = (url.searchParams.get('state') ?? '').match(OSU_STATE) ?? [];
  if (!state) return text('Missing or malformed state. Start the sign-in from the site.', 400);
  const site = SITES[key] ?? RELEASE;
  const code = url.searchParams.get('code');
  if (!code) return back(site, { error: url.searchParams.get('error') === 'access_denied' ? 'denied' : 'osu', state });

  try {
    const tokenResponse = await fetch(new URL('/oauth/token', osu(env)), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.OSU_CLIENT_ID,
        client_secret: env.OSU_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: CALLBACK,
      }),
    });
    if (!tokenResponse.ok) return back(site, { error: 'osu', state });
    const { access_token: token } = await tokenResponse.json();
    if (!token) return back(site, { error: 'osu', state });

    const auth = { Accept: 'application/json', Authorization: `Bearer ${token}` };
    const meResponse = await fetch(new URL('/api/v2/me', osu(env)), { headers: auth });
    const me = meResponse.ok ? await meResponse.json() : null;
    // Done with the token: revoke it so it doesn't linger on osu!'s side for its remaining day.
    await fetch(new URL('/api/v2/oauth/tokens/current', osu(env)), { method: 'DELETE', headers: auth }).catch(() => {});

    if (!Number.isSafeInteger(me?.id) || typeof me.username !== 'string') return back(site, { error: 'osu', state });
    // proof: lets the usage counts mark this id as confirmed by osu! rather than picked by hand (signin/proof.js).
    return back(site, { id: String(me.id), name: me.username, state, proof: await makeProof(env.OSU_CLIENT_SECRET, me.id) });
  } catch {
    return back(site, { error: 'osu', state });
  }
}

/** Back to the site's front page, with the result in the hash (which browsers never send to any server). */
function back(site, params) {
  const to = new URL('/', site);
  to.hash = `signin?${new URLSearchParams(params)}`;
  return redirect(to);
}

const osu = env => env.OSU_URL || 'https://osu.ppy.sh'; // OSU_URL only exists so tests can point at a fake osu!

// Pages doesn't apply _headers to Functions, so these responses carry their own.
const redirect = to => new Response(null, {
  status: 302,
  headers: { Location: String(to), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
});

const text = (body, status = 200) => new Response(body + '\n', {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
