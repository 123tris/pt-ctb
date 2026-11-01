// The Bananas endpoints (Pages Functions in functions/api/daily, wallet and economy call these). Players' ones need the
// session token from /auth/callback (signin/session.js); the bot's need ECONOMY_INBOX_KEY. The site never moves money:
// players' requests are queued for the bot, which judges them and acks (economy/store.js).
//
//   GET  /api/daily                today's paying daily game, as far as this player has got: the options, their
//                                  guesses, and the answer only once it's over
//   POST /api/daily/guess          { guess: option index }
//   GET  /api/daily/cover?day=…    that day's cover image, served from here so its address doesn't name the map
//   POST /api/wallet/request       { type, payload } → { requestId }
//   GET  /api/wallet/requests      the player's requests and what the bot said
//   POST /api/admin/request        { type: 'admin.…', payload } → { requestId }, for admins only (contract §8)
//   GET  /api/admin/requests       an admin's own admin requests and what the bot said
//   GET  /api/economy/inbox?since  for the bot: sign-ins, finished daily games and requests since a cursor
//   POST /api/economy/ack          for the bot: { cursor, results: [{ requestId, status, reason, code }] }
//
// Needs the ECONOMY database binding and OSU_CLIENT_SECRET (sessions); the daily game also DAILY_SEED. Without them
// these answer 503, and the site hides what needs them. Admins are the osu! ids in ADMIN_OSU_IDS (comma-separated;
// unset or empty means ADMIN_DEFAULT). The bot checks its own list again: this only keeps everyone else out early.

import { sessionOf } from '../signin/session.js';
import * as store from './store.js';
import { pickRound, quizSets } from './daily.js';

const nowSec = () => Math.floor(Date.now() / 1000);

// Pages doesn't apply _headers to Functions, so these responses carry their own.
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const problem = (error, status) => json({ error }, status);

const NOT_HERE = 'Bananas aren’t set up on this copy of the site.';
const SIGN_IN = 'Sign in with osu! first (or again: a sign-in lasts 30 days).';

/** The signed-in player's osu! id and the database, or the Response to send instead. */
async function player(request, env, now) {
  if (!env.ECONOMY || !env.OSU_CLIENT_SECRET) return { response: problem(NOT_HERE, 503) };
  const osuId = await sessionOf(request, env, now);
  return osuId ? { osuId, db: env.ECONOMY } : { response: problem(SIGN_IN, 401) };
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > 4000) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// ---- The daily game -------------------------------------------------------------------------------------------------

/** Today's round, picked and kept on the day's first request. */
async function todaysRound(env, day) {
  return (await store.readRound(env.ECONOMY, day)) ?? store.keepRound(env.ECONOMY, await pickRound(env.DAILY_SEED, day, await quizSets(env.DATA_URL || undefined)));
}

/** What the browser may know: the options always, the answer and its map only once the game is over. */
function gameView(round, game) {
  const view = {
    day: round.day,
    options: round.options.map(([, artist, title]) => ({ artist, title })),
    tries: game.tries, triesLeft: store.TRIES - game.tries, guesses: game.guesses, solved: game.solved, done: game.done,
    cover: `/api/daily/cover?day=${round.day}`,
  };
  if (game.done) {
    const [setId, artist, title, mapper] = round.options[round.answer];
    view.answer = { index: round.answer, setId, artist, title, mapper };
  }
  return view;
}

export async function daily(request, env, now = nowSec()) {
  const who = await player(request, env, now);
  if (who.response) return who.response;
  if (!env.DAILY_SEED) return problem(NOT_HERE, 503);
  const day = store.lisbonDay(now);
  const round = await todaysRound(env, day);
  return json(gameView(round, await store.readGame(who.db, day, who.osuId)));
}

export async function dailyGuess(request, env, now = nowSec()) {
  const who = await player(request, env, now);
  if (who.response) return who.response;
  if (!env.DAILY_SEED) return problem(NOT_HERE, 503);
  const body = await readBody(request);
  const choice = body?.guess;
  if (!Number.isInteger(choice) || choice < 0 || choice >= 6) return problem('Pick one of the six maps.', 400);
  const day = store.lisbonDay(now);
  const round = await todaysRound(env, day);
  const { game, error } = await store.guess(who.db, round, who.osuId, choice, now);
  if (error === 'over') return json({ ...gameView(round, game), error: 'You’ve played today’s map. A new one comes at midnight, Lisbon time.' }, 409);
  if (error) return json({ ...gameView(round, game), error: 'You already tried that one.' }, 409);
  return json(gameView(round, game));
}

/** The cover of a day's map (one that has a round), proxied so the browser never sees which set it is. */
export async function dailyCover(request, env, now = nowSec()) {
  if (!env.ECONOMY) return problem(NOT_HERE, 503);
  const day = new URL(request.url).searchParams.get('day') ?? '';
  if (!/^\d{4}-\d\d-\d\d$/.test(day) || day > store.lisbonDay(now)) return problem('No such day.', 404);
  const round = await store.readRound(env.ECONOMY, day);
  if (!round) return problem('No such day.', 404);
  const art = await fetch(`https://assets.ppy.sh/beatmaps/${round.options[round.answer][0]}/covers/cover.jpg`, { cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!art.ok) return problem('The cover couldn’t be loaded.', 502);
  return new Response(art.body, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  });
}

// ---- Spending requests ----------------------------------------------------------------------------------------------

export async function walletRequest(request, env, now = nowSec()) {
  const who = await player(request, env, now);
  if (who.response) return who.response;
  const parsed = store.parseRequest(await readBody(request), who.osuId);
  if (parsed.error) return problem(parsed.error, 400);
  const queued = await store.queueRequest(who.db, who.osuId, parsed, now);
  return queued.error ? problem(queued.error, queued.status) : json({ requestId: queued.requestId }, 202);
}

export async function walletRequests(request, env, now = nowSec()) {
  const who = await player(request, env, now);
  if (who.response) return who.response;
  return json({ requests: await store.listRequests(who.db, who.osuId) });
}

// ---- Admin requests --------------------------------------------------------------------------------------------------

export const ADMIN_DEFAULT = [3821475, 6205809];
/** The admins' osu! ids, from ADMIN_OSU_IDS or the default. */
export function adminIds(env) {
  const ids = String(env.ADMIN_OSU_IDS ?? '').split(',').map(s => Number(s.trim())).filter(n => Number.isSafeInteger(n) && n > 0);
  return ids.length ? ids : ADMIN_DEFAULT;
}

/** Like player(), and then 403 for anyone who isn't an admin. */
async function admin(request, env, now) {
  const who = await player(request, env, now);
  if (who.response) return who;
  return adminIds(env).includes(who.osuId) ? who : { response: problem('Admins only.', 403) };
}

export async function adminRequest(request, env, now = nowSec()) {
  const who = await admin(request, env, now);
  if (who.response) return who.response;
  const parsed = store.parseAdminRequest(await readBody(request));
  if (parsed.error) return problem(parsed.error, 400);
  const queued = await store.queueRequest(who.db, who.osuId, parsed, now);
  return queued.error ? problem(queued.error, queued.status) : json({ requestId: queued.requestId }, 202);
}

export async function adminRequests(request, env, now = nowSec()) {
  const who = await admin(request, env, now);
  if (who.response) return who.response;
  return json({ requests: await store.listRequests(who.db, who.osuId, 50, { admin: true }) });
}

// ---- The bot's inbox ------------------------------------------------------------------------------------------------

/** True when the request carries "Authorization: Bearer <ECONOMY_INBOX_KEY>", compared in constant time. */
async function isBot(request, env) {
  const key = env.ECONOMY_INBOX_KEY;
  const [, given] = (request.headers.get('Authorization') ?? '').match(/^Bearer\s+(\S+)$/) ?? [];
  if (!key || !given) return false;
  // Hash both first, so the comparison takes the same time whatever the lengths.
  const digest = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(key), digest(given)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function economyInbox(request, env) {
  if (!env.ECONOMY) return problem(NOT_HERE, 503);
  if (!(await isBot(request, env))) return problem('Only the bot reads the inbox.', 401);
  const since = new URL(request.url).searchParams.get('since');
  const cursor = since ? store.parseCursor(since) : null;
  if (since && !cursor) return problem('since must be a cursor from an earlier answer.', 400);
  return json(await store.inbox(env.ECONOMY, cursor));
}

export async function economyAck(request, env, now = nowSec()) {
  if (!env.ECONOMY) return problem(NOT_HERE, 503);
  if (!(await isBot(request, env))) return problem('Only the bot acks the inbox.', 401);
  const body = await readBody(request);
  const cursor = body?.cursor ?? null;
  const results = Array.isArray(body?.results) ? body.results : null;
  if ((cursor !== null && !store.parseCursor(cursor)) || !results || results.length > 1000) return problem('The ack needs a cursor and a list of results.', 400);
  const clean = results.filter(r => typeof r?.requestId === 'string' && /^[0-9a-f]{24}$/.test(r.requestId) && ['accepted', 'rejected'].includes(r.status))
    .map(r => ({
      requestId: r.requestId, status: r.status, reason: typeof r.reason === 'string' ? r.reason.slice(0, 200) : null,
      code: r.status === 'rejected' && typeof r.code === 'string' && /^[a-z_]{1,40}$/.test(r.code) ? r.code : null,
    }));
  const changed = await store.ack(env.ECONOMY, { cursor, results: clean }, now);
  return json({ ok: true, updated: changed });
}
