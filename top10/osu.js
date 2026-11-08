// The osu! API, for the score showcase only (TOP10-DESIGN.md §13.9): one call when an entry is submitted, never on a
// read. It uses the site's own osu! app, the one sign-in uses (OSU_CLIENT_ID and OSU_CLIENT_SECRET, signin/oauth.js),
// with a client-credentials token (scope "public"), so the bot's 60-a-minute budget isn't touched. The token is kept in
// the worker's memory until a minute before it runs out (osu! gives a day); a cold worker asks for a new one. It isn't
// put in the Cache API, which is shared with the zone's HTTP cache.
//
//   fetchScore      GET /api/v2/scores/{id}, or /api/v2/scores/fruits/{legacyId} for a legacy score id
//   lookupBeatmap   GET /api/v2/beatmaps/lookup?checksum=…, for an uploaded replay's map
//
// Both answer null when osu! says 404, and throw OsuUnavailable when osu! can't be asked (no app set up here, no token,
// a network error or another status), so the caller can fall back to the site's exported data.

import { MOD, modString } from '../assets/js/core/model.js';

const API_VERSION = '20240529'; // the score format with ruleset_id, has_replay, ended_at and legacy_score_id
const MODES = { osu: 0, taiko: 1, fruits: 2, mania: 3 };
const tokens = new Map(); // client id → { token, until (unix seconds) }

export class OsuUnavailable extends Error {}

/** Forgets the kept token (for tests). */
export const forgetOsuToken = () => tokens.clear();

/** Whether this copy of the site can ask osu! (the release site has both; dev.ptcatch.com may have neither). */
export const osuConfigured = env => Boolean(env?.OSU_CLIENT_ID && env?.OSU_CLIENT_SECRET);

const osu = env => env.OSU_URL || 'https://osu.ppy.sh'; // OSU_URL only exists so tests can point at a fake osu!

async function appToken(env, now) {
  if (!osuConfigured(env)) throw new OsuUnavailable('The site’s osu! app isn’t set up here.');
  const kept = tokens.get(String(env.OSU_CLIENT_ID));
  if (kept && kept.until - 60 > now) return kept.token;
  let res;
  try {
    res = await fetch(new URL('/oauth/token', osu(env)), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: String(env.OSU_CLIENT_ID), client_secret: env.OSU_CLIENT_SECRET, grant_type: 'client_credentials', scope: 'public' }),
    });
  } catch (e) {
    throw new OsuUnavailable(`osu!’s token: ${e?.message}`);
  }
  const body = res.ok ? await res.json().catch(() => null) : null;
  if (typeof body?.access_token !== 'string') throw new OsuUnavailable(`osu!’s token: HTTP ${res.status}`);
  tokens.set(String(env.OSU_CLIENT_ID), { token: body.access_token, until: now + (Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600) });
  return body.access_token;
}

/** One GET on the API: the JSON, or null for a 404. */
async function get(env, path, now) {
  const token = await appToken(env, now);
  let res;
  try {
    res = await fetch(new URL(path, osu(env)), { headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'x-api-version': API_VERSION } });
  } catch (e) {
    throw new OsuUnavailable(`osu!: ${e?.message}`);
  }
  if (res.status === 404) return null;
  if (res.status === 401) tokens.delete(String(env.OSU_CLIENT_ID)); // revoked or expired early: the next call gets a new one
  if (!res.ok) throw new OsuUnavailable(`osu! answered HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new OsuUnavailable('osu! answered something that isn’t JSON');
  return body;
}

const positive = v => (Number.isSafeInteger(v) && v > 0 ? v : null);
const number = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round2 = v => (v === null ? null : Math.round(v * 100) / 100);

/** Mods as osu! lists them (acronyms, or objects with one) → "HDHR", "NM", in the site's order; CL (classic) left out. */
export const apiMods = mods => modString((Array.isArray(mods) ? mods : []).reduce((mask, m) => mask | (MOD[typeof m === 'string' ? m : m?.acronym] ?? 0), 0));

/**
 * A score from the API, in the fields the showcase needs: { solo, legacy (ids or null), ruleset (0–3), userId,
 * username, beatmapId, checksum (the map's MD5), map { set, artist, title, version, stars }, time (when it was set,
 * unix seconds), hasReplay, pp, acc (%), combo, miss, mods ("HDHR", "NM"), grade }. Reads the 2024 format, and the older
 * one in case osu! ignores the version header.
 */
export function scoreFromApi(s, { legacyRoute = false } = {}) {
  const current = s.ruleset_id !== undefined;
  const ruleset = current ? s.ruleset_id : Number.isInteger(s.mode_int) ? s.mode_int : MODES[s.mode];
  const ended = Date.parse(s.ended_at ?? s.created_at ?? '');
  const set = s.beatmapset ?? s.beatmap?.beatmapset;
  const stats = s.statistics ?? {};
  const accuracy = number(s.accuracy);
  return {
    solo: positive(current ? s.id : legacyRoute ? null : s.id),
    legacy: positive(current ? s.legacy_score_id : legacyRoute ? s.id : null),
    ruleset: Number.isInteger(ruleset) ? ruleset : null,
    userId: positive(s.user_id ?? s.user?.id),
    username: typeof s.user?.username === 'string' ? s.user.username : null,
    beatmapId: positive(s.beatmap_id ?? s.beatmap?.id),
    checksum: typeof s.beatmap?.checksum === 'string' ? s.beatmap.checksum.toLowerCase() : null,
    map: set || s.beatmap ? {
      set: positive(set?.id ?? s.beatmap?.beatmapset_id), artist: set ? String(set.artist ?? '') : null, title: set ? String(set.title ?? '') : null,
      version: s.beatmap?.version !== undefined ? String(s.beatmap.version) : null, stars: number(s.beatmap?.difficulty_rating),
    } : null,
    time: Number.isFinite(ended) ? Math.floor(ended / 1000) : null,
    hasReplay: Boolean(s.has_replay ?? s.replay),
    pp: number(s.pp),
    acc: accuracy === null ? null : round2(accuracy <= 1 ? accuracy * 100 : accuracy),
    combo: number(s.max_combo),
    miss: number(stats.miss ?? stats.count_miss),
    mods: apiMods(s.mods),
    grade: typeof s.rank === 'string' ? s.rank : null,
  };
}

/** A score by its lazer id ({ id }) or legacy id ({ id, legacy: true }): scoreFromApi's shape, or null if osu! has none. */
export async function fetchScore(env, { id, legacy = false }, now = Math.floor(Date.now() / 1000)) {
  const body = await get(env, legacy ? `/api/v2/scores/fruits/${id}` : `/api/v2/scores/${id}`, now);
  return body ? scoreFromApi(body, { legacyRoute: legacy }) : null;
}

/** A map by its MD5 (an .osr's beatmap hash): { id, set, artist, title, version, stars }, or null if osu! doesn't know it. */
export async function lookupBeatmap(env, md5, now = Math.floor(Date.now() / 1000)) {
  const body = await get(env, `/api/v2/beatmaps/lookup?${new URLSearchParams({ checksum: md5 })}`, now);
  if (!positive(body?.id)) return null;
  const set = body.beatmapset ?? {};
  return {
    id: body.id, set: positive(set.id ?? body.beatmapset_id), artist: String(set.artist ?? ''), title: String(set.title ?? ''),
    version: String(body.version ?? ''), stars: number(body.difficulty_rating),
  };
}
