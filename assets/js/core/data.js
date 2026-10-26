// Loads the exported JSON. meta.json is always revalidated; every other file is fetched by a name that carries the hash
// of its own content (meta.files, written by tools/export.mjs; core/data-name.js), so a changed file is picked up at
// once and an unchanged one keeps its address and stays cached across exports. A file meta.json doesn't list doesn't
// exist (404 → NotFound). CONFIG.data says where the files are: https://data.ptcatch.com (R2, kept current by
// publish.ps1), or data/ with npm run serve -- --local-data, which maps the hashed names back to the plain files.

import { CONFIG } from '../config.js';
import { decodeMapsSearch } from './maps-search.js';
import { hashedName } from './data-name.js';

const cache = new Map();
let metaPromise = null;
/** meta.json once it has loaded, for avatarThumbs. */
let loadedMeta = null;

export class NotFound extends Error {}

export function meta() {
  metaPromise ??= fetch(`${CONFIG.data}meta.json`, { cache: 'no-cache' }).then(r => {
    if (!r.ok) throw new Error('The site data hasn’t been generated yet.');
    return r.json();
  }).then(m => (loadedMeta = m));
  return metaPromise;
}

/**
 * The addresses of a player's avatar thumbnails, { 64, 128 } (WebP, tools/lib/avatars.mjs), or null when the export has
 * none for them (they aren't on players.json) or meta.json hasn't loaded yet. Pages load it before drawing any player.
 */
export function avatarThumbs(id) {
  const files = loadedMeta?.files;
  const names = { 64: `avatars/${id}-64.webp`, 128: `avatars/${id}-128.webp` };
  if (!files?.[names[64]] || !files[names[128]]) return null;
  return { 64: `${CONFIG.data}${hashedName(names[64], files[names[64]])}`, 128: `${CONFIG.data}${hashedName(names[128], files[names[128]])}` };
}

export function load(path) {
  if (!cache.has(path)) {
    const promise = meta()
      .then(m => fetch(m.files?.[path] ? `${CONFIG.data}${hashedName(path, m.files[path])}` : `${CONFIG.data}${path}?v=${m.generatedAt}`))
      .then(r => {
        if (r.status === 404) throw new NotFound(path);
        if (!r.ok) throw new Error(`Couldn’t load ${path} (${r.status}).`);
        return r.json();
      });
    promise.catch(() => cache.delete(path));
    cache.set(path, promise);
  }
  return cache.get(path);
}

export const players = () => load('players.json');
export const playerFile = id => load(`players/${id}.json`);

/**
 * A player's small first file (players/{id}-head.json: each list's first page, the list lengths and the profile extras
 * worked out at export), or null when the data has none (from before head files): load playerFile then.
 */
export async function playerHead(id) {
  const m = await meta();
  return m.files?.[`players/${id}-head.json`] ? load(`players/${id}-head.json`) : null;
}

/**
 * Every map with Portuguese plays, as rows [id, setId, artist, title, version, stars, category, players, topPlayerId]
 * in no particular order, decoded from the compact maps-search.json.
 */
let mapsPromise = null;
export function mapsIndex() {
  mapsPromise ??= load('maps-search.json').then(decodeMapsSearch);
  mapsPromise.catch(() => { mapsPromise = null; });
  return mapsPromise;
}

/** { total, rows }: the most-played maps (most players first), for the Maps page's first pages; mapsIndex() has them all. */
export const mapsTop = () => load('maps-top.json');
export const modRankings = () => load('modrankings.json');
/** { cap, filters, plays: [[userId, category, ...score]] (most pp first), maps }, or null for data from before it. */
export const topPlays = () => load('topplays.json').catch(e => (e instanceof NotFound ? null : Promise.reject(e)));
export const dan = () => load('dan.json');
export const activity = () => load('activity.json');
export const records = () => load('records.json');
export const challenges = () => load('challenges.json');
export const quiz = () => load('quiz.json');
export const history = () => load('history.json');

/** A map's board: { m: meta tuple | null, c: category, s: [[userId, ...score]] }, or null if no PT scores. */
export async function mapEntry(id) {
  const bucket = await load(`maps/${id % 128}.json`).catch(e => (e instanceof NotFound ? {} : Promise.reject(e)));
  return bucket[id] ?? null;
}

/**
 * A mapset's difficulties, [[mapId, version, stars, players]] easiest first, or null for a set with one, or data from
 * before sets/ (then the map page shows no switcher).
 */
export async function mapSet(setId) {
  const path = `sets/${setId % 128}.json`;
  const m = await meta();
  return m.files?.[path] ? (await load(path))[setId] ?? null : null;
}

/** Players by id. */
let indexPromise = null;
export function playerIndex() {
  indexPromise ??= players().then(list => new Map(list.map(p => [p.id, p])));
  return indexPromise;
}
