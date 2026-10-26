// The community's completion goal: how many ranked osu!catch maps the home country has cleared as a whole, and which
// ones nobody has yet. Tris's rules (the Discord agreed, he has the final say):
//  - a map counts as cleared once any tracked home-country player has a passed play on it;
//  - a play with NoFail doesn't count, and there is no accuracy minimum;
//  - the goal is the ranked/approved catch-specific maps. Converts are a separate, much longer goal: counted the same
//    way, shown on their own and never mixed into the headline.
// Only plays the site counts as ranked count: a play from before its map was ranked (the site's pre-rank plays) was on
// a version of the map that may have changed before ranking, and isn't on the map's board either. Restricted players
// and banned maps are left out, as everywhere else.
//
// Imports from build.mjs, which imports this module: both only use each other's exports inside functions.

import { MODE, STATUS } from '../../assets/js/core/model.js';
import { isCatchPlayable, setBeforeRanking, restrictedIds, isoTime, rankedAt } from './build.mjs';

const DAY = 86400;
/** Rows in the "recently cleared" list and the "only they have cleared" ranking. */
const RECENT = 12;
const SOLE = 10;

/** osu!'s passing grades. A failed play is 'F' (or carries no grade), and never counts. */
const PASS_GRADES = new Set(['XH', 'X', 'SH', 'S', 'A', 'B', 'C', 'D']);
/** NoFail in osu!'s mods bitmask. */
export const NF = 1;

export const isPass = s => Boolean(s) && PASS_GRADES.has(s.rank) && s.passed !== false;
export const usesNoFail = s => (Number(s?.enabled_mods) & NF) !== 0;
/** Whether a stored play clears its map: a pass, without NoFail, at any accuracy. */
export const clearsMap = s => isPass(s) && !usesNoFail(s);

const rankedOrApproved = raw => Number(raw?.approved) === STATUS.RANKED || Number(raw?.approved) === STATUS.APPROVED;
/**
 * A ranked/approved catch-specific difficulty (the goal). The cache's mode alone can't say so (it files taiko and mania
 * as catch), so the catch dump's vouching (isCatchPlayable) comes first; then mode 2 is a native catch map and mode 0 a
 * convert, as the site's categories have it (classify in model.js: Ranked versus Converts).
 */
export const isRankedSpecific = raw => isCatchPlayable(raw) && Number(raw.playmode) === MODE.CATCH && rankedOrApproved(raw);
/** A ranked/approved osu!standard map osu!catch can play: the converts goal. */
export const isRankedConvert = raw => isCatchPlayable(raw) && Number(raw.playmode) === MODE.OSU && rankedOrApproved(raw);

/**
 * Who has cleared which maps: Map(mapId -> Map(userId -> earliest clearing play's time, unix seconds, or 0 when the
 * play has no date)). Reads every stored play of the home-country players that the site counts as ranked: the bot's
 * ranked specifics, converts and (for a map ranked since it filed them) unranked plays, and the catch dump's plays.
 * Pre-rank plays (the bot's archive, and plays dated before their map was ranked) don't count.
 */
export function clearers({ bot, beatmaps, homeCountry }) {
  const hidden = restrictedIds(bot.players);
  const out = new Map();
  const add = (uid, list, onRankedBoard) => {
    for (const s of list || []) {
      if (!clearsMap(s)) continue;
      const raw = beatmaps.get(s.beatmap_id);
      if (!raw || bot.banned.has(s.beatmap_id) || !(isRankedSpecific(raw) || isRankedConvert(raw))) continue;
      if (setBeforeRanking(s, raw, onRankedBoard)) continue;
      const time = s.date ? isoTime(s.date) : NaN;
      const t = Number.isFinite(time) && time > 0 ? time : 0;
      const byUser = out.get(s.beatmap_id) ?? out.set(s.beatmap_id, new Map()).get(s.beatmap_id);
      const old = byUser.get(uid);
      // The earliest dated play; an undated one only stands in until a dated one turns up.
      if (old === undefined || (t > 0 && (old === 0 || t < old))) byUser.set(uid, t);
    }
  };
  for (const p of bot.players) {
    if (p.country !== homeCountry || hidden.has(p.user_id)) continue;
    add(p.user_id, p.RankedSpecificScores, true);
    add(p.user_id, p.TopConvertedScores, true);
    add(p.user_id, p.TopUnrankedScores, false);
  }
  for (const p of bot.ptCatch) {
    if (p.country !== homeCountry || hidden.has(p.user_id)) continue;
    add(p.user_id, p.top_scores, true);
    add(p.user_id, p.community_scores, true);
  }
  return out;
}

/** The first clear of a map from its clearers: [userId, time], the earliest dated play (ties: the lower id). */
function firstOf(byUser) {
  let first = null;
  for (const [uid, t] of byUser) {
    if (!first) first = [uid, t];
    else if (t > 0 && (first[1] === 0 || t < first[1] || (t === first[1] && uid < first[0]))) first = [uid, t];
    else if (t === 0 && first[1] === 0 && uid < first[0]) first = [uid, t];
  }
  return first;
}

/** The artist, title and creator of every set some cached map has them for: Map(setId -> [artist, title, creator]). */
function setTitles(maps) {
  const titles = new Map();
  for (const raw of maps) {
    if (raw?.beatmapset_id && raw.title && raw.title !== 'Unknown' && !titles.has(raw.beatmapset_id))
      titles.set(raw.beatmapset_id, [raw.artist || '', raw.title, raw.creator || '']);
  }
  return titles;
}

/**
 * The completion goal, as completion.json, plus the map ids still to clear and the first clears for the exporter's
 * state. `previous` is the state's earlier first clears ({ mapId: [userId, time] }): the bot keeps each player's best
 * play per map, so a first clearer who later improves their play would otherwise seem to have cleared it later. An
 * earlier record wins while its player is still tracked and unrestricted. `extraTitles` are more cached maps to take
 * a set's artist and title from (the exporter's own osu! API cache), for the many dump rows that carry none.
 *
 * completion.json:
 *   total, cleared        ranked catch-specific maps, and how many of them are cleared
 *   converts              { total, cleared }, the same for ranked converts
 *   players               how many players have cleared at least one of the maps
 *   recent                [[mapId, userId, time]]: the latest first clears, newest first
 *   sole                  [[userId, maps]]: the most maps only that player has cleared
 *   maps                  { mapId: beatmap tuple } for `recent` (filled in by build.mjs)
 *   sets                  { setId: [artist, title] } for `left`
 *   left                  [[mapId, setId, version, stars, rankedDay, osu! plays]]: the maps nobody has cleared, most
 *                         played on osu! first; rankedDay is days since 1970 (null when unknown)
 */
export function completion({ bot, beatmaps, homeCountry, previous = {}, extraTitles = [] }) {
  const hidden = restrictedIds(bot.players);
  const byMap = clearers({ bot, beatmaps, homeCountry });
  const known = new Set([...bot.players, ...bot.ptCatch].filter(p => p.country === homeCountry && !hidden.has(p.user_id)).map(p => p.user_id));

  const specifics = [], converts = [];
  for (const raw of beatmaps.values()) {
    if (bot.banned.has(raw.beatmap_id)) continue;
    if (isRankedSpecific(raw)) specifics.push(raw);
    else if (isRankedConvert(raw)) converts.push(raw);
  }

  const firsts = {};
  const left = [];
  const sole = new Map();
  const contributors = new Set();
  for (const raw of specifics) {
    const id = raw.beatmap_id;
    const byUser = byMap.get(id);
    if (!byUser) {
      left.push(raw);
      continue;
    }
    let first = firstOf(byUser);
    const before = previous[id];
    if (before && known.has(before[0]) && before[1] > 0 && (first[1] === 0 || before[1] < first[1])) first = [before[0], before[1]];
    firsts[id] = first;
    for (const uid of byUser.keys()) contributors.add(uid);
    if (byUser.size === 1) {
      const [uid] = byUser.keys();
      sole.set(uid, (sole.get(uid) ?? 0) + 1);
    }
  }

  const titles = setTitles([...beatmaps.values(), ...extraTitles]);
  left.sort((a, b) => (b.playcount || 0) - (a.playcount || 0) || a.beatmap_id - b.beatmap_id);
  const sets = {};
  for (const raw of left) {
    const title = titles.get(raw.beatmapset_id);
    if (title) sets[raw.beatmapset_id] = title.slice(0, 2);
  }

  const recent = Object.entries(firsts)
    .filter(([, [, t]]) => t > 0)
    .map(([id, [uid, t]]) => [Number(id), uid, t])
    .sort((a, b) => b[2] - a[2] || a[0] - b[0])
    .slice(0, RECENT);

  const file = {
    total: specifics.length,
    cleared: Object.keys(firsts).length,
    converts: { total: converts.length, cleared: converts.filter(raw => byMap.has(raw.beatmap_id)).length },
    players: contributors.size,
    recent,
    sole: [...sole].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, SOLE),
    maps: {},
    sets: Object.fromEntries(Object.entries(sets).sort((a, b) => a[0] - b[0])),
    left: left.map(raw => {
      const ranked = rankedAt(raw);
      return [raw.beatmap_id, raw.beatmapset_id || 0, raw.version || '', Math.round((raw.difficultyrating || 0) * 100) / 100,
        ranked === null ? null : Math.floor(ranked / DAY), raw.playcount || 0];
    }),
  };
  return { file, firsts, left: left.map(raw => raw.beatmap_id), titles };
}
