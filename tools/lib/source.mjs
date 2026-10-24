// Reads the bot's private data folder (the PT-CTB-Bot-Data clone). Read-only: the bot writes every file here
// atomically (temp file + rename), so reading while the bot runs is safe.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

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
