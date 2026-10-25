// Loads the exported JSON (data/*.json). meta.json is always revalidated; everything else is fetched with a hash of its
// own content as a cache-buster (meta.files, written by tools/export.mjs), so a changed file is picked up at once and an
// unchanged one keeps its URL and stays cached across exports. Data from before the manifest falls back to the export
// time. CONFIG.data says where the files are: data/ here, or the release site's on development builds.

import { CONFIG } from '../config.js';
import { decodeMapsSearch } from './maps-search.js';

const cache = new Map();
let metaPromise = null;

export class NotFound extends Error {}

export function meta() {
  metaPromise ??= fetch(`${CONFIG.data}meta.json`, { cache: 'no-cache' }).then(r => {
    if (!r.ok) throw new Error('The site data hasn’t been generated yet.');
    return r.json();
  });
  return metaPromise;
}

export function load(path) {
  if (!cache.has(path)) {
    const promise = meta()
      .then(m => fetch(`${CONFIG.data}${path}?v=${m.files?.[path] ?? m.generatedAt}`))
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
 * Every map with Portuguese plays, as rows [id, setId, artist, title, version, stars, category, players, topPlayerId]
 * in no particular order. Read from the compact maps-search.json, or maps-index.json in data from before it.
 */
let mapsPromise = null;
export function mapsIndex() {
  mapsPromise ??= meta().then(m => (m.files?.['maps-search.json'] ? load('maps-search.json').then(decodeMapsSearch) : load('maps-index.json')));
  mapsPromise.catch(() => { mapsPromise = null; });
  return mapsPromise;
}

/** { total, rows }: the most-played maps (most players first), for the Maps page's first pages; mapsIndex() has them all. */
export async function mapsTop() {
  const m = await meta();
  if (m.files?.['maps-top.json']) return load('maps-top.json');
  const rows = await mapsIndex();
  return { total: rows.length, rows };
}
export const modRankings = () => load('modrankings.json');
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

/** Players by id. */
let indexPromise = null;
export function playerIndex() {
  indexPromise ??= players().then(list => new Map(list.map(p => [p.id, p])));
  return indexPromise;
}
