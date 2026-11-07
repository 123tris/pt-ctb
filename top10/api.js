// The Top 10 of the year endpoints (TOP10-DESIGN.md §13.3, in the bot's repo), called by the Pages Functions in
// functions/api/top10/. Signed-in ones take the session token from /auth/callback (signin/session.js) as
// "Authorization: Bearer <token>"; JSON in and out; request bodies up to 64 KB. Refusals are { error, code } (code: a
// short machine word the UI can translate) with a 4xx status.
//
//   GET    /api/top10                    { season: { year, opens, closes, reveal, thanksUntil, phase }, turnout,
//                                        finalized }, plus me: { osuId, eligible, code?, reason?, ballot } signed in
//   GET    /api/top10/ballots?year=      every submitted ballot, first submitted first, with its write-ups (struck ones
//                                        left out) and whether each was thanked: { year, ballots: [{ voter, picks,
//                                        mentions, watch, skills, intro, outro, submittedAt, updated, thanks,
//                                        writeups: { [subject]: { body, words, cites, thanked, updated } } }] }
//   GET    /api/top10/ballot             your ballot (draft or submitted) with your write-ups' words, flags and mod
//                                        notes, and the mod log about your things: { season, eligible, code?, reason?,
//                                        ballot, modlog }
//   PUT    /api/top10/ballot             PT, open. { picks: [{ id, spot }], mentions: [id], watch: [id], intro, outro,
//                                        writeups: { [subject]: { body, cites } } }. A field left out keeps its saved
//                                        value; `writeups` merges (an empty body or null deletes that one), and a
//                                        write-up on anyone no longer listed goes. A submitted ballot stays submitted,
//                                        so it must stay valid. → { ballot }
//   POST   /api/top10/ballot/submit      PT, open. Checks the saved ballot and makes it public. → { ballot }
//   POST   /api/top10/ballot/withdraw    open. Back to draft. → { ballot }
//   GET    /api/top10/plays?year=&player=  the showcase's `ok` entries, most endorsed first: { year, plays: [{ id,
//                                        submitter, player, score, beatmap, caption, clip, created, endorsements,
//                                        endorsed? (signed in) }] }
//   POST   /api/top10/plays              PT, open. { score: osu! score link or id, player?, caption?, clip? } or
//                                        { player, clip, caption? }. → 201 { play }
//   DELETE /api/top10/plays/:id          the submitter. → { ok }
//   POST   /api/top10/plays/:id/endorse  PT. { endorsed? } (left out: toggles). → { endorsed, endorsements }
//   POST   /api/top10/thanks             the subject of a write-up on a public ballot, until thanksUntil.
//                                        { voter, thanked? } (left out: toggles; can't be taken back after finalize).
//                                        → { thanked }
//   GET    /api/top10/results?year=      404 before the reveal (or if the year wasn't finalized); then the results
//                                        JSON (top10/score.js), cached
//   GET    /api/top10/admin/queue?year=  admins. { season, year, finalized, writeups (flagged first), plays (hidden
//                                        too), ballots (drafts as a status only), modlog }; `own` marks what you
//                                        can't act on yourself
//   POST   /api/top10/admin/action       admins. { action: strike | restore | hide-play | show-play | void | unvoid,
//                                        target, reason, year? }. target: { voter, subject } for a write-up, a play
//                                        id, or a voter's osu! id (the queue's "writeup:1:2", "play:3", "ballot:1"
//                                        strings work too). strike, hide-play and void need a reason. → { ok, changed }
//   POST   /api/top10/admin/finalize     admins, once voting has closed. { year, dryRun: true | false }. A dry run
//                                        returns { results, payouts } without saving; the real one, once only, saves
//                                        the results and queues the payouts for the bot (economy `requests`, kinds
//                                        top10.payout and top10.thanks). → { dryRun, results, payouts }
//
// Needs the ECONOMY database binding and OSU_CLIENT_SECRET (sessions); without them these answer 503. The season's
// dates are top10/season.js's, or TOP10_SEASON's. Admins are economy's (ADMIN_OSU_IDS). Who counts as a PT player,
// and every showcased score, is checked against the site's exported data (top10/data.js), never the osu! API.

import { sessionOf } from '../signin/session.js';
import { adminIds, json, problem } from '../economy/api.js';
import { iso } from '../economy/store.js';
import { seasonOf, seasonView, phaseOf } from './season.js';
import { analyse, shingles } from './words.js';
import { computeResults, payoutsFor, spotsValid, MIN_PICKS, MAX_PICKS } from './score.js';
import { ptPlayers, parseScore, findScore, recentOwner, yearOf } from './data.js';
import * as store from './store.js';

const nowSec = () => Math.floor(Date.now() / 1000);

export const LIMITS = {
  body: 64 * 1024, writeup: 4000, intro: 2000, lists: 5, cites: 5, caption: 280, clip: 300, reason: 200, plays: 15, ownPlays: 5,
};
export const CLIP_HOSTS = ['youtube.com', 'youtu.be', 'twitch.tv', 'streamable.com'];
const WRITEUP_ACTIONS = ['strike', 'restore'];
const PLAY_ACTIONS = ['hide-play', 'show-play'];
const BALLOT_ACTIONS = ['void', 'unvoid'];
const NEEDS_REASON = ['strike', 'hide-play', 'void'];

const NOT_HERE = 'The Top 10 isn’t set up on this copy of the site.';
const SIGN_IN = 'Sign in with osu! first (or again: a sign-in lasts 30 days).';
const DATA_DOWN = 'The site’s player data couldn’t be read just now. Try again in a minute.';
const NOT_PT = 'Only PT players on the site can take part: your osu! account isn’t in its list of Portuguese players.';

const refuse = (code, error, status, extra = {}) => json({ error, code, ...extra }, status);

// ---- Who's asking ---------------------------------------------------------------------------------------------------

/** The signed-in player's osu! id, or null (no token, a bad one, or a copy of the site that can't check them). */
const viewerOf = async (request, env, now) => (env.OSU_CLIENT_SECRET ? sessionOf(request, env, now) : null);

/** { osuId, db, season } for a signed-in player, or { response } to send instead. */
async function signedIn(request, env, now) {
  if (!env.ECONOMY || !env.OSU_CLIENT_SECRET) return { response: problem(NOT_HERE, 503) };
  const osuId = await sessionOf(request, env, now);
  return osuId ? { osuId, db: env.ECONOMY, season: seasonOf(env) } : { response: problem(SIGN_IN, 401) };
}

/** Whether an osu! id may take part: { ok: true } or { ok: false, code, reason }. */
async function eligibility(env, osuId) {
  let players;
  try { players = await ptPlayers(env); } catch { return { ok: false, code: 'data_unavailable', reason: DATA_DOWN }; }
  return players.has(osuId) ? { ok: true } : { ok: false, code: 'not_pt', reason: NOT_PT };
}
const eligibleView = e => ({ eligible: e.ok, ...(e.ok ? {} : { code: e.code, reason: e.reason }) });

/** Like signedIn, and then 403 for anyone who isn't a PT player. */
async function ptPlayer(request, env, now) {
  const who = await signedIn(request, env, now);
  if (who.response) return who;
  const e = await eligibility(env, who.osuId);
  return e.ok ? who : { response: refuse(e.code, e.reason, e.code === 'data_unavailable' ? 503 : 403) };
}

/** Like signedIn, and then 403 for anyone who isn't an admin. */
async function admin(request, env, now) {
  const who = await signedIn(request, env, now);
  if (who.response) return who;
  return adminIds(env).includes(who.osuId) ? who : { response: problem('Admins only.', 403) };
}

/** The PT players, or { response } when the data can't be read. */
async function playersOr503(env) {
  try { return { players: await ptPlayers(env) }; } catch { return { response: refuse('data_unavailable', DATA_DOWN, 503) }; }
}

/** null while voting is open; otherwise the refusal. */
function unlessOpen(season, now) {
  const phase = phaseOf(season, now);
  if (phase === 'open') return null;
  return phase === 'before'
    ? refuse('not_open', `Voting opens on ${season.opens.slice(0, 10)}.`, 409, { phase })
    : refuse('closed', 'Voting has closed.', 409, { phase });
}

// ---- Reading what was sent ------------------------------------------------------------------------------------------

/** The JSON object sent: { body }, { body: null } when it isn't one, or { tooBig }. An empty body reads as {}. */
async function readJson(request) {
  if (Number(request.headers.get('Content-Length')) > LIMITS.body * 4) return { tooBig: true };
  const text = await request.text();
  if (text.length > LIMITS.body) return { tooBig: true };
  if (!text.trim()) return { body: {} };
  try {
    const body = JSON.parse(text);
    return { body: body && typeof body === 'object' && !Array.isArray(body) ? body : null };
  } catch { return { body: null }; }
}
const badBody = read => (read.tooBig ? refuse('too_big', 'That’s more than 64 KB at once.', 413) : refuse('bad_json', 'Send a JSON object.', 400));

/** ?year=, or the season's year; null when it isn't a year. */
function yearParam(request, season) {
  const raw = new URL(request.url).searchParams.get('year');
  if (raw === null || raw === '') return season.year;
  return /^\d{4}$/.test(raw) ? Number(raw) : null;
}

const toId = v => {
  const n = typeof v === 'string' && /^\d{1,10}$/.test(v) ? Number(v) : v;
  return Number.isSafeInteger(n) && n > 0 && n < 1e10 ? n : null;
};

// Control characters (but newlines and tabs) and bidi overrides.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;
/** Text as typed: newlines kept (CRLF as LF), other control characters out, trimmed; null if it isn't text. */
const cleanText = v => (typeof v === 'string' ? v.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROL, '').trim() : null);
/** One line of text: like cleanText, with every run of whitespace a single space. */
const cleanLine = v => cleanText(v)?.replace(/\s+/g, ' ') ?? null;

function readPicks(v) {
  if (!Array.isArray(v)) return null;
  const picks = v.map(p => ({ id: toId(p?.id), spot: Number.isSafeInteger(p?.spot) ? p.spot : null }));
  return picks.every(p => p.id && p.spot) ? picks : null;
}
function readIds(v) {
  if (!Array.isArray(v)) return null;
  const ids = v.map(toId);
  return ids.every(Boolean) ? ids : null;
}

/** A cited score: its S.ID in the site's data (negative for a legacy score), or "p<id>" for a showcase entry. */
function citeOf(v) {
  if (Number.isSafeInteger(v) && v !== 0 && Math.abs(v) < 1e15) return v;
  if (typeof v === 'string' && /^-?\d{1,15}$/.test(v) && Number(v) !== 0) return Number(v);
  if (typeof v === 'string' && /^p\d{1,10}$/.test(v)) return v;
  return null;
}
function readCites(v) {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.length > LIMITS.cites) return null;
  const cites = v.map(citeOf);
  return cites.every(c => c !== null) ? [...new Set(cites)] : null;
}

/** A clip link on an allowed site, as https; undefined for anything else. */
function clipOf(v) {
  if (typeof v !== 'string' || v.length > LIMITS.clip) return undefined;
  let url;
  try { url = new URL(v.trim()); } catch { return undefined; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return undefined;
  const host = url.hostname.toLowerCase();
  if (!CLIP_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) return undefined;
  url.protocol = 'https:';
  return url.href;
}

/**
 * The ballot rules (§13.3) for a ballot's lists: null when they hold, else [code, message, extra]. `full` adds the
 * minimum of MIN_PICKS, which a draft doesn't need yet.
 */
function listProblem({ picks, mentions, watch }, osuId, players, { full }) {
  if (picks.length > MAX_PICKS) return ['too_many', `Rank at most ${MAX_PICKS} players.`];
  if (full && picks.length < MIN_PICKS) return ['too_few', `Rank at least ${MIN_PICKS} players.`];
  const ranked = picks.map(p => p.id);
  if (new Set(ranked).size !== ranked.length) return ['duplicate', 'Each player can be on your list only once.'];
  if (!spotsValid(picks)) return ['spots', 'Spots start at 1 and go down the list: a tie repeats the spot above it, and the next spot skips (1, 2, 3, 3, 5).'];
  for (const [list, name] of [[mentions, 'honourable mentions'], [watch, 'ones to watch']]) {
    if (list.length > LIMITS.lists) return ['too_many', `At most ${LIMITS.lists} ${name}.`];
    if (new Set(list).size !== list.length) return ['duplicate', `Each player can be in your ${name} only once.`];
    if (list.some(id => ranked.includes(id))) return ['overlap', `Your ${name} can’t include players you ranked.`];
  }
  const all = [...ranked, ...mentions, ...watch];
  if (all.includes(osuId)) return ['self', 'You can’t vote for yourself.'];
  const unknown = all.find(id => !players.has(id));
  if (unknown) return ['not_pt', `${unknown} isn’t a PT player on the site.`, { id: unknown }];
  return null;
}

// ---- Views ----------------------------------------------------------------------------------------------------------

/** A ballot as its owner sees it: write-ups keyed by subject, with words, flags and the mods' note. */
function ownView(ballot) {
  if (!ballot) return null;
  const { writeups, ...rest } = ballot;
  return {
    ...rest,
    writeups: Object.fromEntries(writeups.map(w => [w.subject, {
      body: w.body, words: w.words, cites: w.cites, flags: w.flags, mod: w.mod, modReason: w.modReason, thanked: w.thanked, updated: iso(w.updated),
    }])),
  };
}

/** A JSON answer that's the same for everyone, kept in the Cache API for `seconds` (where there is one). */
async function cachedJson(request, key, seconds, build) {
  const cache = globalThis.caches?.default;
  const url = new URL(`/api/top10/cache/${key}`, request.url).href;
  if (cache) {
    const hit = await cache.match(url).catch(() => null);
    if (hit) return json(await hit.json());
  }
  const body = await build();
  if (cache) await cache.put(url, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${seconds}` } })).catch(() => {});
  return json(body);
}

// ---- The hub and the ballots ----------------------------------------------------------------------------------------

export async function hub(request, env, now = nowSec()) {
  if (!env.ECONOMY) return problem(NOT_HERE, 503);
  const db = env.ECONOMY;
  const season = seasonOf(env);
  const [turnout, finalized] = await Promise.all([store.turnout(db, season.year), store.finalizedAt(db, season.year)]);
  const body = { season: seasonView(season, now), turnout, finalized: Boolean(finalized) };
  const osuId = await viewerOf(request, env, now);
  if (osuId) {
    const [e, ballot] = await Promise.all([eligibility(env, osuId), store.readBallot(db, season.year, osuId)]);
    body.me = { osuId, ...eligibleView(e), ballot: ownView(ballot) };
  }
  return json(body);
}

export async function ballots(request, env, now = nowSec()) {
  if (!env.ECONOMY) return problem(NOT_HERE, 503);
  const year = yearParam(request, seasonOf(env));
  if (!year) return refuse('year', 'year must be a year, like 2026.', 400);
  return cachedJson(request, `ballots/${year}`, 15, async () => ({ year, ballots: await store.publicBallots(env.ECONOMY, year) }));
}

export async function myBallot(request, env, now = nowSec()) {
  const who = await signedIn(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const [e, ballot, modlog] = await Promise.all([eligibility(env, osuId), store.readBallot(db, season.year, osuId), store.modlogAbout(db, season.year, osuId)]);
  return json({ season: seasonView(season, now), ...eligibleView(e), ballot: ownView(ballot), modlog });
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function saveBallot(request, env, now = nowSec()) {
  const who = await ptPlayer(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const year = season.year;
  const shut = unlessOpen(season, now);
  if (shut) return shut;
  const read = await readJson(request);
  if (!read.body) return badBody(read);
  const body = read.body;
  const saved = await store.readBallot(db, year, osuId);
  if (saved?.status === 'void') return refuse('void', `This ballot was voided: ${saved.voidReason}`, 403, { reason: saved.voidReason });

  const lists = {
    picks: 'picks' in body ? readPicks(body.picks) : saved?.picks ?? [],
    mentions: 'mentions' in body ? readIds(body.mentions) : saved?.mentions ?? [],
    watch: 'watch' in body ? readIds(body.watch) : saved?.watch ?? [],
  };
  if (!lists.picks || !lists.mentions || !lists.watch) return refuse('shape', 'picks is a list of { id, spot }; mentions and watch are lists of osu! ids.', 400);
  const texts = {
    intro: 'intro' in body ? cleanText(body.intro ?? '') : saved?.intro ?? '',
    outro: 'outro' in body ? cleanText(body.outro ?? '') : saved?.outro ?? '',
  };
  if (texts.intro === null || texts.outro === null) return refuse('shape', 'intro and outro are text.', 400);
  if (texts.intro.length > LIMITS.intro || texts.outro.length > LIMITS.intro) return refuse('too_long', `The intro and the closing message can be ${LIMITS.intro} characters each.`, 400);
  const { players, response } = await playersOr503(env);
  if (response) return response;
  const listed = listProblem(lists, osuId, players, { full: saved?.status === 'submitted' });
  if (listed) return refuse(listed[0], saved?.status === 'submitted' ? `${listed[1]} (Your ballot is submitted, so it has to stay complete; withdraw it to keep a draft.)` : listed[1], 400, listed[2]);

  // The write-ups: merge the edits over what's saved.
  const order = [...new Set([...lists.picks.map(p => p.id), ...lists.mentions, ...lists.watch])];
  const current = new Map((saved?.writeups ?? []).map(w => [w.subject, w]));
  const incoming = body.writeups ?? {};
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return refuse('shape', 'writeups maps an osu! id to { body, cites }.', 400);
  const final = new Map([...current].filter(([subject]) => order.includes(subject)).map(([subject, w]) => [subject, { body: w.body, cites: w.cites }]));
  for (const [key, value] of Object.entries(incoming)) {
    const subject = toId(key);
    if (!subject || (value !== null && (typeof value !== 'object' || Array.isArray(value)))) return refuse('shape', 'writeups maps an osu! id to { body, cites }.', 400);
    if (value === null) { final.delete(subject); continue; }
    const text = 'body' in value ? cleanText(value.body ?? '') : current.get(subject)?.body ?? '';
    const cites = 'cites' in value ? readCites(value.cites) : current.get(subject)?.cites ?? [];
    if (text === null || cites === null) return refuse('shape', `A write-up is { body: text, cites: up to ${LIMITS.cites} scores }.`, 400);
    if (text.length > LIMITS.writeup) return refuse('too_long', `A write-up can be ${LIMITS.writeup} characters.`, 400, { id: subject });
    if (!text) { final.delete(subject); continue; }
    if (!order.includes(subject)) return refuse('not_listed', 'Write-ups are only for players on your list, honourable mentions or ones to watch.', 400, { id: subject });
    final.set(subject, { body: text, cites });
  }

  // Count and flag the write-ups whose text changed; a new text of a struck write-up is the writer's fix.
  const upserts = [];
  let others = null;
  for (const subject of order) {
    const next = final.get(subject);
    const before = current.get(subject);
    if (!next || (before && before.body === next.body && sameJson(before.cites, next.cites))) continue;
    if (before && before.body === next.body) {
      upserts.push({ ...before, cites: next.cites });
      continue;
    }
    others ??= (await store.otherBodies(db, year, osuId)).map(o => shingles(o.body));
    const earlier = order.slice(0, order.indexOf(subject)).map(s => final.get(s)?.body).filter(Boolean);
    const { words, flags } = analyse(next.body, [...others, ...earlier]);
    upserts.push({ subject, body: next.body, words, flags, cites: next.cites, mod: 'ok', modReason: null });
  }
  const removed = [...current.keys()].some(subject => !final.has(subject));
  const same = saved && !upserts.length && !removed && sameJson([saved.picks, saved.mentions, saved.watch, saved.intro, saved.outro], [lists.picks, lists.mentions, lists.watch, texts.intro, texts.outro]);
  if (!same) {
    const ok = await store.saveBallot(db, { year, voter: osuId, ...lists, ...texts }, { upserts, keep: [...final.keys()] }, now);
    if (!ok) return refuse('void', 'This ballot was voided.', 403);
  }
  return json({ ballot: ownView(await store.readBallot(db, year, osuId)) });
}

export async function submitBallot(request, env, now = nowSec()) {
  const who = await ptPlayer(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const shut = unlessOpen(season, now);
  if (shut) return shut;
  const saved = await store.readBallot(db, season.year, osuId);
  if (!saved) return refuse('no_ballot', 'Save your list first.', 400);
  if (saved.status === 'void') return refuse('void', `This ballot was voided: ${saved.voidReason}`, 403, { reason: saved.voidReason });
  if (saved.status === 'draft') {
    const { players, response } = await playersOr503(env);
    if (response) return response;
    const listed = listProblem(saved, osuId, players, { full: true });
    if (listed) return refuse(listed[0], listed[1], 400, listed[2]);
    await store.submitBallot(db, season.year, osuId, now);
  }
  return json({ ballot: ownView(await store.readBallot(db, season.year, osuId)) });
}

export async function withdrawBallot(request, env, now = nowSec()) {
  const who = await signedIn(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const shut = unlessOpen(season, now);
  if (shut) return shut;
  const saved = await store.readBallot(db, season.year, osuId);
  if (!saved) return refuse('no_ballot', 'You have no ballot to withdraw.', 404);
  if (saved.status === 'void') return refuse('void', `This ballot was voided: ${saved.voidReason}`, 403, { reason: saved.voidReason });
  if (saved.status === 'submitted') await store.withdrawBallot(db, season.year, osuId, now);
  return json({ ballot: ownView(await store.readBallot(db, season.year, osuId)) });
}

// ---- Thanks ---------------------------------------------------------------------------------------------------------

export async function thank(request, env, now = nowSec()) {
  const who = await signedIn(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const year = season.year;
  const read = await readJson(request);
  if (!read.body) return badBody(read);
  const voter = toId(read.body.voter);
  if (!voter) return refuse('shape', 'Say whose write-up: { voter: their osu! id }.', 400);
  if (read.body.thanked !== undefined && typeof read.body.thanked !== 'boolean') return refuse('shape', 'thanked is true or false.', 400);
  if (now > season.at.thanksUntil) return refuse('thanks_closed', `Thanks closed on ${season.thanksUntil.slice(0, 10)}.`, 409);
  const ballot = await store.ballotStatus(db, year, voter);
  if (ballot?.status !== 'submitted') return refuse('not_public', 'That ballot isn’t public.', 404);
  const writeup = await store.readWriteup(db, year, voter, osuId);
  if (writeup?.mod !== 'ok') return refuse('no_writeup', 'There’s no write-up about you on that ballot.', 404);
  const [already, finalized] = await Promise.all([store.hasMark(db, year, 'thanks', osuId, voter), store.finalizedAt(db, year)]);
  const want = read.body.thanked ?? !already;
  if (finalized) {
    if (!want) return already ? refuse('final', 'Thanks can’t be taken back once the results are final.', 409) : json({ thanked: false });
    // The bananas follow at once, if the ballot counted in the results.
    if (ballot.updated <= season.at.closes) await store.thankAfterFinalize(db, year, osuId, voter, now);
    else await store.setMark(db, year, 'thanks', osuId, voter, true, now);
    return json({ thanked: true });
  }
  if (want !== already) await store.setMark(db, year, 'thanks', osuId, voter, want, now);
  return json({ thanked: want });
}

// ---- The showcase ---------------------------------------------------------------------------------------------------

const publicPlay = ({ status, reason, ...play }) => play;

export async function plays(request, env, now = nowSec()) {
  if (!env.ECONOMY) return problem(NOT_HERE, 503);
  const season = seasonOf(env);
  const year = yearParam(request, season);
  if (!year) return refuse('year', 'year must be a year, like 2026.', 400);
  const raw = new URL(request.url).searchParams.get('player');
  const player = raw ? toId(raw) : null;
  if (raw && !player) return refuse('shape', 'player is an osu! id.', 400);
  const viewer = await viewerOf(request, env, now);
  const list = () => store.listPlays(env.ECONOMY, year, { player, viewer });
  if (viewer) return json({ year, plays: (await list()).map(publicPlay) });
  return cachedJson(request, `plays/${year}/${player ?? 'all'}`, 15, async () => ({ year, plays: (await list()).map(publicPlay) }));
}

const NOT_IN_DATA = 'That score isn’t in the site’s data yet: add it with /addscore first, or attach a clip.';

/** The showcased score's owner and tuple, or a refusal: checked against the site's data, never osu!. */
async function resolveScore(env, osuId, input, named, players, year) {
  const parsed = parseScore(input);
  if (!parsed) return { response: refuse('score', 'That isn’t an osu! score link or id.', 400) };
  if (parsed.error) return { response: refuse('mode', 'That score wasn’t set in osu!catch.', 400) };
  if (named && !players.has(named)) return { response: refuse('not_pt', 'That player isn’t a PT player on the site.', 422) };
  let found;
  try {
    found = await findScore(env, named ?? osuId, parsed.ids);
    if (!found && !named) {
      // Not the submitter's own: the recent plays may say whose it is.
      const owner = await recentOwner(env, parsed.ids);
      if (owner && owner !== osuId && players.has(owner)) found = await findScore(env, owner, parsed.ids);
    }
  } catch {
    return { response: refuse('data_unavailable', DATA_DOWN, 503) };
  }
  if (!found) return { response: refuse('not_in_data', named ? NOT_IN_DATA : `${NOT_IN_DATA} If it’s someone else’s score, say whose (player).`, 422) };
  if (!players.has(found.player)) return { response: refuse('not_pt', 'That score isn’t a PT player’s.', 422) };
  if (yearOf(found.time) !== year) return { response: refuse('wrong_year', `That score was set in ${yearOf(found.time)}; the showcase is for ${year}’s.`, 422, { year: yearOf(found.time) }) };
  return { found };
}

export async function addPlay(request, env, now = nowSec()) {
  const who = await ptPlayer(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const year = season.year;
  const shut = unlessOpen(season, now);
  if (shut) return shut;
  const read = await readJson(request);
  if (!read.body) return badBody(read);
  const body = read.body;
  const given = v => v !== undefined && v !== null && v !== '';
  const caption = given(body.caption) ? cleanLine(body.caption) : '';
  if (caption === null) return refuse('shape', 'caption is text.', 400);
  if (caption.length > LIMITS.caption) return refuse('too_long', `A caption can be ${LIMITS.caption} characters.`, 400);
  const clip = given(body.clip) ? clipOf(body.clip) : null;
  if (clip === undefined) return refuse('clip', `A clip must be a link on ${CLIP_HOSTS.join(', ')}.`, 400);
  const named = given(body.player) ? toId(body.player) : null;
  if (given(body.player) && !named) return refuse('shape', 'player is an osu! id.', 400);
  if (!given(body.score) && (!named || !clip)) return refuse('shape', 'Send a score link, or a player and a clip.', 400);
  const counts = await store.playCounts(db, year, osuId);
  if (counts.all >= LIMITS.plays) return refuse('limit', `That’s ${LIMITS.plays} showcase entries this year: remove one to add another.`, 429);
  const { players, response } = await playersOr503(env);
  if (response) return response;

  let entry;
  if (given(body.score)) {
    const resolved = await resolveScore(env, osuId, body.score, named, players, year);
    if (resolved.response) return resolved.response;
    const { found } = resolved;
    const twin = await store.playByScore(db, year, found.ref);
    if (twin) return refuse('duplicate', 'That score is already in the showcase.', 409, { id: twin.id });
    entry = { player: found.player, ref: found.ref, beatmap: found.beatmap };
  } else {
    if (!players.has(named)) return refuse('not_pt', 'That player isn’t a PT player on the site.', 422);
    entry = { player: named };
  }
  if (entry.player === osuId && counts.own >= LIMITS.ownPlays) return refuse('own_limit', `At most ${LIMITS.ownPlays} of your own plays a year.`, 429);
  try {
    const play = await store.addPlay(db, { year, submitter: osuId, ...entry, caption, clip }, now);
    return json({ play: publicPlay(play) }, 201);
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) return refuse('duplicate', 'That score is already in the showcase.', 409);
    throw e;
  }
}

export async function deletePlay(request, env, id, now = nowSec()) {
  const who = await signedIn(request, env, now);
  if (who.response) return who.response;
  const play = toId(id) ? await store.readPlay(who.db, toId(id)) : null;
  if (!play) return refuse('no_play', 'No such showcase entry.', 404);
  if (play.submitter !== who.osuId) return refuse('not_yours', 'Only whoever added an entry can remove it.', 403);
  await store.deletePlay(who.db, play);
  return json({ ok: true });
}

export async function endorse(request, env, id, now = nowSec()) {
  const who = await ptPlayer(request, env, now);
  if (who.response) return who.response;
  const { osuId, db } = who;
  const read = await readJson(request);
  if (!read.body) return badBody(read);
  if (read.body.endorsed !== undefined && typeof read.body.endorsed !== 'boolean') return refuse('shape', 'endorsed is true or false.', 400);
  const play = toId(id) ? await store.readPlay(db, toId(id)) : null;
  if (play?.status !== 'ok') return refuse('no_play', 'No such showcase entry.', 404);
  const already = await store.hasMark(db, play.year, 'endorse', osuId, play.id);
  const want = read.body.endorsed ?? !already;
  if (want !== already) await store.setMark(db, play.year, 'endorse', osuId, play.id, want, now);
  return json({ endorsed: want, endorsements: await store.endorsements(db, play.year, play.id) });
}

// ---- Results --------------------------------------------------------------------------------------------------------

export async function results(request, env, now = nowSec()) {
  if (!env.ECONOMY) return problem(NOT_HERE, 503);
  const season = seasonOf(env);
  const year = yearParam(request, season);
  if (!year) return refuse('year', 'year must be a year, like 2026.', 400);
  const shown = year < season.year || (year === season.year && now >= season.at.reveal);
  if (!shown) return refuse('not_yet', 'The results aren’t out yet.', 404, year === season.year ? { reveal: season.reveal } : {});
  const cache = globalThis.caches?.default;
  const key = new URL(`/api/top10/cache/results/${year}`, request.url).href;
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
  // Final once saved, so the browser may keep it a while and the edge a day.
  const answer = text => new Response(text, { headers: { ...headers, 'Cache-Control': 'public, max-age=600' } });
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return answer(await hit.text());
  const saved = await store.readResults(env.ECONOMY, year);
  if (!saved?.results) return refuse('not_published', 'There are no results for that year.', 404);
  const text = JSON.stringify(saved.results);
  if (cache) await cache.put(key, new Response(text, { headers: { ...headers, 'Cache-Control': 'public, max-age=86400' } })).catch(() => {});
  return answer(text);
}

// ---- Moderation -----------------------------------------------------------------------------------------------------

export async function adminQueue(request, env, now = nowSec()) {
  const who = await admin(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const year = yearParam(request, season);
  if (!year) return refuse('year', 'year must be a year, like 2026.', 400);
  const [queue, finalized] = await Promise.all([store.adminQueue(db, year), store.finalizedAt(db, year)]);
  return json({
    season: seasonView(season, now), year, finalized: Boolean(finalized),
    writeups: queue.writeups.map(w => ({ ...w, own: w.voter === osuId || w.subject === osuId })),
    plays: queue.plays,
    ballots: queue.ballots.map(b => ({ ...b, own: b.voter === osuId })),
    modlog: queue.modlog,
  });
}

/** An action's target from the body, or null. */
function targetOf(action, t) {
  if (WRITEUP_ACTIONS.includes(action)) {
    if (typeof t === 'string') {
      const m = /^(?:writeup:)?(\d{1,10}):(\d{1,10})$/.exec(t);
      return m ? { voter: Number(m[1]), subject: Number(m[2]) } : null;
    }
    const voter = toId(t?.voter);
    const subject = toId(t?.subject);
    return voter && subject ? { voter, subject } : null;
  }
  const prefix = PLAY_ACTIONS.includes(action) ? 'play' : 'ballot';
  const raw = typeof t === 'string' ? t.replace(new RegExp(`^${prefix}:`), '') : t && typeof t === 'object' ? t[prefix === 'play' ? 'play' : 'voter'] ?? t.id : t;
  const id = toId(raw);
  return id ? (prefix === 'play' ? { play: id } : { voter: id }) : null;
}

export async function adminAction(request, env, now = nowSec()) {
  const who = await admin(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const read = await readJson(request);
  if (!read.body) return badBody(read);
  const { action } = read.body;
  if (![...WRITEUP_ACTIONS, ...PLAY_ACTIONS, ...BALLOT_ACTIONS].includes(action)) return refuse('action', 'action is strike, restore, hide-play, show-play, void or unvoid.', 400);
  let year = read.body.year ?? season.year;
  if (!Number.isSafeInteger(year)) return refuse('year', 'year must be a year, like 2026.', 400);
  const target = targetOf(action, read.body.target);
  if (!target) return refuse('target', 'target is { voter, subject } for a write-up, a play id, or a voter’s osu! id.', 400);
  const reason = read.body.reason === undefined || read.body.reason === null ? '' : cleanLine(read.body.reason);
  if (reason === null || reason.length > LIMITS.reason) return refuse('reason', `The reason is text, up to ${LIMITS.reason} characters.`, 400);
  if (NEEDS_REASON.includes(action) && !reason) return refuse('reason', 'Say why: the player sees the reason.', 400);

  if (PLAY_ACTIONS.includes(action)) {
    const play = await store.readPlay(db, target.play);
    if (!play) return refuse('no_play', 'No such showcase entry.', 404);
    year = play.year;
  } else {
    // No self-moderation (§8, §12): a mod's own write-ups, write-ups about them and their own ballot go to the other mod.
    if (WRITEUP_ACTIONS.includes(action)) {
      if (target.subject === osuId || target.voter === osuId) return refuse('self', 'That write-up is about you (or yours): the other mod handles it.', 403);
      if (!(await store.readWriteup(db, year, target.voter, target.subject))) return refuse('no_writeup', 'No such write-up.', 404);
    } else {
      if (target.voter === osuId) return refuse('self', 'That’s your own ballot: the other mod handles it.', 403);
      if (!(await store.ballotStatus(db, year, target.voter))) return refuse('no_ballot', 'No such ballot.', 404);
    }
    if (await store.finalizedAt(db, year)) return refuse('final', 'The results are final and the payouts queued, so write-ups and ballots can’t change now.', 409);
  }
  const changed = await store.moderate(db, { year, admin: osuId, action, target, reason: reason || null }, now);
  return json({ ok: true, changed });
}

export async function adminFinalize(request, env, now = nowSec()) {
  const who = await admin(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const read = await readJson(request);
  if (!read.body) return badBody(read);
  const { dryRun } = read.body;
  const year = read.body.year ?? season.year;
  if (typeof dryRun !== 'boolean') return refuse('shape', 'Say dryRun: true to preview, or false to finalize for real.', 400);
  if (year !== season.year) return refuse('year', `Only ${season.year}’s season can be finalized.`, 400);
  const phase = phaseOf(season, now);
  if (phase === 'before' || phase === 'open') return refuse('not_closed', 'Voting is still open: finalize once it closes.', 409, { phase });
  const already = await store.finalizedAt(db, year);
  if (already) return refuse('already', `${year} was finalized on ${already}.`, 409, { finalizedAt: already });

  const inputs = await store.finalizeInputs(db, year, season.at.closes);
  const computed = computeResults({ year, ballots: inputs.ballots, writeups: inputs.writeups.filter(w => w.mod === 'ok'), finalizedAt: iso(now) });
  if (computed.error) return refuse('turnout', `Only ${computed.ballots} ballots count; the results need at least 5.`, 409, { ballots: computed.ballots });
  const payouts = payoutsFor({ year, ballots: inputs.ballots, writeups: inputs.writeups, thanks: inputs.thanks });
  if (dryRun) return json({ dryRun: true, results: computed.results, payouts });
  const queued = await store.saveFinal(db, { year, results: computed.results, payouts, admin: osuId }, now);
  if (!queued) return refuse('already', `${year} was already finalized.`, 409);
  return json({ dryRun: false, results: computed.results, payouts: queued });
}
