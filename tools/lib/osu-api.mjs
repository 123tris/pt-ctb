// Fills in beatmap metadata the bot's cache lacks (its data-dump import leaves most converts without a title) from
// the osu! API, using the bot's own osu! OAuth app. Results are cached in state/beatmaps.json, so each map is only
// ever fetched once and later exports work offline.
//
// Star ratings: GET /api/v2/beatmaps reports a map's difficulty in its own mode, so for a convert (an osu!standard map
// played in catch) that's the standard star rating and combo. Those are never kept; a convert's catch values come from
// the bot's cache, or from the fruits difficulty attributes (fetchCatchDifficulty), kept under `catch`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'https://osu.ppy.sh';
const BATCH = 50; // GET /api/v2/beatmaps takes at most 50 ids
const PAUSE_MS = 1000; // well under osu!'s 60 requests/minute guideline
const MODES = { osu: 0, taiko: 1, fruits: 2, mania: 3 };

/** Whether a cached map's difficultyrating/max_combo are osu!catch's: a catch map's own, or a convert's fruits values. */
export const hasCatchDifficulty = raw => Number(raw?.playmode) === MODES.fruits || raw?.catch_difficulty === true;

/**
 * The cache file: { maps: { id: rawLikeBeatmap }, gone: [ids osu! no longer has], catch: { id: { stars, combo } },
 * dates: { sets: { setId: ranked_date | null }, maps: { id: last_updated | null } } }.
 * `dates` holds what fetchDates found for maps the bot's cache has no ranked/loved date for; a set's ranked date is
 * the same for each of its difficulties.
 * `migrated` counts converts whose standard star rating was dropped on load (the cache predates that rule).
 */
export function loadCache(file) {
  const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { maps: {}, gone: [] };
  cache.catch ??= {};
  cache.dates ??= {};
  cache.dates.sets ??= {};
  cache.dates.maps ??= {};
  cache.migrated = 0;
  for (const raw of Object.values(cache.maps)) {
    if (!hasCatchDifficulty(raw) && (raw.difficultyrating != null || raw.max_combo != null)) {
      raw.difficultyrating = null;
      raw.max_combo = null;
      cache.migrated++;
    }
  }
  return cache;
}

export function saveCache(file, cache) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const byId = entries => Object.fromEntries(Object.entries(entries).sort((a, b) => a[0] - b[0]));
  const sorted = {
    maps: byId(cache.maps), gone: [...new Set(cache.gone)].sort((a, b) => a - b), catch: byId(cache.catch ?? {}),
    dates: { sets: byId(cache.dates?.sets ?? {}), maps: byId(cache.dates?.maps ?? {}) },
  };
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(sorted));
  fs.renameSync(`${file}.tmp`, file);
}

/** osu! credentials: OSU_CLIENT_ID/OSU_CLIENT_SECRET, else the bot's user-secrets (the "Osu" section). */
export function findCredentials() {
  if (process.env.OSU_CLIENT_ID && process.env.OSU_CLIENT_SECRET)
    return { id: process.env.OSU_CLIENT_ID, secret: process.env.OSU_CLIENT_SECRET };
  const appData = process.env.APPDATA || path.join(os.homedir(), '.microsoft', 'usersecrets');
  const file = process.env.APPDATA
    ? path.join(appData, 'Microsoft', 'UserSecrets', 'pt-ctb-discord-bot', 'secrets.json')
    : path.join(appData, 'pt-ctb-discord-bot', 'secrets.json');
  if (!fs.existsSync(file)) return null;
  const secrets = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const id = secrets['Osu:ClientId'] ?? secrets.Osu?.ClientId;
  const secret = secrets['Osu:ClientSecret'] ?? secrets.Osu?.ClientSecret;
  return id && secret ? { id: String(id), secret: String(secret) } : null;
}

async function token({ id, secret }) {
  const response = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: Number(id), client_secret: secret, grant_type: 'client_credentials', scope: 'public' }),
  });
  if (!response.ok) throw new Error(`osu! token request failed: ${response.status}`);
  return (await response.json()).access_token;
}

/**
 * An API v2 beatmap in the bot's cache shape, so the exporter can treat both sources alike. A convert's star rating
 * and combo are left out: the endpoint's are osu!standard's.
 */
function toRaw(b) {
  const set = b.beatmapset || {};
  const native = MODES[b.mode] === MODES.fruits;
  return {
    beatmap_id: b.id, beatmapset_id: b.beatmapset_id, artist: set.artist, title: set.title, creator: set.creator,
    version: b.version, difficultyrating: native ? b.difficulty_rating : null, diff_approach: b.ar, diff_size: b.cs,
    diff_overall: b.accuracy, diff_drain: b.drain, bpm: b.bpm, hit_length: b.hit_length,
    max_combo: native ? b.max_combo ?? null : null,
    approved: b.ranked, approved_date: set.ranked_date ?? null, last_update: b.last_updated ?? null, playmode: MODES[b.mode] ?? 0, playcount: b.playcount,
    favourite_count: set.favourite_count,
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Fetches every id not already cached or known to be gone, saving progress as it goes. */
export async function fetchMissing(ids, cache, cacheFile, credentials, log = console.log) {
  const gone = new Set(cache.gone);
  const todo = [...ids].filter(id => !cache.maps[id] && !gone.has(id)).sort((a, b) => a - b);
  if (!todo.length) return 0;
  log(`  fetching ${todo.length} beatmaps from the osu! API (${Math.ceil(todo.length / BATCH)} requests)…`);

  let bearer = await token(credentials);
  let fetched = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const url = `${API}/api/v2/beatmaps?${batch.map(id => `ids[]=${id}`).join('&')}`;
    let response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
    if (response.status === 401) {
      bearer = await token(credentials);
      response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
    }
    if (response.status === 429) {
      log('  rate limited, waiting a minute');
      await sleep(60000);
      i -= BATCH;
      continue;
    }
    if (!response.ok) throw new Error(`osu! beatmaps request failed: ${response.status}`);

    const { beatmaps } = await response.json();
    const found = new Set();
    for (const b of beatmaps) {
      cache.maps[b.id] = toRaw(b);
      found.add(b.id);
      fetched++;
    }
    for (const id of batch) if (!found.has(id)) cache.gone.push(id);

    if ((i / BATCH) % 20 === 19) {
      saveCache(cacheFile, cache);
      log(`  …${Math.min(i + BATCH, todo.length)}/${todo.length}`);
    }
    await sleep(PAUSE_MS);
  }
  saveCache(cacheFile, cache);
  return fetched;
}

/**
 * Fetches the nomod osu!catch star rating and max combo of every id not already in `cache.catch` (one POST
 * /beatmaps/{id}/attributes each), for converts neither the bot nor our own cache has catch values for.
 * A map osu! has no attributes for is remembered as { stars: null } so it isn't asked for again.
 */
export async function fetchCatchDifficulty(ids, cache, cacheFile, credentials, log = console.log) {
  const todo = [...ids].filter(id => !(id in cache.catch)).sort((a, b) => a - b);
  if (!todo.length) return 0;
  log(`  fetching the catch star rating of ${todo.length} converts from the osu! API…`);

  let bearer = await token(credentials);
  let fetched = 0;
  for (let i = 0; i < todo.length; i++) {
    const id = todo[i];
    const post = () => fetch(`${API}/api/v2/beatmaps/${id}/attributes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleset_id: MODES.fruits, mods: 0 }),
    });
    let response = await post();
    if (response.status === 401) {
      bearer = await token(credentials);
      response = await post();
    }
    // The attributes endpoint runs out sooner than the others, and the bot shares this osu! app: rather than wait
    // it out, stop here and leave the rest for the next export.
    if (response.status === 429) {
      log(`  rate limited after ${i} requests; the rest wait for the next export`);
      break;
    }
    if (response.status === 404 || response.status === 422) {
      cache.catch[id] = { stars: null };
    } else if (!response.ok) {
      throw new Error(`osu! attributes request failed: ${response.status}`);
    } else {
      const { attributes } = await response.json();
      // max_combo is 0 for maps osu! hasn't processed for a leaderboard (graveyard); that's "unknown", not 0.
      cache.catch[id] = { stars: attributes?.star_rating ?? null, combo: attributes?.max_combo || null };
      fetched++;
    }

    if (i % 50 === 49) {
      saveCache(cacheFile, cache);
      log(`  …${i + 1}/${todo.length}`);
    }
    await sleep(PAUSE_MS);
  }
  saveCache(cacheFile, cache);
  return fetched;
}

/**
 * Looks up the ranked/loved date (a set's ranked_date) and last-updated time of the given maps, 50 per
 * GET /api/v2/beatmaps request with `pauseMs` between requests, into cache.dates. Callers pass one map per set when
 * only the ranked date is wanted. Stops at the first 429 (the bot shares this osu! app's rate limit) and reports it.
 * Returns { requests, found, missing, rateLimited }.
 */
export async function fetchDates(ids, cache, cacheFile, credentials, { pauseMs = 2500, log = console.log } = {}) {
  const todo = [...ids].sort((a, b) => a - b);
  const result = { requests: 0, found: 0, missing: 0, rateLimited: false };
  if (!todo.length) return result;
  log(`  fetching the ranked/updated dates of ${todo.length} maps from the osu! API (${Math.ceil(todo.length / BATCH)} requests, ${pauseMs / 1000}s apart)…`);

  let bearer = await token(credentials);
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const url = `${API}/api/v2/beatmaps?${batch.map(id => `ids[]=${id}`).join('&')}`;
    let response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
    result.requests++;
    if (response.status === 401) {
      bearer = await token(credentials);
      response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
      result.requests++;
    }
    if (response.status === 429) {
      result.rateLimited = true;
      log(`  rate limited after ${result.requests} requests; stopping (${todo.length - i} maps left for another run)`);
      break;
    }
    if (!response.ok) throw new Error(`osu! beatmaps request failed: ${response.status}`);

    const { beatmaps } = await response.json();
    const found = new Set();
    for (const b of beatmaps) {
      cache.dates.sets[b.beatmapset_id] = b.beatmapset?.ranked_date ?? null;
      cache.dates.maps[b.id] = b.last_updated ?? null;
      found.add(b.id);
    }
    result.found += found.size;
    for (const id of batch) {
      if (found.has(id)) continue;
      cache.gone.push(id);
      result.missing++;
    }

    if (result.requests % 20 === 0) {
      saveCache(cacheFile, cache);
      log(`  …${Math.min(i + BATCH, todo.length)}/${todo.length}`);
    }
    if (i + BATCH < todo.length) await sleep(pauseMs);
  }
  saveCache(cacheFile, cache);
  return result;
}
