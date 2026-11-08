// The Top 10 of the year endpoints (TOP10-DESIGN.md §13.3, in the bot's repo), called by the Pages Functions in
// functions/api/top10/. Signed-in ones take the session token from /auth/callback (signin/session.js) as
// "Authorization: Bearer <token>"; JSON in and out; request bodies up to 64 KB (2 MB with a replay file). Refusals are
// { error, code, …details } with a 4xx status (code: a short machine word the UI can translate; 401 and 503 without a
// code mean "sign in" and "not set up on this copy"). Field names are the contract's columns (§13.2); times are ISO
// strings, except a card's `time` (unix seconds).
//
// Two ballots share each December (§13.11): `kind` 'year' (the top 10 of the year) and 'alltime' (of all time). Every
// endpoint about ballots, write-ups, thanks or results takes it: ?kind= on a GET, a `kind` field on a write. Left out,
// it's 'year', so everything from before the all-time ballot works as it did. An all-time ballot has the same rules,
// except that it has no ones to watch (watch is refused) and a cited map ref is the player's best play on the map in
// any year. The showcase has a `scope` the same way: 'year' (plays set in the season's year, 15 per person, at most 5
// of your own and one for each other player) and 'alltime' ("Legendary plays": any year, 10 per person, at most 5 of your own). Both take entries in
// the showcase's own window, which opens before voting does (top10/season.js showcaseOpens).
//
// Shapes (the endpoints below return these):
//
//   Ballot     { year, kind, voter, status: draft|submitted|void, picks: [{ id, spot }], mentions: [id], watch: [id],
//                skills: null, intro, outro, submitted_at, updated, void_reason, writeups: { [subject]: Writeup },
//                scores: { [ref]: Card } }                      (your own: GET /ballot, PUT, submit, withdraw, me.ballot)
//   Writeup    yours: { body, words, cites: [ref], flags: [repetitive|copy|mash], mod: ok|struck, mod_reason, thanks,
//                updated }; on a public ballot: { body, words, cites, thanks, thanked?, updated }. `thanks` is 0 or 1:
//                only the write-up's subject can thank it. `thanked` (signed in only) is whether you did.
//   Card       a play as shown: { ref, player, map, set, artist, title, version, stars, pp, acc, miss, combo, mods
//                ("HDHR", "NM"), grade, time (unix seconds), url (its osu! page, or null) }, any of them null when not
//                known; a cited showcase entry's also has play (its id) and clip. Resolved once, when the play is
//                submitted or cited (from osu!'s answer, the exported data or the .osr), and stored.
//   Play       a showcase entry: { id, year, scope, submitter, player, score_ref, beatmap_id, caption, clip, created, played,
//                endorsements, endorsed? (signed in), score: Card | null, replay }, plus status, reason and target in the
//                admin queue. replay: { kind: 'osu', url } (osu!'s own download, which needs the visitor signed in on
//                osu!; only when osu! keeps it), { kind: 'file', url, name } (an uploaded .osr on data.ptcatch.com,
//                served as an attachment named `name`), or null.
//   Refs       how a play is named (top10/refs.js): osu:<id> (a lazer score id), legacy:<id> (a stable one),
//                map:<beatmap>:<player> (that player's best play on that map set in the season's year, in the exported
//                data; in any year on an all-time ballot or among the Legendary plays), play:<id> (a showcase entry;
//                cites only). Score links, bare numbers, "map:<beatmap>" with the player given apart and "p<id>" are
//                read too, and answered in this canonical form.
//
//   GET    /api/top10                    { season: { year, showcaseOpens, opens, closes, reveal, thanksUntil, phase,
//                                        showcase: before|open|closed }, turnout (the
//                                        yearly ballots submitted, a whole number: the deployed bot reads it),
//                                        turnouts: { year, alltime }, finalized, editions: [{ year, kind, label }]
//                                        (results that are out) }, plus me: { osuId, eligible, code?, reason?,
//                                        ballot (the yearly one), ballots: { year, alltime } } signed in (each a
//                                        Ballot or null)
//   GET    /api/top10/ballots?year=&kind=  { year, kind, ballots: [{ voter, kind, picks, mentions, watch, skills, intro, outro,
//                                        submitted_at, updated, thanks (total), writeups: { [subject]: Writeup },
//                                        scores: { [ref]: Card } }] }: every submitted ballot, first submitted first;
//                                        struck write-ups and void ballots left out
//   GET    /api/top10/ballot?kind=       { season, kind, eligible, code?, reason?, ballot: Ballot | null, log } (log: the
//                                        mod actions on both your ballots, your write-ups and showcase entries, each
//                                        with its kind)
//   PUT    /api/top10/ballot             PT, open. { kind?, picks, mentions, watch, intro, outro, writeups: { [subject]:
//                                        { body, cites: [ref] } } }. A field left out keeps its saved value;
//                                        `writeups` merges (an empty body or null deletes that one); a write-up on
//                                        anyone no longer listed goes. Up to 5 cites a write-up; a map ref without a
//                                        player is the subject's; each is checked and its card stored. A submitted
//                                        ballot stays submitted, so it must stay valid. → { ballot }
//   POST   /api/top10/ballot/submit      PT, open. { kind? }. Checks the saved ballot and makes it public. → { ballot }
//   POST   /api/top10/ballot/withdraw    open. { kind? }. Back to draft. → { ballot }
//   GET    /api/top10/plays?year=&scope=&player=  { year, scope, plays: [Play] }: the `ok` entries, most endorsed first
//   POST   /api/top10/plays              PT, while the showcase is open (season.showcase: from showcaseOpens, before
//                                        voting, to the close). JSON { scope?, score: ref or osu! score link, player?,
//                                        caption?, clip? } or { player, clip, caption? }; or multipart/form-data with
//                                        those fields as text and `replay`, an .osr file up to 2 MB, alone or with a
//                                        score. osu: and legacy: refs are checked with the osu! API (one call; the
//                                        exported data when osu! can't be asked); map: refs against the exported data.
//                                        An .osr alone that names its score (lazer's score id, or stable's legacy one)
//                                        is asked about the same way, and becomes that score's entry when osu! has it.
//                                        The file is stored only when osu! doesn't keep the score's replay (§13.9).
//                                        → 201 { play }, plus replay: 'kept' (the file is stored) or 'osu' (osu! keeps
//                                        this score's replay, so the entry links to theirs) when a file was sent
//   PATCH  /api/top10/plays/:id          the submitter, while the showcase is open. { caption?, clip? } (left out: kept;
//                                        '' or null: none, except a clip-only entry's clip). → { play }
//   DELETE /api/top10/plays/:id          the submitter. → { ok }
//   POST   /api/top10/plays/:id/endorse  PT. { endorsed? } (left out: toggles). → { endorsed, endorsements }
//   POST   /api/top10/thanks             the subject of a write-up on a public ballot, until thanksUntil.
//                                        { kind?, voter, thanked? } (left out: toggles). Before that kind is finalized
//                                        it can be taken back; after, only given (taking back is 409 final), and a
//                                        new one is paid at once. → { thanked, thanks }
//   GET    /api/top10/results?year=&kind=  404 before the reveal (or if that year and kind have no results); then the
//                                        results JSON (top10/score.js, with its kind), cached. Past editions (2020–2025,
//                                        and an all-time list if one is found; top10/import-past.mjs)
//                                        add edition, label ("2023–24" for the year key 2024), thread, past: true,
//                                        names ({ [id]: name } for every id in them) and lists (the forum posts:
//                                        [{ voter, post, picks, mentions, watch, notes? }])
//   GET    /api/top10/admin/queue?year=&kind=  admins; both kinds unless ?kind= says one, each item with its kind.
//                                        { season, phase, year, finalized, writeups: [{ kind, voter, subject, body,
//                                        words, cites, flags, mod, mod_reason, updated, ranked (about a pick, so it
//                                        pays), ballot_status, target, own }] (flagged first), plays: [Play with
//                                        status, reason, target] (hidden too), ballots: [Ballot without write-ups,
//                                        with target, own] (a draft is only { voter, status, updated, target, own }),
//                                        log: [{ seq, year, kind, admin, action, target, reason, at }] }. `own`: you
//                                        can't act on it
//   POST   /api/top10/admin/action       admins. { action, target, reason, kind?, year? }:
//                                          strike, restore   target { voter, subject }, "<voter>:<subject>" or the
//                                                            queue's "writeup:<voter>:<subject>" /
//                                                            "writeup:alltime:<voter>:<subject>"
//                                          hide-play, show-play  target a play id, or "play:<id>"
//                                          void, unvoid      target a voter's osu! id, "ballot:<voter>" or
//                                                            "ballot:alltime:<voter>"
//                                        The kind is the body's, or the target's ("alltime:" in it), or 'year'.
//                                        strike, hide-play and void need a reason. No mod acts on a write-up about
//                                        themselves or by them, or on their own ballot. → { ok, changed }
//   POST   /api/top10/admin/finalize     admins, once voting has closed. { year, dryRun: true | false }. Both kinds at
//                                        once: → { dryRun, results: { year, alltime } (each the results JSON, or null
//                                        when it had under 5 ballots and stays unpublished), unpublished: [{ kind,
//                                        ballots }], payouts: [top10.payout], thanks: [top10.thanks] } (each { osuId,
//                                        type, payload } with payload.kind, and requestId on the real run). A dry run
//                                        saves nothing; the real one, once only, saves the published results and
//                                        queues their payouts and thanks for the bot. A kind left unpublished pays
//                                        nothing. When neither kind has 5 ballots, it's 409 turnout and nothing's saved
//
// Needs the ECONOMY database binding and OSU_CLIENT_SECRET (sessions); without them these answer 503. Replay uploads
// also need REPLAYS, an R2 binding to the data bucket (ptcatch-data, keys replays/<sha256>.osr, served from
// data.ptcatch.com); without it only uploads answer 503. The showcase's score check uses the site's osu! app
// (OSU_CLIENT_ID and OSU_CLIENT_SECRET, top10/osu.js), never on a read and at most twice per submission (once for a
// score; for an .osr, its score and, when osu! has none, its map). The season's dates are
// top10/season.js's, or TOP10_SEASON's. Admins are economy's (ADMIN_OSU_IDS). Who counts as a PT player, and the
// plays the exported data knows, come from the site's data (top10/data.js).

import { sessionOf } from '../signin/session.js';
import { adminIds, json, problem } from '../economy/api.js';
import { iso } from '../economy/store.js';
import { CONFIG } from '../assets/js/config.js';
import { modString } from '../assets/js/core/model.js';
import { seasonOf, seasonView, phaseOf, showcaseOf } from './season.js';
import { analyse, shingles } from './words.js';
import { computeResults, payoutsFor, spotsValid, MIN_PICKS, MAX_PICKS } from './score.js';
import { ptPlayers, findPlay, recentOwner, yearOf } from './data.js';
import { OsuUnavailable, fetchScore, lookupBeatmap, osuConfigured } from './osu.js';
import { MAX_REPLAY_BYTES, attachment, catchGrade, parseOsr, replayFileName, sha256Hex } from './osr.js';
import { parseRef, scoreUrl, sidsOf } from './refs.js';
import * as store from './store.js';

const nowSec = () => Math.floor(Date.now() / 1000);

export const LIMITS = {
  body: 64 * 1024, writeup: 4000, intro: 2000, lists: 5, cites: 5, caption: 280, clip: 300, reason: 200, plays: 15, ownPlays: 5,
};
/**
 * A person's showcase entries per season and scope (§4.1, §13.11): { all, own, perOther }. perOther: at most one entry
 * for each other player, so one fan can't fill the showcase with someone's plays (the maintainer, 2026-11-08).
 */
export const PLAY_LIMITS = { year: { all: 15, own: 5, perOther: 1 }, alltime: { all: 10, own: 5, perOther: 1 } };
const { KINDS, SCOPES } = store;
const KIND_NAMES = { year: 'yearly', alltime: 'all-time' };
/** A kind or scope as sent: 'year' when it's left out, null when it's neither. */
const kindOf = v => (v === undefined || v === null || v === '' ? 'year' : KINDS.includes(v) ? v : null);
const kindParam = (request, name = 'kind') => kindOf(new URL(request.url).searchParams.get(name));
const badKind = (name = 'kind') => json({ error: `${name} is 'year' or 'alltime'.`, code: name }, 400);
export const CLIP_HOSTS = ['youtube.com', 'youtu.be', 'twitch.tv', 'streamable.com'];
const WRITEUP_ACTIONS = ['strike', 'restore'];
const PLAY_ACTIONS = ['hide-play', 'show-play'];
const BALLOT_ACTIONS = ['void', 'unvoid'];
const NEEDS_REASON = ['strike', 'hide-play', 'void'];

const NOT_HERE = 'The Top 10 isn’t set up on this copy of the site.';
const SIGN_IN = 'Sign in with osu! first (or again: a sign-in lasts 30 days).';
const DATA_DOWN = 'The site’s player data couldn’t be read just now. Try again in a minute.';
const NOT_PT = 'Only PT players on the site can take part: your osu! account isn’t in its list of Portuguese players.';
const NOT_IN_DATA = 'That score isn’t in the site’s data yet: add it with /addscore first, or attach its replay (.osr) or a clip.';

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

/** null while the showcase takes entries (showcaseOpens to closes, top10/season.js); otherwise the refusal. */
function unlessShowcaseOpen(season, now) {
  const showcase = showcaseOf(season, now);
  if (showcase === 'open') return null;
  const extra = { phase: phaseOf(season, now), showcase };
  return showcase === 'before'
    ? refuse('not_open', `The showcase opens on ${season.showcaseOpens.slice(0, 10)}.`, 409, extra)
    : refuse('closed', 'The showcase has closed.', 409, extra);
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

/** A write-up's cites as canonical refs (a map ref without a player is the subject's), or null when one isn't a ref. */
function readCites(v, subject) {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.length > LIMITS.cites) return null;
  const refs = v.map(c => parseRef(c, { player: subject }));
  return refs.every(r => r?.ref) ? [...new Set(refs.map(r => r.ref))] : null;
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

/** A ballot as its owner sees it: write-ups keyed by subject, with words, flags and the mods' note, and the cards. */
function ownView(ballot) {
  if (!ballot) return null;
  const { writeups, ...rest } = ballot;
  const scores = {};
  for (const w of writeups) for (const ref of w.cites) if (w.cards[ref]) scores[ref] = w.cards[ref];
  return {
    ...rest,
    writeups: Object.fromEntries(writeups.map(w => [w.subject, {
      body: w.body, words: w.words, cites: w.cites, flags: w.flags, mod: w.mod, mod_reason: w.mod_reason, thanks: w.thanks, updated: iso(w.updated),
    }])),
    scores,
  };
}

/** osu!'s download link for a score with a replay osu! keeps, from its ref. */
const osuReplayUrl = ref => {
  const url = scoreUrl(ref);
  return url ? `${url}/download` : null;
};

/** A showcase entry as the API shows it (the Play shape above); with status, reason and target for the admin queue. */
function playView(play, env, { admin = false } = {}) {
  const osu = play.has_replay ? osuReplayUrl(play.score_ref) : null;
  const replay = osu ? { kind: 'osu', url: osu }
    : play.replay_sha ? { kind: 'file', url: new URL(`${env.REPLAYS_URL ? '' : 'replays/'}${play.replay_sha}.osr`, env.REPLAYS_URL || env.DATA_URL || CONFIG.data).href, name: play.replay_name }
    : null;
  return {
    id: play.id, year: play.year, scope: play.scope, submitter: play.submitter, player: play.player, score_ref: play.score_ref, beatmap_id: play.beatmap_id,
    caption: play.caption, clip: play.clip, created: play.created, played: play.played_at ? iso(play.played_at) : null,
    endorsements: play.endorsements ?? 0, ...(play.endorsed !== undefined ? { endorsed: play.endorsed } : {}),
    score: play.card ?? null, replay,
    ...(admin ? { status: play.status, reason: play.reason, target: `play:${play.id}` } : {}),
  };
}

/** A JSON body that's the same for everyone, kept in the Cache API for `seconds` (where there is one). */
async function cachedBody(request, key, seconds, build) {
  const cache = globalThis.caches?.default;
  const url = new URL(`/api/top10/cache/${key}`, request.url).href;
  if (cache) {
    const hit = await cache.match(url).catch(() => null);
    if (hit) return hit.json();
  }
  const body = await build();
  if (cache) await cache.put(url, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${seconds}` } })).catch(() => {});
  return body;
}

// ---- The hub and the ballots ----------------------------------------------------------------------------------------

export async function hub(request, env, now = nowSec()) {
  if (!env.ECONOMY) return problem(NOT_HERE, 503);
  const db = env.ECONOMY;
  const season = seasonOf(env);
  const [turnouts, finalized, years] = await Promise.all([store.turnouts(db, season.year), store.finalizedAt(db, season.year), store.resultYears(db)]);
  // The editions whose results anyone can read: past ones, and this season's from the reveal on.
  const editions = years.filter(e => e.year < season.year || (e.year === season.year && now >= season.at.reveal));
  // `turnout` stays the yearly count, a plain number: the deployed bot reads it.
  const body = { season: seasonView(season, now), turnout: turnouts.year, turnouts, finalized: Boolean(finalized), editions };
  const osuId = await viewerOf(request, env, now);
  if (osuId) {
    const [e, year, alltime] = await Promise.all([eligibility(env, osuId), store.readBallot(db, season.year, osuId, 'year'), store.readBallot(db, season.year, osuId, 'alltime')]);
    body.me = { osuId, ...eligibleView(e), ballot: ownView(year), ballots: { year: ownView(year), alltime: ownView(alltime) } };
  }
  return json(body);
}

export async function ballots(request, env, now = nowSec()) {
  if (!env.ECONOMY) return problem(NOT_HERE, 503);
  const year = yearParam(request, seasonOf(env));
  if (!year) return refuse('year', 'year must be a year, like 2026.', 400);
  const kind = kindParam(request);
  if (!kind) return badKind();
  const body = await cachedBody(request, `ballots/${year}/${kind}`, 15, async () => ({ year, kind, ballots: await store.publicBallots(env.ECONOMY, year, kind) }));
  // Who's looking isn't in the cached part: their own thanks go on top.
  const viewer = await viewerOf(request, env, now);
  if (viewer) {
    const thanked = await store.thankedBy(env.ECONOMY, year, viewer, kind);
    for (const b of body.ballots) {
      for (const [subject, w] of Object.entries(b.writeups)) w.thanked = Number(subject) === viewer && thanked.has(b.voter);
    }
  }
  return json(body);
}

export async function myBallot(request, env, now = nowSec()) {
  const who = await signedIn(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const kind = kindParam(request);
  if (!kind) return badKind();
  const [e, ballot, log] = await Promise.all([eligibility(env, osuId), store.readBallot(db, season.year, osuId, kind), store.modlogAbout(db, season.year, osuId)]);
  return json({ season: seasonView(season, now), kind, ...eligibleView(e), ballot: ownView(ballot), log });
}

/** The ballot kind a write names: its body's `kind`, else ?kind=, else 'year'; null when it's neither kind. */
const writeKind = (request, body) => kindOf(body?.kind ?? new URL(request.url).searchParams.get('kind'));

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The cards for a write-up's cites, resolved when they're saved (`known`: the cards it had, kept for refs it still
 * cites): a showcase entry's own card for play:<id>; for a score, a showcased play's card, else the play in the
 * exported data (osu:/legacy: in the subject's file, any year; map: that player's best on the map this season, or in
 * any year on an all-time ballot). Returns { cards } or { response } for a cite that can't be found.
 */
async function citeCards(env, db, year, subject, cites, known = {}, { kind = 'year' } = {}) {
  const mapYear = kind === 'alltime' ? null : year;
  const cards = {};
  for (const ref of cites) {
    if (known[ref]) { cards[ref] = known[ref]; continue; }
    const cite = parseRef(ref, { player: subject });
    if (cite.kind === 'play') {
      const play = await store.readPlay(db, cite.id);
      if (!play || play.year !== year || play.status !== 'ok') return { response: refuse('cite', `Showcase entry ${cite.id} isn’t in ${year}’s showcase.`, 400, { ref }) };
      cards[ref] = { ...(play.card ?? { map: play.beatmap_id }), ref, player: play.player, play: play.id, clip: play.clip };
      continue;
    }
    // A showcased play of the same sense: a map ref means this year's best on the yearly showcase, ever's on the
    // Legendary plays.
    const shown = await store.playByRefs(db, year, [ref], cite.kind === 'map' ? kind : null);
    if (shown?.card) { cards[ref] = { ...shown.card, ref }; continue; }
    let found;
    try {
      found = cite.kind === 'map'
        ? await findPlay(env, cite.player, { beatmap: cite.beatmap, year: mapYear })
        : await findPlay(env, subject, { sids: sidsOf(cite), year: mapYear });
    } catch {
      return { response: refuse('data_unavailable', DATA_DOWN, 503) };
    }
    if (!found) {
      const where = cite.kind === 'map' ? `a play by ${cite.player} on map ${cite.beatmap}${mapYear ? ` set in ${year}` : ''}` : 'that score';
      return { response: refuse('cite', `The site’s data has no ${where} to cite.`, 400, { ref }) };
    }
    cards[ref] = { ...found.card, ref };
  }
  return { cards };
}

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
  const kind = writeKind(request, body);
  if (!kind) return badKind();
  const saved = await store.readBallot(db, year, osuId, kind);
  if (saved?.status === 'void') return refuse('void', `This ballot was voided: ${saved.void_reason}`, 403, { reason: saved.void_reason });

  const lists = {
    picks: 'picks' in body ? readPicks(body.picks) : saved?.picks ?? [],
    mentions: 'mentions' in body ? readIds(body.mentions) : saved?.mentions ?? [],
    watch: 'watch' in body ? readIds(body.watch) : saved?.watch ?? [],
  };
  if (!lists.picks || !lists.mentions || !lists.watch) return refuse('shape', 'picks is a list of { id, spot }; mentions and watch are lists of osu! ids.', 400);
  // Ones to watch make no sense for all time (§13.11).
  if (kind === 'alltime' && lists.watch.length) return refuse('no_watch', 'The all-time ballot has no ones to watch.', 400);
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
    const cites = 'cites' in value ? readCites(value.cites, subject) : current.get(subject)?.cites ?? [];
    if (text === null) return refuse('shape', 'A write-up is { body: text, cites: [ref] }.', 400);
    if (cites === null) return refuse('cite', `Cite up to ${LIMITS.cites} plays, each as osu:<id>, legacy:<id>, map:<beatmap>:<player> or play:<id>.`, 400, { id: subject });
    if (text.length > LIMITS.writeup) return refuse('too_long', `A write-up can be ${LIMITS.writeup} characters.`, 400, { id: subject });
    if (!text) { final.delete(subject); continue; }
    if (!order.includes(subject)) return refuse('not_listed', 'Write-ups are only for players on your list, honourable mentions or ones to watch.', 400, { id: subject });
    final.set(subject, { body: text, cites });
  }

  // Count and flag the write-ups whose text changed (a new text of a struck write-up is the writer's fix), and resolve
  // the cites that are new.
  const upserts = [];
  let others = null;
  for (const subject of order) {
    const next = final.get(subject);
    const before = current.get(subject);
    if (!next || (before && before.body === next.body && sameJson(before.cites, next.cites))) continue;
    const resolved = await citeCards(env, db, year, subject, next.cites, before?.cards, { kind });
    if (resolved.response) return resolved.response;
    if (before && before.body === next.body) {
      upserts.push({ ...before, cites: next.cites, cards: resolved.cards });
      continue;
    }
    others ??= (await store.otherBodies(db, year, osuId, kind)).map(o => shingles(o.body));
    const earlier = order.slice(0, order.indexOf(subject)).map(s => final.get(s)?.body).filter(Boolean);
    const { words, flags } = analyse(next.body, [...others, ...earlier]);
    upserts.push({ subject, body: next.body, words, flags, cites: next.cites, cards: resolved.cards, mod: 'ok', mod_reason: null });
  }
  const removed = [...current.keys()].some(subject => !final.has(subject));
  const same = saved && !upserts.length && !removed && sameJson([saved.picks, saved.mentions, saved.watch, saved.intro, saved.outro], [lists.picks, lists.mentions, lists.watch, texts.intro, texts.outro]);
  if (!same) {
    const ok = await store.saveBallot(db, { year, kind, voter: osuId, ...lists, ...texts }, { upserts, keep: [...final.keys()] }, now);
    if (!ok) return refuse('void', 'This ballot was voided.', 403);
  }
  return json({ ballot: ownView(await store.readBallot(db, year, osuId, kind)) });
}

export async function submitBallot(request, env, now = nowSec()) {
  const who = await ptPlayer(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const shut = unlessOpen(season, now);
  if (shut) return shut;
  const read = await readJson(request);
  if (!read.body) return badBody(read);
  const kind = writeKind(request, read.body);
  if (!kind) return badKind();
  const saved = await store.readBallot(db, season.year, osuId, kind);
  if (!saved) return refuse('no_ballot', `Save your ${KIND_NAMES[kind]} list first.`, 400);
  if (saved.status === 'void') return refuse('void', `This ballot was voided: ${saved.void_reason}`, 403, { reason: saved.void_reason });
  if (saved.status === 'draft') {
    const { players, response } = await playersOr503(env);
    if (response) return response;
    const listed = listProblem(saved, osuId, players, { full: true });
    if (listed) return refuse(listed[0], listed[1], 400, listed[2]);
    await store.submitBallot(db, season.year, osuId, now, kind);
  }
  return json({ ballot: ownView(await store.readBallot(db, season.year, osuId, kind)) });
}

export async function withdrawBallot(request, env, now = nowSec()) {
  const who = await signedIn(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const shut = unlessOpen(season, now);
  if (shut) return shut;
  const read = await readJson(request);
  if (!read.body) return badBody(read);
  const kind = writeKind(request, read.body);
  if (!kind) return badKind();
  const saved = await store.readBallot(db, season.year, osuId, kind);
  if (!saved) return refuse('no_ballot', 'You have no ballot to withdraw.', 404);
  if (saved.status === 'void') return refuse('void', `This ballot was voided: ${saved.void_reason}`, 403, { reason: saved.void_reason });
  if (saved.status === 'submitted') await store.withdrawBallot(db, season.year, osuId, now, kind);
  return json({ ballot: ownView(await store.readBallot(db, season.year, osuId, kind)) });
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
  const kind = writeKind(request, read.body);
  if (!kind) return badKind();
  if (read.body.thanked !== undefined && typeof read.body.thanked !== 'boolean') return refuse('shape', 'thanked is true or false.', 400);
  if (now > season.at.thanksUntil) return refuse('thanks_closed', `Thanks closed on ${season.thanksUntil.slice(0, 10)}.`, 409);
  const ballot = await store.ballotStatus(db, year, voter, kind);
  if (ballot?.status !== 'submitted') return refuse('not_public', 'That ballot isn’t public.', 404);
  const writeup = await store.readWriteup(db, year, voter, osuId, kind);
  if (writeup?.mod !== 'ok') return refuse('no_writeup', 'There’s no write-up about you on that ballot.', 404);
  // Each kind is finalized (and paid) on its own: a kind left unpublished never is.
  const [already, finalized] = await Promise.all([store.hasMark(db, year, 'thanks', osuId, voter, kind), store.finalizedAt(db, year, kind)]);
  const want = read.body.thanked ?? !already;
  const answer = thanked => json({ thanked, thanks: thanked ? 1 : 0 });
  if (finalized) {
    if (!want) return already ? refuse('final', 'Thanks can’t be taken back once the results are final.', 409, { thanked: true, thanks: 1 }) : answer(false);
    // The bananas follow at once, if the ballot counted in the results.
    if (ballot.updated <= season.at.closes) await store.thankAfterFinalize(db, year, osuId, voter, now, kind);
    else await store.setMark(db, year, 'thanks', osuId, voter, true, now, kind);
    return answer(true);
  }
  if (want !== already) await store.setMark(db, year, 'thanks', osuId, voter, want, now, kind);
  return answer(want);
}

// ---- The showcase ---------------------------------------------------------------------------------------------------

export async function plays(request, env, now = nowSec()) {
  if (!env.ECONOMY) return problem(NOT_HERE, 503);
  const season = seasonOf(env);
  const year = yearParam(request, season);
  if (!year) return refuse('year', 'year must be a year, like 2026.', 400);
  const scope = kindParam(request, 'scope');
  if (!scope) return badKind('scope');
  const raw = new URL(request.url).searchParams.get('player');
  const player = raw ? toId(raw) : null;
  if (raw && !player) return refuse('shape', 'player is an osu! id.', 400);
  const viewer = await viewerOf(request, env, now);
  const list = async () => ({ year, scope, plays: (await store.listPlays(env.ECONOMY, year, { scope, player, viewer })).map(p => playView(p, env)) });
  return json(viewer ? await list() : await cachedBody(request, `plays/${year}/${scope}/${player ?? 'all'}`, 15, list));
}

/** A card from osu!'s answer (osu.js scoreFromApi). */
const apiCard = (s, ref) => ({
  ref, player: s.userId, map: s.beatmapId, set: s.map?.set ?? null, artist: s.map?.artist ?? null, title: s.map?.title ?? null,
  version: s.map?.version ?? null, stars: s.map?.stars ?? null, pp: s.pp, acc: s.acc, miss: s.miss, combo: s.combo, mods: s.mods,
  grade: s.grade, time: s.time, url: scoreUrl(ref),
});

/** A card from an .osr's header and, when osu! could say, its map. No pp: a replay doesn't carry it. */
const osrCard = (osr, map, player) => ({
  ref: null, player, map: map?.id ?? null, set: map?.set ?? null, artist: map?.artist ?? null, title: map?.title ?? null,
  version: map?.version ?? null, stars: map?.stars ?? null, pp: null, acc: osr.accuracy, miss: osr.counts.miss, combo: osr.combo,
  mods: modString(osr.mods), grade: catchGrade(osr.accuracy, osr.mods), time: osr.time, url: null,
});

/**
 * An osu: or legacy: ref asked of the osu! API (one call) and checked: the catch ruleset, a PT player, the player
 * named, the season's year (any year for the Legendary plays). Returns { found } (resolvePlay's shape), { response },
 * { missing: true } when osu! has no such score, or { down: true } when osu! can't be asked just now.
 */
async function osuPlay(env, parsed, named, players, year, now, scope) {
  let s;
  try {
    s = await fetchScore(env, parsed.kind === 'osu' ? { id: parsed.id } : { id: parsed.id, legacy: true }, now);
  } catch (e) {
    if (!(e instanceof OsuUnavailable)) throw e;
    return { down: true };
  }
  if (!s) return { missing: true };
  if (s.ruleset !== 2) return { response: refuse('mode', 'That score wasn’t set in osu!catch.', 422) };
  if (!s.userId || !players.has(s.userId)) return { response: refuse('not_pt', 'That score isn’t a PT player’s.', 422) };
  if (named && named !== s.userId) return { response: refuse('not_theirs', 'That score is another player’s.', 422, { player: s.userId }) };
  if (scope !== 'alltime' && (!s.time || yearOf(s.time) !== year)) {
    const set = s.time ? yearOf(s.time) : null;
    return { response: refuse('wrong_year', `That score was set in ${set ?? 'another year'}; the showcase is for ${year}’s.`, 422, { year: set }) };
  }
  const refs = [s.solo ? `osu:${s.solo}` : null, s.legacy ? `legacy:${s.legacy}` : null].filter(Boolean);
  if (!refs.length) return { response: refuse('not_found', 'osu! answered without the score’s id.', 422) };
  return { found: { player: s.userId, ref: refs[0], refs, beatmap: s.beatmapId, time: s.time, hasReplay: s.hasReplay, card: apiCard(s, refs[0]), username: s.username, checksum: s.checksum } };
}

/**
 * The showcased play, checked (§13.9). A map ref against the exported data. An osu: or legacy: ref with the osu! API
 * when the site's osu! app is set up here (osuPlay: one call, which also says has_replay); otherwise, or when osu!
 * can't be reached, against the exported data. Returns { found: { player, ref, refs, beatmap, time, hasReplay, card,
 * username, checksum } } or { response }. The Legendary plays (scope 'alltime') take any year: no year check, and a
 * map ref is the player's best play on the map ever.
 */
async function resolvePlay(env, osuId, parsed, named, players, year, now, scope = 'year') {
  if (named && !players.has(named)) return { response: refuse('not_pt', 'That player isn’t a PT player on the site.', 422) };
  const anyYear = scope === 'alltime';
  const wrongYear = time => !anyYear && (!time || yearOf(time) !== year);
  const fromData = async player => {
    const when = anyYear ? null : year;
    try { return await findPlay(env, player, parsed.kind === 'map' ? { beatmap: parsed.beatmap, year: when } : { sids: sidsOf(parsed), year: when }); } catch { return 'down'; }
  };
  let found = null;
  if (parsed.kind === 'map') {
    if (!players.has(parsed.player)) return { response: refuse('not_pt', 'That player isn’t a PT player on the site.', 422) };
    found = await fromData(parsed.player);
    if (found === 'down') return { response: refuse('data_unavailable', DATA_DOWN, 503) };
    if (!found) return { response: refuse('not_in_data', `The site’s data has no play by that player on map ${parsed.beatmap}${anyYear ? '' : ` set in ${year}`}. ${NOT_IN_DATA}`, 422) };
  } else {
    if (osuConfigured(env)) {
      const asked = await osuPlay(env, parsed, named, players, year, now, scope);
      if (asked.missing) return { response: refuse('not_found', 'osu! has no score with that id. For a play osu! doesn’t keep, attach its replay (.osr) or a clip.', 422) };
      // osu! can't be asked just now: the exported data still knows every score the bot imported.
      if (!asked.down) return asked;
    }
    found = await fromData(named ?? osuId);
    if (found === 'down') return { response: refuse('data_unavailable', DATA_DOWN, 503) };
    if (!found && !named) {
      // Not the submitter's own: the recent plays may say whose it is.
      let owner = null;
      try { owner = await recentOwner(env, sidsOf(parsed)); } catch { /* as if unknown */ }
      if (owner && owner !== osuId && players.has(owner)) found = await fromData(owner);
      if (found === 'down') return { response: refuse('data_unavailable', DATA_DOWN, 503) };
    }
    if (!found) return { response: refuse('not_in_data', named ? NOT_IN_DATA : `${NOT_IN_DATA} If it’s someone else’s score, say whose (player).`, 422) };
  }
  if (!players.has(found.player)) return { response: refuse('not_pt', 'That score isn’t a PT player’s.', 422) };
  if (wrongYear(found.time)) return { response: refuse('wrong_year', `That score was set in ${yearOf(found.time)}; the showcase is for ${year}’s.`, 422, { year: yearOf(found.time) }) };
  return { found: { ...found, hasReplay: null, username: null, checksum: null } };
}

/** The scores an .osr names (top10/osr.js), as parsed refs to ask osu! about: lazer's score id first, then stable's. */
const osrScores = osr => [
  osr.soloId ? { kind: 'osu', id: osr.soloId, ref: `osu:${osr.soloId}` } : null,
  osr.onlineId ? { kind: 'legacy', id: osr.onlineId, ref: `legacy:${osr.onlineId}` } : null,
].filter(Boolean);

/** A PT player's id from a name as an .osr has it (case-insensitive), or null. */
function playerNamed(players, name) {
  const wanted = name.toLowerCase();
  for (const [id, n] of players) if (n.toLowerCase() === wanted) return id;
  return null;
}

/**
 * What was sent: JSON (up to 64 KB), or multipart/form-data with the same fields as text and `replay`, an .osr of
 * up to MAX_REPLAY_BYTES. Returns { body } (with body.replay = { bytes, name } for a file) or { response }.
 */
async function readPlayRequest(request) {
  if (!/^multipart\/form-data/i.test(request.headers.get('Content-Type') ?? '')) {
    const read = await readJson(request);
    if (!read.body) return { response: badBody(read) };
    if (read.body.replay !== undefined) return { response: refuse('shape', 'Send a replay as a file, in multipart/form-data (the field `replay`), not in JSON.', 400) };
    return { body: read.body };
  }
  const tooBig = () => refuse('too_big', `A replay can be ${MAX_REPLAY_BYTES / 1024 / 1024} MB at most.`, 413);
  if (Number(request.headers.get('Content-Length')) > MAX_REPLAY_BYTES + LIMITS.body) return { response: tooBig() };
  let form;
  try { form = await request.formData(); } catch { return { response: refuse('bad_form', 'That upload couldn’t be read.', 400) }; }
  const body = {};
  for (const key of ['scope', 'score', 'player', 'caption', 'clip']) {
    const value = form.get(key);
    if (typeof value === 'string') body[key] = value;
  }
  const file = form.get('replay');
  if (file && typeof file === 'object') {
    if (file.size > MAX_REPLAY_BYTES) return { response: tooBig() };
    body.replay = { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name ?? '' };
  }
  return { body };
}

/**
 * Puts a replay in R2 once: its key is its SHA-256, so the same file is never stored twice. It's served from
 * data.ptcatch.com as an attachment named `name` (a cross-origin link's download attribute is ignored).
 */
async function keepReplay(bucket, { sha, bytes, name }) {
  const key = `replays/${sha}.osr`;
  if (await bucket.head(key)) return;
  await bucket.put(key, bytes, {
    sha256: sha,
    httpMetadata: { contentType: 'application/octet-stream', contentDisposition: attachment(name), cacheControl: 'public, max-age=31536000, immutable' },
  });
}

export async function addPlay(request, env, now = nowSec()) {
  const who = await ptPlayer(request, env, now);
  if (who.response) return who.response;
  const { osuId, db, season } = who;
  const year = season.year;
  // The showcase's own window (from showcaseOpens, before voting opens, to the close: top10/season.js).
  const shut = unlessShowcaseOpen(season, now);
  if (shut) return shut;
  const read = await readPlayRequest(request);
  if (read.response) return read.response;
  const body = read.body;
  const given = v => v !== undefined && v !== null && v !== '';
  const caption = given(body.caption) ? cleanLine(body.caption) : '';
  if (caption === null) return refuse('shape', 'caption is text.', 400);
  if (caption.length > LIMITS.caption) return refuse('too_long', `A caption can be ${LIMITS.caption} characters.`, 400);
  const clip = given(body.clip) ? clipOf(body.clip) : null;
  if (clip === undefined) return refuse('clip', `A clip must be a link on ${CLIP_HOSTS.join(', ')}.`, 400);
  const named = given(body.player) ? toId(body.player) : null;
  if (given(body.player) && !named) return refuse('shape', 'player is an osu! id.', 400);
  // The yearly showcase, or the Legendary plays (§13.11): any year, their own limits.
  const scope = kindOf(body.scope ?? new URL(request.url).searchParams.get('scope'));
  if (!scope) return badKind('scope');
  const limits = PLAY_LIMITS[scope];
  const showcase = scope === 'alltime' ? 'Legendary plays' : 'showcase';
  const parsed = given(body.score) ? parseRef(body.score, { player: named }) : null;
  if (given(body.score) && (!parsed || parsed.kind === 'play')) return refuse('score', 'score is an osu! score link, or a ref: osu:<id>, legacy:<id> or map:<beatmap>:<player>.', 400);
  if (parsed?.error) return refuse('mode', 'That score wasn’t set in osu!catch.', 400);
  if (parsed?.kind === 'map' && named && parsed.player !== named) return refuse('not_theirs', 'That map ref names another player.', 422, { player: parsed.player });
  let replay = null;
  if (body.replay) {
    if (!env.REPLAYS) return refuse('no_replays', 'Replay uploads aren’t set up on this copy of the site.', 503);
    const osr = parseOsr(body.replay.bytes);
    if (!osr) return refuse('osr', 'That file isn’t an osu! replay (.osr).', 400);
    if (osr.mode !== 2) return refuse('mode', 'That replay isn’t osu!catch.', 400);
    replay = { osr, bytes: body.replay.bytes, sha: await sha256Hex(body.replay.bytes) };
  }
  if (!parsed && !replay && (!named || !clip)) return refuse('shape', 'Send a score (a link or a ref), a replay (.osr), or a player and a clip.', 400);

  // The cheap refusals first, so osu! isn't asked about an entry that can't be added anyway.
  const counts = await store.playCounts(db, year, osuId, scope);
  if (counts.all >= limits.all) return refuse('limit', `That’s ${limits.all} entries in the ${showcase} this season: remove one to add another.`, 429);
  // A twin by its refs, or by the file: one stored (replay_sha), or one sent with a score osu! keeps the replay of
  // (no copy, so it's among the entry's refs as osr:<sha>).
  const twinOf = async (refs, sha) => {
    const known = [...(refs ?? []), ...(sha ? [`osr:${sha}`] : [])];
    return (known.length ? await store.playByRefs(db, year, known, scope) : null) ?? (sha ? await store.playBySha(db, year, sha, scope) : null);
  };
  // An .osr on its own may name its score (§13.9): lazer's score id, else stable's legacy one.
  const fileScores = replay && !parsed ? osrScores(replay.osr) : [];
  const asked = parsed ? (parsed.bare ? [parsed.ref, `legacy:${parsed.id}`] : [parsed.ref]) : fileScores.map(r => r.ref);
  const early = await twinOf(asked, replay?.sha);
  if (early) return refuse('duplicate', `That play is already in the ${showcase}.`, 409, { id: early.id });
  const { players, response } = await playersOr503(env);
  if (response) return response;

  let entry = null;
  let found = null;
  if (parsed) {
    const resolved = await resolvePlay(env, osuId, parsed, named, players, year, now, scope);
    if (resolved.response) return resolved.response;
    found = resolved.found;
  } else if (fileScores.length && osuConfigured(env)) {
    // The score the file names, when osu! has it: the entry is that score's, as if from its link (osu!'s card, with pp,
    // and its date). When osu! has no such score or can't be asked, the file stands on its own, as below.
    const lookup = await osuPlay(env, fileScores[0], named, players, year, now, scope);
    if (lookup.response) return lookup.response;
    found = lookup.found ?? null;
  }
  if (found) {
    const twin = await twinOf(found.refs);
    if (twin) return refuse('duplicate', `That play is already in the ${showcase}.`, 409, { id: twin.id });
    entry = { player: found.player, ref: found.ref, refs: found.refs, beatmap: found.beatmap, playedAt: found.time, hasReplay: found.hasReplay, card: found.card };
  }
  // Whether the file goes to R2: not when osu! keeps this score's replay, since the entry links to theirs (§13.9).
  let keep = Boolean(replay);
  if (replay) {
    const { osr } = replay;
    const owner = playerNamed(players, osr.player);
    let map = null;
    if (entry) {
      // With a score, the file has to be that score's replay: the same player and the same map.
      const samePlayer = owner === entry.player || (found.username && found.username.toLowerCase() === osr.player.toLowerCase()) || osr.userId === entry.player;
      if (!samePlayer || (found.checksum && found.checksum !== osr.beatmapMd5)) {
        return refuse('replay_mismatch', parsed ? 'That replay isn’t this score’s: the player or the map is different.'
          : 'That replay names a score on osu! that isn’t its own: the player or the map is different.', 422);
      }
      keep = found.hasReplay !== true;
      // No copy, and no replay_sha, but the same file mustn't come back as another entry.
      if (!keep) entry.refs = [...entry.refs, `osr:${replay.sha}`];
    } else {
      if (!owner) return refuse('not_pt', `The replay’s player, ${osr.player}, isn’t a PT player on the site.`, 422, { name: osr.player });
      if (named && named !== owner) return refuse('not_theirs', 'That replay is another player’s.', 422, { player: owner });
      if (scope === 'year' && yearOf(osr.time) !== year) return refuse('wrong_year', `That replay was set in ${yearOf(osr.time)}; the showcase is for ${year}’s.`, 422, { year: yearOf(osr.time) });
      // The map, for the card and the file's name: one osu! call, and none when osu! can't be asked.
      if (osuConfigured(env)) {
        try { map = await lookupBeatmap(env, osr.beatmapMd5, now); } catch (e) { if (!(e instanceof OsuUnavailable)) throw e; }
      }
      entry = { player: owner, beatmap: map?.id ?? null, playedAt: osr.time, hasReplay: null, card: osrCard(osr, map, owner) };
    }
    const card = entry.card;
    const mapName = card?.title ? { artist: card.artist, title: card.title, version: card.version } : null;
    replay.name = replayFileName({ player: players.get(entry.player) || osr.player, map: mapName, time: entry.playedAt ?? osr.time });
  }
  if (!entry) {
    if (!players.has(named)) return refuse('not_pt', 'That player isn’t a PT player on the site.', 422);
    entry = { player: named };
  }
  if (entry.player === osuId && counts.own >= limits.own) return refuse('own_limit', `At most ${limits.own} of your own plays in the ${showcase} a season.`, 429);
  if (entry.player !== osuId && (await store.playsFor(db, year, osuId, entry.player, scope)) >= limits.perOther) {
    return refuse('other_limit', `You’ve already added a play by that player to the ${showcase}: one per player. Remove it to add another.`, 429, { player: entry.player });
  }
  if (keep) await keepReplay(env.REPLAYS, replay);
  try {
    const play = await store.addPlay(db, { year, scope, submitter: osuId, ...entry, caption, clip, replaySha: keep ? replay.sha : null, replayName: keep ? replay.name : null }, now);
    // With a file: 'kept' when the site stores it, 'osu' when osu! keeps this score's replay and the entry links to it.
    return json({ play: playView(play, env), ...(replay ? { replay: keep ? 'kept' : 'osu' } : {}) }, 201);
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) return refuse('duplicate', `That play is already in the ${showcase}.`, 409);
    throw e;
  }
}

/** PATCH /api/top10/plays/:id: the submitter edits their entry's caption and clip while the showcase is open. */
export async function editPlay(request, env, id, now = nowSec()) {
  const who = await signedIn(request, env, now);
  if (who.response) return who.response;
  const shut = unlessShowcaseOpen(who.season, now);
  if (shut) return shut;
  const play = toId(id) ? await store.readPlay(who.db, toId(id)) : null;
  if (!play) return refuse('no_play', 'No such showcase entry.', 404);
  if (play.submitter !== who.osuId) return refuse('not_yours', 'Only whoever added an entry can edit it.', 403);
  const read = await readJson(request);
  if (!read.body) return badBody(read);
  const body = read.body;
  const cleared = v => v === null || v === '';
  let caption = play.caption ?? '';
  if (body.caption !== undefined) {
    caption = cleared(body.caption) ? '' : cleanLine(body.caption);
    if (caption === null) return refuse('shape', 'caption is text.', 400);
    if (caption.length > LIMITS.caption) return refuse('too_long', `A caption can be ${LIMITS.caption} characters.`, 400);
  }
  let clip = play.clip ?? null;
  if (body.clip !== undefined) {
    clip = cleared(body.clip) ? null : clipOf(body.clip);
    if (clip === undefined) return refuse('clip', `A clip must be a link on ${CLIP_HOSTS.join(', ')}.`, 400);
  }
  // A clip-only entry is its clip: it can change, not go.
  if (!clip && !play.score_ref && !play.replay_sha && !play.card) return refuse('clip_needed', 'This entry is a clip: change its link, or remove the entry.', 400);
  await store.editPlay(who.db, play.id, { caption, clip });
  const endorsements = await store.endorsements(who.db, play.year, play.id);
  return json({ play: playView({ ...play, caption, clip, endorsements }, env) });
}

export async function deletePlay(request, env, id, now = nowSec()) {
  const who = await signedIn(request, env, now);
  if (who.response) return who.response;
  const play = toId(id) ? await store.readPlay(who.db, toId(id)) : null;
  if (!play) return refuse('no_play', 'No such showcase entry.', 404);
  if (play.submitter !== who.osuId) return refuse('not_yours', 'Only whoever added an entry can remove it.', 403);
  await store.deletePlay(who.db, play);
  // Its uploaded replay goes too, once nothing else uses it.
  if (play.replay_sha && env.REPLAYS && !(await store.replayInUse(who.db, play.replay_sha))) await env.REPLAYS.delete(`replays/${play.replay_sha}.osr`);
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
  const already = await store.hasMark(db, play.year, 'endorse', osuId, play.id, play.scope);
  const want = read.body.endorsed ?? !already;
  if (want !== already) await store.setMark(db, play.year, 'endorse', osuId, play.id, want, now, play.scope);
  return json({ endorsed: want, endorsements: await store.endorsements(db, play.year, play.id) });
}

// ---- Results --------------------------------------------------------------------------------------------------------

export async function results(request, env, now = nowSec()) {
  if (!env.ECONOMY) return problem(NOT_HERE, 503);
  const season = seasonOf(env);
  const year = yearParam(request, season);
  if (!year) return refuse('year', 'year must be a year, like 2026.', 400);
  const kind = kindParam(request);
  if (!kind) return badKind();
  const shown = year < season.year || (year === season.year && now >= season.at.reveal);
  if (!shown) return refuse('not_yet', 'The results aren’t out yet.', 404, year === season.year ? { reveal: season.reveal } : {});
  const cache = globalThis.caches?.default;
  const key = new URL(`/api/top10/cache/results/${year}/${kind}`, request.url).href;
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
  // Final once saved, so the browser may keep it a while and the edge a day.
  const answer = text => new Response(text, { headers: { ...headers, 'Cache-Control': 'public, max-age=600' } });
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return answer(await hit.text());
  const saved = await store.readResults(env.ECONOMY, year, kind);
  if (!saved?.results) return refuse('not_published', `There are no ${KIND_NAMES[kind]} results for that year.`, 404);
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
  // Both kinds unless ?kind= asks for one; every item says its kind.
  const raw = new URL(request.url).searchParams.get('kind');
  const kind = raw ? kindOf(raw) : null;
  if (raw && !kind) return badKind();
  const [queue, finalized] = await Promise.all([store.adminQueue(db, year, kind), store.finalizedAt(db, year)]);
  return json({
    season: seasonView(season, now), phase: phaseOf(season, now), year, finalized: Boolean(finalized),
    writeups: queue.writeups.map(w => ({ ...w, own: w.voter === osuId || w.subject === osuId })),
    plays: queue.plays.map(p => playView(p, env, { admin: true })),
    ballots: queue.ballots.map(b => ({ ...b, own: b.voter === osuId })),
    log: queue.log,
  });
}

/** An action's target from the body, or null; `kind` is 'alltime' when a target string says so ("…:alltime:…"). */
function targetOf(action, t) {
  if (WRITEUP_ACTIONS.includes(action)) {
    if (typeof t === 'string') {
      const m = /^(?:writeup:)?(?:(alltime):)?(\d{1,10}):(\d{1,10})$/.exec(t);
      return m ? { voter: Number(m[2]), subject: Number(m[3]), ...(m[1] ? { kind: 'alltime' } : {}) } : null;
    }
    const voter = toId(t?.voter);
    const subject = toId(t?.subject);
    return voter && subject ? { voter, subject } : null;
  }
  if (PLAY_ACTIONS.includes(action)) {
    const raw = typeof t === 'string' ? t.replace(/^play:/, '') : t && typeof t === 'object' ? t.play ?? t.id : t;
    const id = toId(raw);
    return id ? { play: id } : null;
  }
  if (typeof t === 'string') {
    const m = /^(?:ballot:)?(?:(alltime):)?(\d{1,10})$/.exec(t);
    return m ? { voter: Number(m[2]), ...(m[1] ? { kind: 'alltime' } : {}) } : null;
  }
  const id = toId(t && typeof t === 'object' ? t.voter ?? t.id : t);
  return id ? { voter: id } : null;
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
  if (!target) return refuse('target', 'target is { voter, subject } or "<voter>:<subject>" for a write-up, a play id, or a voter’s osu! id.', 400);
  // The ballot's kind: the body's, or the target's, or 'year'. They mustn't disagree.
  const kind = kindOf(read.body.kind ?? target.kind);
  if (!kind || (target.kind && read.body.kind && target.kind !== read.body.kind)) return badKind();
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
      if (!(await store.readWriteup(db, year, target.voter, target.subject, kind))) return refuse('no_writeup', 'No such write-up.', 404);
    } else {
      if (target.voter === osuId) return refuse('self', 'That’s your own ballot: the other mod handles it.', 403);
      if (!(await store.ballotStatus(db, year, target.voter, kind))) return refuse('no_ballot', 'No such ballot.', 404);
    }
    // Each kind is final on its own: an all-time ballot left unpublished can still be moderated.
    if (await store.finalizedAt(db, year, kind)) return refuse('final', 'The results are final and the payouts queued, so write-ups and ballots can’t change now.', 409);
  }
  const changed = await store.moderate(db, { year, kind, admin: osuId, action, target, reason: reason || null }, now);
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

  // Both kinds in one go (§13.11). A kind under 5 counted ballots is left unpublished and pays nothing; it doesn't
  // stop the other.
  const results = {};
  const unpublished = [];
  const published = [];
  let requests = [];
  for (const kind of KINDS) {
    const inputs = await store.finalizeInputs(db, year, season.at.closes, kind);
    const computed = computeResults({ year, kind, ballots: inputs.ballots, writeups: inputs.writeups.filter(w => w.mod === 'ok'), finalizedAt: iso(now) });
    results[kind] = computed.results ?? null;
    if (computed.error) {
      unpublished.push({ kind, ballots: computed.ballots });
      continue;
    }
    published.push({ kind, results: computed.results });
    requests = [...requests, ...payoutsFor({ year, kind, ballots: inputs.ballots, writeups: inputs.writeups, thanks: inputs.thanks })];
  }
  if (!published.length) {
    const ballots = Object.fromEntries(unpublished.map(u => [u.kind, u.ballots]));
    return refuse('turnout', `Only ${ballots.year} yearly and ${ballots.alltime} all-time ballots count; results need at least 5.`, 409, { ballots });
  }
  // The payouts of both kinds first, then the thanks, as the bot has always read them.
  const order = list => [...list.filter(r => r.type === 'top10.payout'), ...list.filter(r => r.type === 'top10.thanks')];
  const split = list => ({ payouts: list.filter(r => r.type === 'top10.payout'), thanks: list.filter(r => r.type === 'top10.thanks') });
  if (dryRun) return json({ dryRun: true, results, unpublished, ...split(order(requests)) });
  const queued = await store.saveFinal(db, { year, published, payouts: order(requests), admin: osuId }, now);
  if (!queued) return refuse('already', `${year} was already finalized.`, 409);
  return json({ dryRun: false, results, unpublished, ...split(queued) });
}
