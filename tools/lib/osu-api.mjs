// Fills in beatmap metadata the bot's cache lacks (its data-dump import leaves most converts without a title) from
// the osu! API, using the bot's own osu! OAuth app. Results are cached in state/beatmaps.json, so each map is only
// ever fetched once and later exports work offline.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'https://osu.ppy.sh';
const BATCH = 50; // GET /api/v2/beatmaps takes at most 50 ids
const PAUSE_MS = 1000; // well under osu!'s 60 requests/minute guideline
const MODES = { osu: 0, taiko: 1, fruits: 2, mania: 3 };

/** The cache file: { maps: { id: rawLikeBeatmap }, gone: [ids osu! no longer has] }. */
export function loadCache(file) {
  if (!fs.existsSync(file)) return { maps: {}, gone: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveCache(file, cache) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted = { maps: Object.fromEntries(Object.entries(cache.maps).sort((a, b) => a[0] - b[0])), gone: [...new Set(cache.gone)].sort((a, b) => a - b) };
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

/** An API v2 beatmap in the bot's cache shape, so the exporter can treat both sources alike. */
function toRaw(b) {
  const set = b.beatmapset || {};
  return {
    beatmap_id: b.id, beatmapset_id: b.beatmapset_id, artist: set.artist, title: set.title, creator: set.creator,
    version: b.version, difficultyrating: b.difficulty_rating, diff_approach: b.ar, diff_size: b.cs,
    diff_overall: b.accuracy, diff_drain: b.drain, bpm: b.bpm, hit_length: b.hit_length, max_combo: b.max_combo ?? null,
    approved: b.ranked, playmode: MODES[b.mode] ?? 0, playcount: b.playcount, favourite_count: set.favourite_count,
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
