// The site's session token: proof that osu! confirmed who a browser belongs to, good for SESSION_DAYS, which the
// Bananas endpoints (economy/api.js) accept instead of a cookie. /auth/callback makes it next to the usage proof
// (signin/proof.js) and adds it to the #signin answer; the browser keeps it with its "me" (core/you.js) and sends it as
// "Authorization: Bearer <token>".
//
// It's an HMAC of "osuId|expiry", keyed by the osu! app's client secret under a label of its own, so only the release
// site (the one with the secret) can make or check one, and a usage proof can never pass for it. Nothing is stored:
// signing out forgets it in the browser, and changing the client secret signs everyone out. Format:
// "<osuId>.<expiry, unix seconds>.<43 base64url characters>".

const LABEL = 'ptctb-session-v1';
export const SESSION_DAYS = 30;

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(secret, id, exp) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${LABEL}|${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}|${exp}`)));
}

/** A token for osu! id `id`, valid SESSION_DAYS from `now` (unix seconds). */
export async function makeSession(secret, id, now = Math.floor(Date.now() / 1000)) {
  const exp = now + SESSION_DAYS * 86400;
  return `${id}.${exp}.${await sign(secret, id, exp)}`;
}

/** The osu! id a token was made for, or null when it's malformed, forged or expired. */
export async function checkSession(secret, token, now = Math.floor(Date.now() / 1000)) {
  if (!secret || typeof token !== 'string') return null;
  const [, id, exp, sig] = token.match(/^(\d{1,10})\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/) ?? [];
  if (!id || Number(exp) <= now) return null;
  const expected = await sign(secret, Number(id), Number(exp));
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? Number(id) : null;
}

/** When a token runs out (unix seconds), read without checking it: for the browser, which can't. */
export const sessionExpiry = token => Number(String(token).split('.')[1]) || 0;

/** The osu! id behind a request's "Authorization: Bearer <token>", or null. */
export function sessionOf(request, env, now) {
  const [, token] = (request.headers.get('Authorization') ?? '').match(/^Bearer\s+(\S+)$/) ?? [];
  return checkSession(env.OSU_CLIENT_SECRET, token, now);
}
