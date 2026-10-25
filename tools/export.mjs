#!/usr/bin/env node
// Builds the site's public data (data/*.json) from the PT-CTB bot's private data folder.
//
//   node --max-old-space-size=4096 tools/export.mjs [--data <bot data folder>] [--country PT] [--fetch-titles]
//                                                   [--fetch-dates] [--out <folder>]
//
// --out writes the files somewhere other than data/ (a trial export), with the exporter state kept in that folder
// too, so neither data/ nor state/state.json changes.
//
// --fetch-titles looks up maps the bot's cache has no title for on the osu! API (with the bot's osu! app, from
// OSU_CLIENT_ID/OSU_CLIENT_SECRET or the bot's user-secrets) and caches them in state/beatmaps.json, along with the
// catch star rating of converts the bot's cache has none for.
//
// --fetch-dates looks up, the same way, when ranked/loved maps the bot's cache has no date for got there (one map per
// set, 50 per request, 2.5s apart, stopping at the first rate limit) and keeps it in state/beatmaps.json. A one-off
// fill: maps fetched since then carry their dates already.
//
// Only public osu! data leaves the bot's folder: usernames, scores and profile stats for home-country players.
// Discord ids, the verification log and per-user settings are never read. Files are only rewritten when their
// content changed, so an export with nothing new leaves git clean.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadBotData, loadBeatmaps, loadPastOfficial } from './lib/source.mjs';
import { build, neededMapIds, isUnclaimedCandidate } from './lib/build.mjs';
import { loadCache, saveCache, findCredentials, fetchMissing, fetchCatchDifficulty, fetchDates, hasCatchDifficulty } from './lib/osu-api.mjs';
import { STATUS } from '../assets/js/core/model.js';
import { decodeMapsSearch } from '../assets/js/core/maps-search.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Files earlier exports wrote and this one doesn't: maps-index.json, replaced by maps-search.json and maps-top.json. */
const RETIRED = ['maps-index.json'];
const MAX_CATCH_FETCHES = 100; // per export: under two minutes at one request a second, well inside osu!'s limit

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dataRoot = path.resolve(arg('data', path.join(repoRoot, '..', 'PT-CTB-Bot-Data')));
const country = arg('country', 'PT');
const outDir = path.resolve(arg('out', path.join(repoRoot, 'data')));
const trial = outDir !== path.join(repoRoot, 'data');
const stateFile = path.join(repoRoot, 'state', 'state.json');
const stateOut = trial ? path.join(outDir, '.state.json') : stateFile;

const readJsonOr = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

/** Writes the file only when its content changed. Returns whether it did. */
function writeIfChanged(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
  return true;
}

/** Removes generated files in a sub-folder that this export no longer produces (e.g. a player who left). */
function prune(folder, keep) {
  const dir = path.join(outDir, folder);
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!keep.has(`${folder}/${file}`)) {
      fs.rmSync(path.join(dir, file));
      removed++;
    }
  }
  return removed;
}

const started = Date.now();
console.log(`Reading bot data from ${dataRoot}`);
const bot = loadBotData(dataRoot);
const needed = neededMapIds(bot, country);
const beatmaps = loadBeatmaps(dataRoot, raw => needed.has(raw.beatmap_id) || isUnclaimedCandidate(raw));
console.log(`  ${bot.players.length} tracked players, ${bot.ptCatch.length} dump players, ${beatmaps.size} beatmaps kept`);

// Top up maps the bot only knows by id (no title) from our own cache, fetching new ones when asked to.
const cacheFile = path.join(repoRoot, 'state', 'beatmaps.json');
const cache = loadCache(cacheFile);
if (cache.migrated) {
  console.log(`  dropped the osu!standard star rating of ${cache.migrated} converts in ${path.relative(repoRoot, cacheFile)}`);
  saveCache(cacheFile, cache);
}
const fetching = process.argv.includes('--fetch-titles');
const fetchingDates = process.argv.includes('--fetch-dates');
const credentials = fetching || fetchingDates ? findCredentials() : null;
if ((fetching || fetchingDates) && !credentials) console.warn('  no osu! credentials for the API (set OSU_CLIENT_ID/OSU_CLIENT_SECRET)');

const untitledIds = [...needed].filter(id => !beatmaps.get(id)?.title || beatmaps.get(id).title === 'Unknown');
if (fetching && credentials) console.log(`  fetched ${await fetchMissing(untitledIds, cache, cacheFile, credentials)} beatmaps`);
// Our cache supplies the title; star rating and combo stay the bot's, which are the catch ones (ours never has a
// convert's, as osu!'s beatmap lookup only reports the standard values for them). The ranked/loved and last-updated
// dates are the bot's too where it has them; ours only has them for maps fetched since they were added.
const difficultyOf = raw => ({ difficultyrating: raw.difficultyrating, max_combo: raw.max_combo, catch_difficulty: hasCatchDifficulty(raw) });
for (const id of untitledIds) {
  const titled = cache.maps[id];
  if (!titled) continue;
  const own = beatmaps.get(id);
  const merged = own && (hasCatchDifficulty(own) || !hasCatchDifficulty(titled)) ? { ...titled, ...difficultyOf(own) } : { ...titled };
  merged.approved_date = own?.approved_date ?? titled.approved_date ?? null;
  merged.last_update = own?.last_update ?? titled.last_update ?? null;
  beatmaps.set(id, merged);
}

// Ranked/loved dates (a set's) and last-updated times the bot's cache doesn't have: ours, from --fetch-dates.
const RANKED_LIKE = new Set([STATUS.RANKED, STATUS.APPROVED, STATUS.QUALIFIED, STATUS.LOVED]);
const isUndated = raw => RANKED_LIKE.has(Number(raw.approved)) && !raw.approved_date;
if (fetchingDates && credentials) {
  const gone = new Set(cache.gone);
  const perSet = new Map();
  for (const id of needed) {
    const raw = beatmaps.get(id);
    if (!raw || gone.has(id)) continue;
    if (isUndated(raw) && !(raw.beatmapset_id in cache.dates.sets) && !perSet.has(raw.beatmapset_id)) perSet.set(raw.beatmapset_id, id);
    else if (!raw.last_update && !(id in cache.dates.maps)) perSet.set(`map ${id}`, id);
  }
  try {
    const run = await fetchDates(perSet.values(), cache, cacheFile, credentials);
    console.log(`  dates: ${run.requests} requests, ${run.found} maps found, ${run.missing} gone from osu!${run.rateLimited ? ', stopped at a rate limit' : ''}`);
  } catch (e) {
    console.warn(`  couldn't fetch dates (${e.message}); what was fetched is kept`);
  }
}
for (const id of needed) {
  const raw = beatmaps.get(id);
  if (!raw) continue;
  const setDate = isUndated(raw) ? cache.dates.sets[raw.beatmapset_id] : null;
  const updated = raw.last_update ? null : cache.dates.maps[id];
  if (setDate || updated) beatmaps.set(id, { ...raw, ...(setDate ? { approved_date: setDate } : {}), ...(updated ? { last_update: updated } : {}) });
}

// Converts neither cache has a catch star rating for: the fruits attributes, a hundred per export at most (one
// request each), kept in our cache. Until then they show the bot's value.
const noCatch = [...needed].filter(id => beatmaps.has(id) && !hasCatchDifficulty(beatmaps.get(id)));
if (fetching && credentials) {
  const batch = noCatch.filter(id => !(id in cache.catch)).slice(0, MAX_CATCH_FETCHES);
  try {
    console.log(`  fetched the catch star rating of ${await fetchCatchDifficulty(batch, cache, cacheFile, credentials)} converts`);
  } catch (e) {
    console.warn(`  couldn't fetch catch star ratings (${e.message}); the next export retries`);
  }
}
let withoutCatch = 0;
for (const id of noCatch) {
  const { stars, combo } = cache.catch[id] ?? {};
  if (stars) beatmaps.set(id, { ...beatmaps.get(id), difficultyrating: stars, max_combo: combo ?? beatmaps.get(id).max_combo, catch_difficulty: true });
  else withoutCatch++;
}
if (withoutCatch) console.log(`  ${withoutCatch} converts have no catch star rating yet (the bot's cache or --fetch-titles fills them in)`);

const previous = { ...readJsonOr(fs.existsSync(stateOut) ? stateOut : stateFile, {}), history: readJsonOr(path.join(outDir, 'history.json'), null) };
const now = Math.floor(Date.now() / 1000);
// Players osu! reports as inactive (0pp, no rank) whose official pp we never saw live and who have no plays to
// estimate it from: the last value in the data folder's git history is all there is (see build.mjs).
const hasOfficialPlays = r => [...(r.TopConvertedScores || []), ...(r.RankedSpecificScores || [])].some(s => s?.pp > 0);
const unknownInactive = bot.players
  .filter(r => r.country === country && r.profile_updated && !(r.pp_raw > 0 && r.pp_rank) && !previous.official?.[r.user_id] && !hasOfficialPlays(r))
  .map(r => r.user_id);
const pastOfficial = unknownInactive.length ? loadPastOfficial(dataRoot, unknownInactive) : {};
if (unknownInactive.length)
  console.log(`  ${unknownInactive.length} inactive players with no plays to estimate from; ${Object.keys(pastOfficial).length} found in the data folder's history`);
const { files, state } = build({ bot, beatmaps, homeCountry: country, now, state: previous, pastOfficial });

// meta.json lists a hash of every other file's content, which the site puts on that file's URL (core/data.js): a file
// keeps its URL, and stays in visitors' caches, until its content changes.
const hash = text => createHash('sha256').update(text).digest('base64url').slice(0, 10);
let changed = 0, bytes = 0;
const versions = {};
for (const [name, content] of Object.entries(files)) {
  // generatedAt changes every run; only bump meta.json when something else did, so idle runs stay clean.
  if (name === 'meta.json') continue;
  const text = JSON.stringify(content);
  bytes += text.length;
  versions[name] = hash(text);
  if (writeIfChanged(path.join(outDir, name), text)) changed++;
}
const keep = new Set(Object.keys(files));
let removed = prune('players', keep) + prune('maps', keep);
// Files earlier exports wrote that nothing reads any more.
for (const name of RETIRED) {
  if (!fs.existsSync(path.join(outDir, name))) continue;
  fs.rmSync(path.join(outDir, name));
  removed++;
}
const metaText = JSON.stringify({ ...files['meta.json'], files: versions });
// Also when only the manifest differs (the first export that writes one), so the site never reads stale hashes.
const metaFile = path.join(outDir, 'meta.json');
if (changed || removed || !fs.existsSync(metaFile) || JSON.stringify(readJsonOr(metaFile, {}).files) !== JSON.stringify(versions)) {
  writeIfChanged(metaFile, metaText);
  changed++;
}
writeIfChanged(stateOut, JSON.stringify(state));

const untitled = decodeMapsSearch(files['maps-search.json']).filter(row => !row[3]).length;
console.log(`  ${Object.keys(files).length} files (${(bytes / 1e6).toFixed(1)} MB), ${changed} changed, ${removed} removed` +
  ` in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (untitled) console.log(`  ${untitled} maps have no title in the bot's beatmap cache (shown by id)`);
