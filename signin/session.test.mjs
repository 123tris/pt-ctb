// Tests for the 30-day session token (signin/session.js). Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSession, checkSession, sessionOf, sessionExpiry, SESSION_DAYS } from './session.js';
import { makeProof } from './proof.js';

const SECRET = 'shh-secret';
const NOW = 1_790_000_000;

test('a token names its osu! id and lasts 30 days', async () => {
  const token = await makeSession(SECRET, 4158549, NOW);
  assert.match(token, /^4158549\.\d{10}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(sessionExpiry(token), NOW + SESSION_DAYS * 86400);
  assert.equal(await checkSession(SECRET, token, NOW), 4158549);
  assert.equal(await checkSession(SECRET, token, NOW + SESSION_DAYS * 86400 - 1), 4158549);
  assert.equal(await checkSession(SECRET, token, NOW + SESSION_DAYS * 86400), null, 'expired');
});

test('a token can’t be forged, moved to another id, extended or checked without the secret', async () => {
  const token = await makeSession(SECRET, 4158549, NOW);
  const [id, exp, sig] = token.split('.');
  assert.equal(await checkSession('other-secret', token, NOW), null);
  assert.equal(await checkSession(SECRET, `123.${exp}.${sig}`, NOW), null);
  assert.equal(await checkSession(SECRET, `${id}.${Number(exp) + 86400}.${sig}`, NOW), null);
  assert.equal(await checkSession(SECRET, `${id}.${exp}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`, NOW), null);
  assert.equal(await checkSession(undefined, token, NOW), null, 'dev has no secret');
  for (const junk of [null, '', 'x', `${id}.${exp}`, `${token}.x`, 42]) assert.equal(await checkSession(SECRET, junk, NOW), null);
});

test('a usage proof never passes for a session', async () => {
  const proof = await makeProof(SECRET, 4158549, NOW);
  assert.equal(await checkSession(SECRET, `4158549.${proof}`, NOW), null);
});

test('sessionOf reads the Authorization header', async () => {
  const token = await makeSession(SECRET, 7, NOW);
  const req = auth => new Request('https://ptcatch.com/api/wallet/requests', { headers: auth ? { Authorization: auth } : {} });
  assert.equal(await sessionOf(req(`Bearer ${token}`), { OSU_CLIENT_SECRET: SECRET }, NOW), 7);
  assert.equal(await sessionOf(req(token), { OSU_CLIENT_SECRET: SECRET }, NOW), null);
  assert.equal(await sessionOf(req(null), { OSU_CLIENT_SECRET: SECRET }, NOW), null);
});
