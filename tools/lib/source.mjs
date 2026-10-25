// Reads the bot's private data folder (the PT-CTB-Bot-Data clone). Read-only: the bot writes every file here
// atomically (temp file + rename), so reading while the bot runs is safe.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
const readJsonOr = (file, fallback) => (fs.existsSync(file) ? readJson(file) : fallback);

/** The tracked players (Users/*.json), the imported dump players, banned maps and import state. */
export function loadBotData(root) {
  const usersDir = path.join(root, 'Users');
  if (!fs.existsSync(usersDir))
    throw new Error(`No Users folder in ${root} - is this the bot's data folder?`);

  const players = [];
  for (const file of fs.readdirSync(usersDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      players.push(readJson(path.join(usersDir, file)));
    } catch (e) {
      console.warn(`  skipped ${file}: ${e.message}`);
    }
  }

  return {
    players,
    ptCatch: readJsonOr(path.join(root, 'PtCatch', 'players.json'), []),
    ptCatchState: readJsonOr(path.join(root, 'PtCatch', 'state.json'), {}),
    banned: new Set(readJsonOr(path.join(root, 'BannedMaps.json'), [])),
  };
}

/**
 * The bot's beatmap cache, keeping only the maps `keep(raw)` accepts (the full cache is ~230k maps / 140 MB).
 * Reads beatmaps.json, or the gzipped copy the data repo commits when the plain file isn't there or is older.
 */
export function loadBeatmaps(root, keep) {
  const plain = path.join(root, 'beatmaps.json');
  const gz = path.join(root, 'beatmaps.json.gz');
  const usePlain = fs.existsSync(plain) && (!fs.existsSync(gz) || fs.statSync(plain).mtimeMs >= fs.statSync(gz).mtimeMs);

  let text;
  if (usePlain) text = fs.readFileSync(plain, 'utf8');
  else if (fs.existsSync(gz)) text = zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
  else return new Map();

  const maps = new Map();
  for (const raw of JSON.parse(text.replace(/^﻿/, ''))) {
    if (keep(raw)) maps.set(raw.beatmap_id, raw);
  }
  return maps;
}

/**
 * The last official pp (and global/country rank) each player had before osu! started reporting them as inactive (0pp,
 * no rank), from older versions of their Users/<id>.json in the data folder's git history: the newest one with
 * pp > 0, and that commit's time as when it was last seen. Read-only (git log/show); players with no such version,
 * or a data folder that isn't a git checkout, are left out. Returns { [id]: { pp, global, country, seen } }.
 */
export function loadPastOfficial(root, ids) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  const found = {};
  for (const id of ids) {
    let commits;
    try {
      commits = git('log', '--format=%H %ct', '--', `Users/${id}.json`).trim().split(/\r?\n/).filter(Boolean);
    } catch {
      return found; // not a git checkout (or no git): nothing to go on
    }
    for (const line of commits) {
      const [hash, time] = line.split(' ');
      let raw;
      try {
        raw = JSON.parse(git('show', `${hash}:Users/${id}.json`).replace(/^﻿/, ''));
      } catch {
        continue;
      }
      if (raw.pp_raw > 0) {
        found[id] = { pp: raw.pp_raw, global: raw.pp_rank ?? null, country: raw.pp_country_rank ?? null, seen: Number(time) };
        break;
      }
    }
  }
  return found;
}
