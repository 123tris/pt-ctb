// GET /b/<map id>: the address the bot posts for a map. It goes to the map's page here or to osu!'s, as the visitor
// chose (maplinks/maplinks.js says how, and why). An id that's no map id falls through to the static 404.
import { CONFIG } from '../../assets/js/config.js';
import { mapLink } from '../../maplinks/maplinks.js';

// meta.json names the data's current files, so it's kept a minute at most; the files it names never change.
const fetchJson = url => fetch(url, { cf: { cacheTtl: url.endsWith('/meta.json') ? 60 : 3600, cacheEverything: true } })
  .then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${url}`))));

export const onRequestGet = async ({ request, params, next }) =>
  (await mapLink(request, params.id, { data: CONFIG.data, fetchJson })) ?? next();

export const onRequestHead = onRequestGet;
