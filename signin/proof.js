// A small signed note that osu! confirmed a player id in this browser, so the usage counts (usage/store.js) can tell
// "signed in with osu!" from "pressed This is me", which anyone can do for anyone. /auth/callback adds it to the
// #signin answer; the browser keeps it with its "me" (core/you.js) and sends it with its usage events.
//
// It's an HMAC of the id and the time, keyed by the osu! app's client secret (only the release site has it, so dev
// can't check one and records such ids as "osu", not "verified"). It proves nothing else and opens nothing: there's
// no session behind it. Format: "<seconds>.<22 base64url characters>".

const LABEL = 'ptctb-usage-proof-v1';

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(secret, id, t) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${LABEL}|${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}|${t}`))).slice(0, 22);
}

/** The proof for `id`, made now (seconds since 1970 in `t`). */
export async function makeProof(secret, id, t = Math.floor(Date.now() / 1000)) {
  return `${t}.${await sign(secret, id, t)}`;
}

/** True when `proof` was made by makeProof with this secret for this id. */
export async function checkProof(secret, id, proof) {
  if (!secret || typeof proof !== 'string') return false;
  const [, t, sig] = proof.match(/^(\d{9,11})\.([A-Za-z0-9_-]{22})$/) ?? [];
  if (!t) return false;
  const expected = await sign(secret, id, Number(t));
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
