// Loads the exported JSON (data/*.json). meta.json is always revalidated; everything else is fetched with the
// export's timestamp as a cache-buster, so a new export is picked up at once and old files stay cacheable.
// CONFIG.data says where they are: data/ here, or the release site's on development builds.

import { CONFIG } from '../config.js';

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
      .then(m => fetch(`${CONFIG.data}${path}?v=${m.generatedAt}`))
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
export const mapsIndex = () => load('maps-index.json');
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
