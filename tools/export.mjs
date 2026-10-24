#!/usr/bin/env node
// Builds the site's public data (data/*.json) from the PT-CTB bot's private data folder.
//
//   node --max-old-space-size=4096 tools/export.mjs [--data <bot data folder>] [--country PT] [--fetch-titles]
//
// --fetch-titles looks up maps the bot's cache has no title for on the osu! API (with the bot's osu! app, from
// OSU_CLIENT_ID/OSU_CLIENT_SECRET or the bot's user-secrets) and caches them in state/beatmaps.json.
//
// Only public osu! data leaves the bot's folder: usernames, scores and profile stats for home-country players.
// Discord ids, the verification log and per-user settings are never read. Files are only rewritten when their
// content changed, so an export with nothing new leaves git clean.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBotData, loadBeatmaps } from './lib/source.mjs';
import { build, neededMapIds, isUnclaimedCandidate } from './lib/build.mjs';
import { loadCache, findCredentials, fetchMissing } from './lib/osu-api.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dataRoot = path.resolve(arg('data', path.join(repoRoot, '..', 'PT-CTB-Bot-Data')));
const country = arg('country', 'PT');
const outDir = path.join(repoRoot, 'data');
const stateFile = path.join(repoRoot, 'state', 'state.json');

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
const untitledIds = [...needed].filter(id => !beatmaps.get(id)?.title || beatmaps.get(id).title === 'Unknown');
if (process.argv.includes('--fetch-titles')) {
  const credentials = findCredentials();
  if (!credentials) console.warn('  --fetch-titles: no osu! credentials (set OSU_CLIENT_ID/OSU_CLIENT_SECRET)');
  else console.log(`  fetched ${await fetchMissing(untitledIds, cache, cacheFile, credentials)} beatmaps`);
}
for (const id of untitledIds) if (cache.maps[id]) beatmaps.set(id, cache.maps[id]);

const previous = { ...readJsonOr(stateFile, {}), history: readJsonOr(path.join(outDir, 'history.json'), null) };
const now = Math.floor(Date.now() / 1000);
const { files, state } = build({ bot, beatmaps, homeCountry: country, now, state: previous });

let changed = 0, bytes = 0;
for (const [name, content] of Object.entries(files)) {
  // generatedAt changes every run; only bump meta.json when something else did, so idle runs stay clean.
  if (name === 'meta.json') continue;
  const text = JSON.stringify(content);
  bytes += text.length;
  if (writeIfChanged(path.join(outDir, name), text)) changed++;
}
const keep = new Set(Object.keys(files));
const removed = prune('players', keep) + prune('maps', keep);
if (changed || removed || !fs.existsSync(path.join(outDir, 'meta.json'))) {
  writeIfChanged(path.join(outDir, 'meta.json'), JSON.stringify(files['meta.json']));
  changed++;
}
writeIfChanged(stateFile, JSON.stringify(state));

const untitled = files['maps-index.json'].filter(row => !row[3]).length;
console.log(`  ${Object.keys(files).length} files (${(bytes / 1e6).toFixed(1)} MB), ${changed} changed, ${removed} removed` +
  ` in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (untitled) console.log(`  ${untitled} maps have no title in the bot's beatmap cache (shown by id)`);
