// Tests for the sign-in Functions against a fake osu! (global fetch is swapped out). Run: npm test

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as loginRoute } from '../functions/auth/login.js';
import { onRequestGet as callbackRoute } from '../functions/auth/callback.js';

const env = { OSU_CLIENT_ID: '123', OSU_CLIENT_SECRET: 'shh-secret' };
const STATE = 'AbCdEfGhIjKlMnOpQrStUv';
const SITE = 'https://ptcatch.com';

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

const get = (path, e = env) => {
  const request = new Request(SITE + path);
  const route = path.startsWith('/auth/login') ? loginRoute : callbackRoute;
  return route({ request, env: e });
};
const signinParams = res => {
  const to = new URL(res.headers.get('Location'));
  assert.equal(to.origin + to.pathname, `${SITE}/`);
  assert.ok(to.hash.startsWith('#signin?'), to.hash);
  return Object.fromEntries(new URLSearchParams(to.hash.slice('#signin?'.length)));
};

test('/auth/login redirects to osu! authorize with identify scope, the callback URL and the state', async () => {
  const res = await get(`/auth/login?state=${STATE}`);
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://osu.ppy.sh/oauth/authorize');
  assert.deepEqual(Object.fromEntries(to.searchParams), {
    client_id: '123', redirect_uri: `${SITE}/auth/callback`, response_type: 'code', scope: 'identify', state: STATE,
  });
  assert.ok(!res.headers.get('Location').includes('shh-secret'));
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('both routes refuse a missing or malformed state', async () => {
  for (const path of ['/auth/login', '/auth/login?state=short', '/auth/login?state=has%20space%20in%20it%20yes', '/auth/callback?code=x', '/auth/callback?code=x&state=<script>aaaaaaaaaaaaaaa']) {
    const res = await get(path);
    assert.equal(res.status, 400, path);
  }
  assert.equal(calls.length, 0);
});

test('/auth/callback trades the code, reads /me, revokes the token and returns only id, name and state', async () => {
  const res = await get(`/auth/callback?code=the-code&state=${STATE}`);
  assert.equal(res.status, 302);
  assert.deepEqual(signinParams(res), { id: '4158549', name: 'Tristan', state: STATE });
  assert.ok(!res.headers.get('Location').includes('tok-abc'), 'the token never reaches the browser');
  assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');

  const [token, me, revoke] = calls;
  assert.equal(token.url, 'https://osu.ppy.sh/oauth/token');
  assert.equal(token.method, 'POST');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(token.body)), {
    client_id: '123', client_secret: 'shh-secret', code: 'the-code', grant_type: 'authorization_code', redirect_uri: `${SITE}/auth/callback`,
  });
  assert.equal(me.url, 'https://osu.ppy.sh/api/v2/me');
  assert.equal(me.headers.Authorization, 'Bearer tok-abc');
  assert.equal(revoke.url, 'https://osu.ppy.sh/api/v2/oauth/tokens/current');
  assert.equal(revoke.method, 'DELETE');
  assert.equal(calls.length, 3);
});

test('a visitor who presses Cancel on osu! comes back with error=denied', async () => {
  const res = await get(`/auth/callback?error=access_denied&state=${STATE}`);
  assert.deepEqual(signinParams(res), { error: 'denied', state: STATE });
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
    const res = await get(`/auth/callback?code=c&state=${STATE}`);
    assert.equal(res.status, 302);
    assert.deepEqual(signinParams(res), { error: 'osu', state: STATE });
    osu = { token: { status: 200, body: { access_token: 't' } }, me: { status: 200, body: { id: 1, username: 'x' } } };
  }
});

test('without its secrets, sign-in says so instead of half-working', async () => {
  for (const path of [`/auth/login?state=${STATE}`, `/auth/callback?code=c&state=${STATE}`]) {
    const res = await get(path, { ...env, OSU_CLIENT_SECRET: '' });
    assert.equal(res.status, 503, path);
  }
  assert.equal(calls.length, 0);
});
