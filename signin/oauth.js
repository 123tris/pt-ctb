// "Sign in with osu!" for the PT-CTB site: the two steps a static page can't do itself, because osu!'s OAuth needs
// the app's client secret and osu! sends no CORS headers. Served on the site's own origin by Cloudflare Pages
// Functions (functions/auth/login.js and callback.js call these):
//
//   site ──► /auth/login?state=… ──► osu! authorize ──► /auth/callback?code=…&state=… ──► /#signin?id=…&name=…&state=…
//
// `state` is a one-time random value the site made and kept in the visitor's browser. osu! hands it back, and the site
// only accepts the answer when it matches, so a crafted #signin link can't sign anyone in as somebody else. That keeps
// this stateless: no cookies, no signing key, nothing stored. The osu! token lives only inside one request; it is
// revoked straight after reading the profile and never logged. Secrets: OSU_CLIENT_ID and OSU_CLIENT_SECRET.

const STATE = /^[A-Za-z0-9_-]{16,128}$/;

/** Sends the visitor to osu!'s "Authorise" page. */
export function login(request, env) {
  const url = new URL(request.url);
  if (!configured(env)) return text('Sign-in is not configured yet.', 503);
  const state = url.searchParams.get('state') ?? '';
  if (!STATE.test(state)) return text('Missing or malformed state. Start the sign-in from the site.', 400);
  const authorize = new URL('/oauth/authorize', osu(env));
  authorize.search = new URLSearchParams({
    client_id: env.OSU_CLIENT_ID,
    redirect_uri: callbackUrl(url),
    response_type: 'code',
    scope: 'identify',
    state,
  });
  return redirect(authorize);
}

/** osu! sends the visitor back here with a one-time code; trade it for who they are and send them to the site. */
export async function callback(request, env) {
  const url = new URL(request.url);
  if (!configured(env)) return text('Sign-in is not configured yet.', 503);
  const state = url.searchParams.get('state') ?? '';
  if (!STATE.test(state)) return text('Missing or malformed state. Start the sign-in from the site.', 400);
  const code = url.searchParams.get('code');
  if (!code) return back(url, { error: url.searchParams.get('error') === 'access_denied' ? 'denied' : 'osu', state });

  try {
    const tokenResponse = await fetch(new URL('/oauth/token', osu(env)), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.OSU_CLIENT_ID,
        client_secret: env.OSU_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl(url),
      }),
    });
    if (!tokenResponse.ok) return back(url, { error: 'osu', state });
    const { access_token: token } = await tokenResponse.json();
    if (!token) return back(url, { error: 'osu', state });

    const auth = { Accept: 'application/json', Authorization: `Bearer ${token}` };
    const meResponse = await fetch(new URL('/api/v2/me', osu(env)), { headers: auth });
    const me = meResponse.ok ? await meResponse.json() : null;
    // Done with the token: revoke it so it doesn't linger on osu!'s side for its remaining day.
    await fetch(new URL('/api/v2/oauth/tokens/current', osu(env)), { method: 'DELETE', headers: auth }).catch(() => {});

    if (!Number.isSafeInteger(me?.id) || typeof me.username !== 'string') return back(url, { error: 'osu', state });
    return back(url, { id: String(me.id), name: me.username, state });
  } catch {
    return back(url, { error: 'osu', state });
  }
}

/** Back to the site's front page, with the result in the hash (which browsers never send to any server). */
function back(url, params) {
  const site = new URL('/', url);
  site.hash = `signin?${new URLSearchParams(params)}`;
  return redirect(site);
}

const configured = env => !!(env.OSU_CLIENT_ID && env.OSU_CLIENT_SECRET);
const osu = env => env.OSU_URL || 'https://osu.ppy.sh'; // OSU_URL only exists so tests can point at a fake osu!
const callbackUrl = url => `${url.origin}/auth/callback`;

// Pages doesn't apply _headers to Functions, so these responses carry their own.
const redirect = to => new Response(null, {
  status: 302,
  headers: { Location: String(to), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
});

const text = (body, status = 200) => new Response(body + '\n', {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
