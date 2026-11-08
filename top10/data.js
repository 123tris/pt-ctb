// What the Top 10 checks against the site's exported data (R2, CONFIG.data, or DATA_URL where a test or local run sets
// one). Never the osu! API: the bot and the exporter share its 60-a-minute budget.
//
//   ptPlayers   who counts as a PT player: the ids in players.json, the exporter's home-country players (restricted
//               ones are already left out there).
//   findPlay    a play: its tuple in the player's own file (players/<id>.json), by its score id or by map (the
//               best one set in the season's year), as a card the showcase and the cites show.
//   recentOwner whose score an id is, when the browser didn't say: activity.json's recent plays (after the
//               submitter's own file).
//
// Every data file but meta.json has its content hash in its name (assets/js/core/data-name.js), so it never changes:
// those are kept in the Cache API for a day, and players.json's id list in memory for the life of the worker.
// meta.json is fetched with a 60-second edge cache and kept in memory for 30 seconds. Free plan: a few cached
// subrequests per call, and no D1 at all.

import { CONFIG } from '../assets/js/config.js';
import { hashedName } from '../assets/js/core/data-name.js';
import { M, S, modString } from '../assets/js/core/model.js';
import { scoreUrl, sidRef } from './refs.js';


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

// ---- Plays ----------------------------------------------------------------------------------------------------------

/** A player's own file (players/<id>.json) as text, or null when the export has none. */
export const playerFile = (env, player) => dataText(baseOf(env), `players/${player}.json`);

/**
 * The JSON array that starts at text[start] ('['), as text: strings (map titles can hold brackets) and nesting are
 * stepped over. Null when it doesn't close.
 */
function arrayAt(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

const isScoreTuple = (t, map) => Array.isArray(t) && t.length > S.TIME && (map === undefined || t[S.MAP] === map)
  && typeof t[S.GRADE] === 'string' && Number.isFinite(t[S.TIME]) && typeof t[S.PP] === 'number';

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
    if (isScoreTuple(tuple) && tuple.length > S.ID && tuple[S.ID] === id) found.push(tuple);
  }
  return found;
}

/** The score tuples in a player file's text on a map (they start "[<beatmap>,"), without parsing the whole file. */
export function tuplesOnMap(text, beatmap) {
  const found = [];
  const needle = `[${beatmap},`;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const slice = arrayAt(text, at);
    let tuple;
    try { tuple = slice && JSON.parse(slice); } catch { continue; }
    if (isScoreTuple(tuple, beatmap)) found.push(tuple);
  }
  return found;
}

/** The UTC year a score was set in (Lisbon is UTC+0 around New Year, so it's Lisbon's year too). */
export const yearOf = time => new Date(time * 1000).getUTCFullYear();

/** A player's best play on a map set in `year` (the most pp, then the latest), from their file's text, or null. */
export function bestOnMap(text, beatmap, year) {
  return tuplesOnMap(text, beatmap).filter(t => yearOf(t[S.TIME]) === year)
    .sort((a, b) => b[S.PP] - a[S.PP] || b[S.TIME] - a[S.TIME])[0] ?? null;
}

/** A map's tuple (M in model.js) from a player file's `maps`, or null. */
export function mapTuple(text, beatmap) {
  const at = text.indexOf(`"${beatmap}":[`);
  if (at === -1) return null;
  try { return JSON.parse(arrayAt(text, text.indexOf('[', at))); } catch { return null; }
}

/**
 * A play as the showcase and the cites show it (the UI's ScoreCard): { ref, player, map, set, artist, title, version,
 * stars, pp, acc, miss, combo, mods ("HDHR", "NM"), grade, time (unix seconds), url (its osu! page, or null) }.
 */
export function cardFromTuple(tuple, map, { ref, player }) {
  return {
    ref, player, map: tuple[S.MAP], set: map?.[M.SET] ?? null, artist: map?.[M.ARTIST] ?? null, title: map?.[M.TITLE] ?? null,
    version: map?.[M.VERSION] ?? null, stars: map?.[M.STARS] ?? null, pp: tuple[S.PP] ?? null, acc: tuple[S.ACC] ?? null,
    miss: tuple[S.MISS] ?? null, combo: tuple[S.COMBO] ?? null, mods: modString(tuple[S.MODS] ?? 0), grade: tuple[S.GRADE] ?? null,
    time: tuple[S.TIME] ?? null, url: scoreUrl(ref),
  };
}

/**
 * A player's play in the exported data, by its score ids (`sids`, S.ID form) or by map (`beatmap`: their best there
 * in `year`): { player, sid (or null), beatmap, time, refs (every ref it's known by), ref (the canonical one), card },
 * or null. A play found by id is also known as map:<beatmap>:<player> when it's that player's best there that year.
 */
export async function findPlay(env, player, { sids = null, beatmap = null, year }) {
  const text = await playerFile(env, player);
  if (!text) return null;
  let tuple = null;
  if (sids) {
    for (const id of sids) {
      [tuple] = tuplesWithId(text, id);
      if (tuple) break;
    }
  } else {
    tuple = bestOnMap(text, beatmap, year);
  }
  if (!tuple) return null;
  const sid = tuple.length > S.ID && Number.isSafeInteger(tuple[S.ID]) && tuple[S.ID] !== 0 ? tuple[S.ID] : null;
  const best = bestOnMap(text, tuple[S.MAP], yearOf(tuple[S.TIME]));
  const isBest = best && best[S.TIME] === tuple[S.TIME] && best[S.SCORE] === tuple[S.SCORE];
  const refs = [sidRef(sid), isBest ? `map:${tuple[S.MAP]}:${player}` : null].filter(Boolean);
  const ref = refs[0] ?? `map:${tuple[S.MAP]}:${player}`;
  return { player, sid, beatmap: tuple[S.MAP], time: tuple[S.TIME], refs: refs.length ? refs : [ref], ref, card: cardFromTuple(tuple, mapTuple(text, tuple[S.MAP]), { ref, player }) };
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
