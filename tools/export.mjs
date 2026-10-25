#!/usr/bin/env node
// Builds the site's public data (data/*.json) from the PT-CTB bot's private data folder.
//
//   node --max-old-space-size=4096 tools/export.mjs [--data <bot data folder>] [--country PT] [--fetch-titles]
//                                                   [--out <folder>]
//
// --out writes the files somewhere other than data/ (a trial export), with the exporter state kept in that folder
// too, so neither data/ nor state/state.json changes.
//
// --fetch-titles looks up maps the bot's cache has no title for on the osu! API (with the bot's osu! app, from
// OSU_CLIENT_ID/OSU_CLIENT_SECRET or the bot's user-secrets) and caches them in state/beatmaps.json, along with the
// catch star rating of converts the bot's cache has none for.
//
// Only public osu! data leaves the bot's folder: usernames, scores and profile stats for home-country players.
// Discord ids, the verification log and per-user settings are never read. Files are only rewritten when their
// content changed, so an export with nothing new leaves git clean.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadBotData, loadBeatmaps } from './lib/source.mjs';
import { build, neededMapIds, isUnclaimedCandidate } from './lib/build.mjs';
import { loadCache, saveCache, findCredentials, fetchMissing, fetchCatchDifficulty, hasCatchDifficulty } from './lib/osu-api.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
const credentials = fetching ? findCredentials() : null;
if (fetching && !credentials) console.warn('  --fetch-titles: no osu! credentials (set OSU_CLIENT_ID/OSU_CLIENT_SECRET)');

const untitledIds = [...needed].filter(id => !beatmaps.get(id)?.title || beatmaps.get(id).title === 'Unknown');
if (credentials) console.log(`  fetched ${await fetchMissing(untitledIds, cache, cacheFile, credentials)} beatmaps`);
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

// Converts neither cache has a catch star rating for: the fruits attributes, a hundred per export at most (one
// request each), kept in our cache. Until then they show the bot's value.
const noCatch = [...needed].filter(id => beatmaps.has(id) && !hasCatchDifficulty(beatmaps.get(id)));
if (credentials) {
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
const { files, state } = build({ bot, beatmaps, homeCountry: country, now, state: previous });

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
const removed = prune('players', keep) + prune('maps', keep);
const metaText = JSON.stringify({ ...files['meta.json'], files: versions });
// Also when only the manifest differs (the first export that writes one), so the site never reads stale hashes.
const metaFile = path.join(outDir, 'meta.json');
if (changed || removed || !fs.existsSync(metaFile) || JSON.stringify(readJsonOr(metaFile, {}).files) !== JSON.stringify(versions)) {
  writeIfChanged(metaFile, metaText);
  changed++;
}
writeIfChanged(stateOut, JSON.stringify(state));

const untitled = files['maps-index.json'].filter(row => !row[3]).length;
console.log(`  ${Object.keys(files).length} files (${(bytes / 1e6).toFixed(1)} MB), ${changed} changed, ${removed} removed` +
  ` in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (untitled) console.log(`  ${untitled} maps have no title in the bot's beatmap cache (shown by id)`);
