// What the Top 10 checks against the site's exported data (R2, CONFIG.data, or DATA_URL where a test or local run sets
// one). Never the osu! API: the bot and the exporter share its 60-a-minute budget.
//
//   ptPlayers   who counts as a PT player: the ids in players.json, the exporter's home-country players (restricted
//               ones are already left out there).
//   findScore   a showcased score: its tuple in the player's own file (players/<id>.json), found by its score id.
//   scoreOwner  whose score an id is, when the browser didn't say: the submitter's own file, then activity.json's
//               recent plays.
//
// Every data file but meta.json has its content hash in its name (assets/js/core/data-name.js), so it never changes:
// those are kept in the Cache API for a day, and players.json's id list in memory for the life of the worker.
// meta.json is fetched with a 60-second edge cache and kept in memory for 30 seconds. Free plan: a few cached
// subrequests per call, and no D1 at all.

import { CONFIG } from '../assets/js/config.js';
import { hashedName } from '../assets/js/core/data-name.js';

// The score tuple's fields the checks read (S in assets/js/core/model.js).
export const S = { MAP: 0, GRADE: 6, TIME: 8, ID: 11 };

const META_MEMO_SECONDS = 30;
const metaMemo = new Map(); // base → { at, meta }
const indexMemo = new Map(); // players.json's hashed address → Map id → name

/** Forgets what's kept in memory (for tests, which swap the data out). */
export function forgetData() {
  metaMemo.clear();
  indexMemo.clear();
}

const baseOf = env => env?.DATA_URL || CONFIG.data;

async function metaOf(base) {
  const now = Date.now() / 1000;
  const kept = metaMemo.get(base);
  if (kept && now - kept.at < META_MEMO_SECONDS) return kept.meta;
  const res = await fetch(new URL('meta.json', base), { cf: { cacheTtl: 60 } });
  if (!res.ok) throw new Error(`meta.json answered HTTP ${res.status}.`);
  const meta = await res.json();
  metaMemo.set(base, { at: now, meta });
  return meta;
}

/** A data file's address now: its hashed name when meta.json lists it, its plain one otherwise (older data). */
async function addressOf(base, path) {
  const hash = (await metaOf(base)).files?.[path];
  return { url: String(new URL(hash ? hashedName(path, hash) : path, base)), immutable: Boolean(hash) };
}

/** A data file's text, or null when the data has no such file. Hash-named ones go through the Cache API. */
async function dataText(base, path) {
  const { url, immutable } = await addressOf(base, path);
  const cache = immutable ? globalThis.caches?.default : null;
  if (cache) {
    const hit = await cache.match(url).catch(() => null);
    if (hit) return hit.text();
  }
  const res = await fetch(url, { cf: immutable ? { cacheTtl: 86400, cacheEverything: true } : { cacheTtl: 60 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} answered HTTP ${res.status}.`);
  const text = await res.text();
  if (cache) {
    await cache.put(url, new Response(text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } })).catch(() => {});
  }
  return text;
}

/** The PT players: Map osu! id → name. Throws when the data can't be read. */
export async function ptPlayers(env) {
  const base = baseOf(env);
  const { url } = await addressOf(base, 'players.json');
  if (indexMemo.has(url)) return indexMemo.get(url);
  const text = await dataText(base, 'players.json');
  const list = text ? JSON.parse(text) : [];
  const index = new Map((Array.isArray(list) ? list : list.players ?? []).filter(p => Number.isSafeInteger(p?.id)).map(p => [p.id, p.name ?? '']));
  indexMemo.set(url, index);
  return index;
}

// ---- Scores ---------------------------------------------------------------------------------------------------------

/**
 * A score link or id as the score ids it could be in the site's data (S.ID: a lazer score id as is, a legacy one
 * negated). Read the way the bot's /addscore reads links (OsuFormat.TryParseScoreId): any address whose path has
 * /scores/ and ends in a number. /scores/<id> is a lazer id; /scores/fruits/<id> a legacy one. A bare number could be
 * either. Returns { ids: [...] }, { error: 'mode' } for another ruleset's score, or null for anything else.
 */
export function parseScore(input) {
  const bare = typeof input === 'number' ? (Number.isSafeInteger(input) ? String(input) : '') : String(input ?? '').trim();
  if (/^\d{1,15}$/.test(bare)) {
    const n = Number(bare);
    return n > 0 && Number.isSafeInteger(n) ? { ids: [n, -n] } : null;
  }
  let url;
  try { url = new URL(bare); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || !/(^|\.)ppy\.sh$/i.test(url.hostname)) return null;
  const m = /\/scores\/(?:([a-z]+)\/)?(\d{1,15})\/?$/i.exec(url.pathname);
  if (!m) return null;
  const n = Number(m[2]);
  if (!(n > 0) || !Number.isSafeInteger(n)) return null;
  if (!m[1]) return { ids: [n] };
  return m[1].toLowerCase() === 'fruits' ? { ids: [-n] } : { error: 'mode' };
}

/**
 * The score tuples in a player file's text whose S.ID is `id`. The file can be over a megabyte, so it isn't parsed:
 * a tuple ends with its id (",<id>]"), and only that tuple is.
 */
export function tuplesWithId(text, id) {
  const found = [];
  const needle = `,${id}]`;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    const start = text.lastIndexOf('[', at);
    if (start === -1) continue;
    let tuple;
    try { tuple = JSON.parse(text.slice(start, at + needle.length)); } catch { continue; }
    if (Array.isArray(tuple) && tuple.length > S.ID && tuple[S.ID] === id && typeof tuple[S.GRADE] === 'string' && Number.isFinite(tuple[S.TIME])) found.push(tuple);
  }
  return found;
}

/**
 * A player's score in the site's data: { player, ref (its S.ID), beatmap, time } for the first of `ids` found in
 * players/<player>.json, or null.
 */
export async function findScore(env, player, ids) {
  const text = await dataText(baseOf(env), `players/${player}.json`);
  if (!text) return null;
  for (const id of ids) {
    const [tuple] = tuplesWithId(text, id);
    if (tuple) return { player, ref: id, beatmap: tuple[S.MAP], time: tuple[S.TIME] };
  }
  return null;
}

/** Who set a score, from activity.json's recent plays and events; null when it isn't there. */
export async function recentOwner(env, ids) {
  const text = await dataText(baseOf(env), 'activity.json');
  if (!text) return null;
  const activity = JSON.parse(text);
  for (const e of activity.events ?? []) if (Array.isArray(e?.s) && ids.includes(e.s[S.ID])) return e.u;
  for (const row of activity.recent ?? []) if (Array.isArray(row) && ids.includes(row[2 + S.ID])) return row[0];
  return null;
}

/** The UTC year a score was set in (Lisbon is UTC+0 around New Year, so it's Lisbon's year too). */
export const yearOf = time => new Date(time * 1000).getUTCFullYear();
