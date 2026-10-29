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
    weekly: loadWeekly(root),
    plays: loadPlays(root),
  };
}

/**
 * The bot's play log (Plays/<week>.jsonl, older weeks gzipped): a line per play it took in, with `sniped` (the
 * community players the play passed on its map that the player's previous play there hadn't, best first) and `held`
 * (only when the first of them held the map's #1), keeping just the fields the export reads; a line that won't parse
 * is skipped.
 *
 * `from` is when the lines start to speak for snipes (unix seconds; null when they never do). The bot's first import
 * with the log took in the day before it too (WeeklyService.RecentWindow), plays it mostly had already: logged as
 * repeats, without `sniped`, whatever they did when they came in. Only plays set after that day were logged as they
 * came in. Weekly/state.json has the start of that day (coveredFrom).
 */
export function loadPlays(root) {
  const covered = readJsonOr(path.join(root, 'Weekly', 'state.json'), {}).coveredFrom;
  const from = covered ? Math.floor(Date.parse(covered) / 1000) + 86400 : null;
  const dir = path.join(root, 'Plays');
  if (!fs.existsSync(dir)) return { from: null, lines: [] };
  const plays = [];
  for (const file of fs.readdirSync(dir)) {
    if (!/^\d{4}-W\d\d\.jsonl(\.gz)?$/.test(file)) continue;
    let text;
    try {
      const bytes = fs.readFileSync(path.join(dir, file));
      text = (file.endsWith('.gz') ? zlib.gunzipSync(bytes) : bytes).toString('utf8');
    } catch (e) {
      console.warn(`  skipped Plays/${file}: ${e.message}`);
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const { u, m, t, c, pp, sniped, held } = JSON.parse(line.replace(/^﻿/, ''));
        if (u) plays.push({ u, m, t, c, ...(pp != null ? { pp } : {}), ...(sniped ? { sniped } : {}), ...(held !== undefined ? { held } : {}) }); // not a gap line
      } catch {
        // a line cut short mid-write; the rest of the file still reads
      }
    }
  }
  return { from: Number.isFinite(from) ? from : null, lines: plays };
}

/**
 * The weekly highlights the bot keeps in Weekly/: every closed week's summary (2026-W44.json…) and the week so far
 * (current.json). Empty until the bot has closed a week; a file that won't parse is skipped.
 */
export function loadWeekly(root) {
  const dir = path.join(root, 'Weekly');
  if (!fs.existsSync(dir)) return { weeks: [], current: null };
  const weeks = [];
  for (const file of fs.readdirSync(dir)) {
    if (!/^\d{4}-W\d\d\.json$/.test(file)) continue;
    try {
      weeks.push(readJson(path.join(dir, file)));
    } catch (e) {
      console.warn(`  skipped Weekly/${file}: ${e.message}`);
    }
  }
  let current = null;
  try {
    current = readJsonOr(path.join(dir, 'current.json'), null);
  } catch (e) {
    console.warn(`  skipped Weekly/current.json: ${e.message}`);
  }
  return { weeks, current };
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

/**
 * The bot's list of its public commands (commands.json, written by the bot), for the site's commands page:
 * { generatedAt, groups: [{ name, commands: [{ slash, prefix: [], description, options: [{ name, description, choices? }], access }] }] }.
 * Null when the bot hasn't written one (older bots) or it isn't that shape, so the export goes on without it.
 */
export function loadCommands(root) {
  const file = path.join(root, 'commands.json');
  if (!fs.existsSync(file)) return null;
  try {
    const commands = readJson(file);
    return Array.isArray(commands?.groups) && commands.groups.every(g => Array.isArray(g?.commands)) ? commands : null;
  } catch {
    return null;
  }
}
