// Tests for the sign-in Functions against a fake osu! (global fetch is swapped out). Run: npm test

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as loginRoute } from '../functions/auth/login.js';
import { onRequestGet as callbackRoute } from '../functions/auth/callback.js';

const env = { OSU_CLIENT_ID: '123', OSU_CLIENT_SECRET: 'shh-secret' };
const STATE = 'AbCdEfGhIjKlMnOpQrStUv';
const RELEASE = 'https://ptcatch.com';
const DEV = 'https://dev.ptcatch.com';
const CALLBACK = `${RELEASE}/auth/callback`;

let calls;
let osu; // per-test responses: { token, me }
beforeEach(() => {
  calls = [];
  osu = { token: { status: 200, body: { access_token: 'tok-abc', token_type: 'Bearer' } }, me: { status: 200, body: { id: 4158549, username: 'Tristan' } } };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? String(init.body) : '' });
    const reply = url.pathname === '/oauth/token' ? osu.token
      : url.pathname === '/api/v2/me' ? osu.me
        : { status: 204, body: null };
    if (reply.throws) throw new Error('network down');
    return new Response(reply.body === null ? null : JSON.stringify(reply.body), { status: reply.status });
  };
});

/** GET a path on one of the sites (the release one unless the path is a full URL). */
const get = (path, e = env) => {
  const request = new Request(path.startsWith('https://') ? path : RELEASE + path);
  const route = new URL(request.url).pathname === '/auth/login' ? loginRoute : callbackRoute;
  return route({ request, env: e });
};
const location = res => new URL(res.headers.get('Location'));
const signinParams = (res, site = RELEASE) => {
  const to = location(res);
  assert.equal(to.origin + to.pathname, `${site}/`);
  assert.ok(to.hash.startsWith('#signin?'), to.hash);
  return Object.fromEntries(new URLSearchParams(to.hash.slice('#signin?'.length)));
};
const authorizeParams = res => {
  const to = location(res);
  assert.equal(to.origin + to.pathname, 'https://osu.ppy.sh/oauth/authorize');
  return Object.fromEntries(to.searchParams);
};

test('/auth/login on the release site redirects to osu! authorize with identify scope, its callback and the state', async () => {
  const res = await get(`/auth/login?state=${STATE}`);
  assert.equal(res.status, 302);
  assert.deepEqual(authorizeParams(res), {
    client_id: '123', redirect_uri: CALLBACK, response_type: 'code', scope: 'identify', state: `p.${STATE}`,
  });
  assert.ok(!res.headers.get('Location').includes('shh-secret'));
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('/auth/login on the dev site hands over to the release site, needing no osu! keys of its own', async () => {
  const res = await get(`${DEV}/auth/login?state=${STATE}`, {});
  assert.equal(res.status, 302);
  const to = location(res);
  assert.equal(to.origin + to.pathname, `${RELEASE}/auth/login`);
  assert.deepEqual(Object.fromEntries(to.searchParams), { site: DEV, state: STATE });
  assert.equal(calls.length, 0);
});

test('the release login sends osu! the release callback for dev sign-ins too, marking them d.', async () => {
  const res = await get(`/auth/login?site=${encodeURIComponent(DEV)}&state=${STATE}`);
  const params = authorizeParams(res);
  assert.equal(params.redirect_uri, CALLBACK);
  assert.equal(params.state, `d.${STATE}`);
});

test('the release login refuses to start a sign-in for any site outside the allowlist', async () => {
  for (const site of ['https://evil.example', 'https://pt-ctb.pages.dev', 'http://ptcatch.com', 'https://ptcatch.com.evil.example', `${DEV}/`, 'null']) {
    const res = await get(`/auth/login?site=${encodeURIComponent(site)}&state=${STATE}`);
    assert.equal(res.status, 400, site);
    assert.equal(res.headers.get('Location'), null, site);
  }
  // Starting on a site that isn't ours goes to the release login, which then refuses it the same way.
  const handover = await get(`https://pt-ctb.pages.dev/auth/login?state=${STATE}`);
  const refused = await get(location(handover).href);
  assert.equal(refused.status, 400);
});

test('a dev sign-in goes all the way round: dev login → release login → osu! → release callback → dev', async () => {
  const handover = await get(`${DEV}/auth/login?state=${STATE}`, {});
  const authorize = await get(location(handover).href);
  const { state: osuState, redirect_uri: redirectUri } = authorizeParams(authorize);
  // osu! sends the visitor to the redirect_uri with a code and the state it was given.
  const res = await get(`${redirectUri}?code=the-code&state=${osuState}`);
  assert.deepEqual(signinParams(res, DEV), { id: '4158549', name: 'Tristan', state: STATE });
  const token = calls.find(c => c.url.endsWith('/oauth/token'));
  assert.equal(new URLSearchParams(token.body).get('redirect_uri'), CALLBACK, 'the token exchange repeats the same redirect_uri');
});

test('/auth/callback trades the code, reads /me, revokes the token and returns only id, name and state', async () => {
  const res = await get(`/auth/callback?code=the-code&state=p.${STATE}`);
  assert.equal(res.status, 302);
  assert.deepEqual(signinParams(res), { id: '4158549', name: 'Tristan', state: STATE });
  assert.ok(!res.headers.get('Location').includes('tok-abc'), 'the token never reaches the browser');
  assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');

  const [token, me, revoke] = calls;
  assert.equal(token.url, 'https://osu.ppy.sh/oauth/token');
  assert.equal(token.method, 'POST');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(token.body)), {
    client_id: '123', client_secret: 'shh-secret', code: 'the-code', grant_type: 'authorization_code', redirect_uri: CALLBACK,
  });
  assert.equal(me.url, 'https://osu.ppy.sh/api/v2/me');
  assert.equal(me.headers.Authorization, 'Bearer tok-abc');
  assert.equal(revoke.url, 'https://osu.ppy.sh/api/v2/oauth/tokens/current');
  assert.equal(revoke.method, 'DELETE');
  assert.equal(calls.length, 3);
});

test('a callback marked for an unknown site, or not marked, stays on the release site', async () => {
  for (const osuState of [`x.${STATE}`, STATE]) {
    const res = await get(`/auth/callback?code=c&state=${osuState}`);
    assert.deepEqual(signinParams(res, RELEASE), { id: '4158549', name: 'Tristan', state: STATE }, osuState);
  }
});

test('both routes refuse a missing or malformed state', async () => {
  for (const path of ['/auth/login', '/auth/login?state=short', '/auth/login?state=has%20space%20in%20it%20yes', `/auth/login?state=d.${STATE}`,
    '/auth/callback?code=x', '/auth/callback?code=x&state=<script>aaaaaaaaaaaaaaa', `/auth/callback?code=x&state=dev.${STATE}`,
    `${DEV}/auth/login?state=short`]) {
    const res = await get(path);
    assert.equal(res.status, 400, path);
  }
  assert.equal(calls.length, 0);
});

test('a visitor who presses Cancel on osu! comes back to their own site with error=denied', async () => {
  const res = await get(`/auth/callback?error=access_denied&state=d.${STATE}`);
  assert.deepEqual(signinParams(res, DEV), { error: 'denied', state: STATE });
  assert.equal(calls.length, 0);
});

test('osu! failures come back as error=osu, never as a crash', async () => {
  const cases = [
    () => { osu.token = { status: 400, body: { error: 'invalid_grant' } }; },
    () => { osu.token = { status: 200, body: {} }; },
    () => { osu.me = { status: 401, body: { authentication: 'basic' } }; },
    () => { osu.me = { status: 200, body: { id: 'nope' } }; },
    () => { osu.token = { throws: true }; },
  ];
  for (const breakIt of cases) {
    breakIt();
    const res = await get(`/auth/callback?code=c&state=p.${STATE}`);
    assert.equal(res.status, 302);
    assert.deepEqual(signinParams(res), { error: 'osu', state: STATE });
    osu = { token: { status: 200, body: { access_token: 't' } }, me: { status: 200, body: { id: 1, username: 'x' } } };
  }
});

test('without its keys, the release site says so instead of half-working', async () => {
  const login = await get(`/auth/login?state=${STATE}`, { OSU_CLIENT_SECRET: 'shh-secret' });
  assert.equal(login.status, 503);
  const cb = await get(`/auth/callback?code=c&state=p.${STATE}`, { OSU_CLIENT_ID: '123' });
  assert.equal(cb.status, 503);
  assert.equal(calls.length, 0);
});
