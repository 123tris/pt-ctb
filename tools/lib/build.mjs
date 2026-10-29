// Turns the bot's data into the site's public JSON. Pure: takes the loaded data, the previous exporter state and
// the current time, and returns { files, state } - nothing here touches the disk.

import {
  S, M, CAT, CATS, STATUS, MODE, DAN_MAPS, THRONE_PLAYER, PLAYER_MAP_FIELDS, classify, boardComparator, weightedTotal,
  matchesModFilter, parseModFilter, isSS, PLAY_SOURCES, topPlaysView,
} from '../../assets/js/core/model.js';
import { encodeMapsSearch } from '../../assets/js/core/maps-search.js';
import { playerBadges, era, signatureMap } from '../../assets/js/core/badges.js';
import { lisbonWeek, scoreId, weeklyBlock, votedMaps } from './weekly.mjs';
import { completion, homeGoal } from './completion.mjs';
import { starKings } from './star-kings.mjs';

const DAY = 86400;
const BUCKETS = 128;
/** Rows in maps-top.json: the Maps page's first ten pages (most players first) before the full index is needed. */
const MAPS_TOP = 500;
/** Rows per list in a player's head file: the profile's first page in its default order (most pp first). */
const HEAD_ROWS = 50;
/**
 * Plays per view of the top plays (each source and mod filter). 50 keeps topplays.json about the size of
 * modrankings.json; 100, an osu! profile's count, would make it almost twice that.
 */
const TOP_PLAYS = 50;
const MOD_FILTERS = ['NM', 'HD', 'HR', 'DT', 'FL', 'EZ', 'HT', 'HDHR', 'HDDT', 'HRDT'];
/**
 * Where the Records page's hard maps start (nomod catch stars). 34 players have a #1 at 6★ and up and 24 have five or
 * more, while the players with the most #1s overall hold them mostly on maps under 3★.
 */
const HARD_STARS = 6;
const PP_MILESTONES = 1000;
const ACTIVITY_DAYS = 120;
const MAX_EVENTS = 400;

const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
// Older profiles hold accuracy as a 0-1 fraction, newer ones as a percentage.
const percent = acc => (acc > 0 && acc <= 1 ? acc * 100 : acc);
export const isoTime = date => Math.floor(Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(date) ? date : `${date}Z`) / 1000);

/** A bot UserScore as the compact tuple the site reads (see S in model.js). */
function toTuple(s) {
  const hits = s.count300 + s.count100 + s.count50;
  const max = hits + s.countmiss + s.countkatu;
  return [
    s.beatmap_id, round(s.pp ?? 0), round(max ? (hits * 100) / max : 0), s.maxcombo, s.countmiss,
    s.enabled_mods, s.rank, s.score, isoTime(s.date), hits,
    // S.POS (filled in player files only), then S.ID when the bot knows which kind of score id the play has.
    ...(scoreId(s) ? [null, scoreId(s)] : []),
  ];
}

/** A cached beatmap as the compact tuple the site reads (see M in model.js). New fields go on the end. */
function toMapTuple(raw) {
  return [
    raw.artist || '', raw.title || '', raw.version || '', raw.beatmapset_id || 0, round(raw.difficultyrating || 0),
    raw.diff_approach ?? 0, raw.diff_size ?? 0, raw.diff_overall ?? 0, raw.diff_drain ?? 0, raw.bpm ?? 0,
    raw.hit_length ?? 0, raw.max_combo ?? 0, Number(raw.approved), Number(raw.playmode), raw.creator || '',
    rankedAt(raw), updatedAt(raw),
  ];
}

/** When the map was last updated (unix seconds), or null. Caches hold 0001-01-01 for "unknown". */
function updatedAt(raw) {
  const time = raw.last_update ? isoTime(raw.last_update) : NaN;
  return Number.isFinite(time) && time > 0 ? time : null;
}

/**
 * When a ranked, approved, qualified or loved map got there (unix seconds), or null. A graveyard map can still carry
 * the date of a status it lost, so only these statuses count.
 */
export function rankedAt(raw) {
  const status = Number(raw.approved);
  if (!raw.approved_date || !(status === STATUS.RANKED || status === STATUS.APPROVED || status === STATUS.QUALIFIED || status === STATUS.LOVED))
    return null;
  const time = isoTime(raw.approved_date);
  return Number.isFinite(time) ? time : null;
}

/**
 * How long before its ranked date a play on osu!'s ranked leaderboard can have been set: osu! keeps the plays from a
 * map's qualified period, and the cache has no qualified date. As in the bot (CatchScoreRules.QualifiedAllowance).
 */
const QUALIFIED_ALLOWANCE = 14 * DAY;

/**
 * Whether a stored play is from before its map was ranked, so it counts toward nothing and belongs with the pre-rank
 * plays (as in the bot). Only ranked and approved maps have such plays; a loved map's earlier plays stay on its board,
 * which anyone can still play for pp. A play from a ranked board or the dump (`onRankedBoard`) may be from the qualified
 * period, so it gets QUALIFIED_ALLOWANCE; one recorded while the map was unranked must be on or after the ranked date.
 * With no ranked date or no play date there is nothing to go by, and the play stays where the bot filed it.
 */
export function setBeforeRanking(s, raw, onRankedBoard) {
  if (!raw || ![STATUS.RANKED, STATUS.APPROVED].includes(Number(raw.approved))) return false;
  const ranked = rankedAt(raw);
  const time = s.date ? isoTime(s.date) : NaN;
  if (ranked === null || !(time > 0)) return false;
  return time < ranked - (onRankedBoard ? QUALIFIED_ALLOWANCE : 0);
}

const hasTitle = raw => raw && raw.title && raw.title !== 'Unknown';

/**
 * A player's official osu!catch stats. The bot stamps a profile it refreshed from osu! (`profile_updated`; its sync
 * looks every player up daily), and that copy is current, an inactive player's 0pp and missing ranks included.
 * Without the stamp the bot's copy may be years old, so the monthly dump is fresher and comes first.
 */
function officialStats(raw, dump) {
  const bot = raw && {
    pp: raw.pp_raw, global: raw.pp_rank, country: raw.pp_country_rank, acc: raw.accuracy, level: raw.level,
    plays: raw.playcount, grades: [raw.count_rank_ss, raw.count_rank_s, raw.count_rank_a],
  };
  if (bot && raw.profile_updated) return bot;
  const fromDump = dump && {
    pp: dump.pp, global: dump.global_rank, country: dump.country_rank, acc: dump.accuracy, level: dump.level,
    plays: dump.playcount, grades: [dump.count_rank_ss, dump.count_rank_s, dump.count_rank_a],
  };
  return fromDump || bot || { grades: [] };
}

/**
 * An inactive player's official pp worked out the way osu! does: the best plays that carry official pp, weighted
 * 0.95^i, plus the bonus for the number of ranked plays (capped at 1000). Only an estimate: the bot may not have
 * every ranked play, and converts it scored itself carry its own pp.
 */
function estimatedOfficialPp(tuples) {
  return officialTotal(bestPerMap(tuples).map(t => t[S.PP]));
}

/** osu!'s total pp for a set of per-map best pp values: weighted 0.95^i, plus the bonus for up to 1000 ranked plays. */
function officialTotal(pps) {
  const counted = pps.filter(pp => pp > 0).sort((a, b) => b - a);
  return weightedTotal(counted) + 416.6667 * (1 - 0.995 ** Math.min(counted.length, 1000));
}

/**
 * pp history from before the exporter started recording, rebuilt from score dates: for the 1st of every month (and
 * the first recorded day, where the real history takes over), each board's total over the plays set before then.
 * Official pp counts the plays that carry it (ranked plays and converts) plus the bonus, as osu! does.
 *
 * An approximation, in two ways: the bot keeps each player's best play per map, so before an improvement the map
 * counts nothing (the older play is gone) rather than the old play's pp; and every play carries today's pp, so the
 * totals are what those plays are worth now, not what osu! showed at the time (pp reworks included).
 * Returns { days: ['YYYY-MM-DD'], series: { id: [[dayIndex, convertPp, lovedPp, officialPp]] } }, a point only
 * where something changed, starting at each player's first play. officialPp is null throughout for a player whose
 * plays don't add up to their current official pp (within 10%): the bot doesn't have enough of their ranked plays
 * for the line to mean anything.
 */
function reconstructHistory(people, firstRecordedDay) {
  const end = firstRecordedDay ? Date.parse(`${firstRecordedDay}T00:00:00Z`) / 1000 : NaN;
  if (!Number.isFinite(end)) return { days: [], series: {} };

  const timeline = p => {
    const dated = list => list.filter(t => t[S.TIME] > 0 && t[S.TIME] < end).sort((a, b) => a[S.TIME] - b[S.TIME]);
    return { c: dated(p.lists.c), u: dated(p.lists.u), r: dated([...p.lists.r, ...p.lists.c, ...(p.dump_top || [])]) };
  };
  const timelines = new Map([...people.values()].map(p => [p.id, timeline(p)]));
  const earliest = Math.min(...[...timelines.values()].flatMap(t => [t.c[0], t.u[0], t.r[0]]).filter(Boolean).map(t => t[S.TIME]));
  if (!Number.isFinite(earliest)) return { days: [], series: {} };

  // The 1st of each month after the earliest play, then the first recorded day.
  const days = [];
  const date = new Date(earliest * 1000);
  for (let m = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)); m.getTime() / 1000 < end; m.setUTCMonth(m.getUTCMonth() + 1))
    days.push(m.toISOString().slice(0, 10));
  days.push(firstRecordedDay);
  const bounds = days.map(d => Date.parse(`${d}T00:00:00Z`) / 1000);

  const series = {};
  for (const [id, line] of timelines) {
    const best = { c: new Map(), u: new Map(), r: new Map() };
    const next = { c: 0, u: 0, r: 0 };
    const totals = { c: 0, u: 0, r: 0 };
    const points = [];
    bounds.forEach((bound, i) => {
      for (const cat of ['c', 'u', 'r']) {
        let changed = false;
        for (; next[cat] < line[cat].length && line[cat][next[cat]][S.TIME] < bound; next[cat]++) {
          const t = line[cat][next[cat]];
          if (t[S.PP] > (best[cat].get(t[S.MAP]) ?? 0)) {
            best[cat].set(t[S.MAP], t[S.PP]);
            changed = true;
          }
        }
        if (changed) {
          const pps = [...best[cat].values()];
          totals[cat] = round(cat === 'r' ? officialTotal(pps) : weightedTotal(pps.sort((a, b) => b - a)));
        }
      }
      const point = [i, totals.c, totals.u, totals.r];
      const last = points[points.length - 1];
      if (last ? last[1] !== point[1] || last[2] !== point[2] || last[3] !== point[3] : point.slice(1).some(v => v > 0))
        points.push(point);
    });
    // Keep the last day too, so the line reaches where the real history starts.
    const lastPoint = points[points.length - 1];
    if (lastPoint && lastPoint[0] !== bounds.length - 1) points.push([bounds.length - 1, ...lastPoint.slice(1)]);
    const official = people.get(id).pp;
    if (lastPoint && !(official > 0 && Math.abs(lastPoint[3] / official - 1) <= 0.1)) for (const point of points) point[3] = null;
    if (points.length) series[id] = points;
  }
  return { days, series };
}

/** The best play per map (pp first, then score), sorted best-pp-first. */
function bestPerMap(tuples) {
  const byMap = new Map();
  for (const t of tuples) {
    const old = byMap.get(t[S.MAP]);
    if (!old || t[S.PP] > old[S.PP] || (t[S.PP] === old[S.PP] && t[S.SCORE] > old[S.SCORE])) byMap.set(t[S.MAP], t);
  }
  return [...byMap.values()].sort((a, b) => b[S.PP] - a[S.PP] || a[S.MAP] - b[S.MAP]);
}

/** A small stable string hash (FNV-1a), so the weekly map pick doesn't depend on Math.random. */
function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

const lisbonHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: 'numeric', hourCycle: 'h23' });

/**
 * The players osu! has restricted (or deleted): the bot stamps `restricted_since` on them once its profile sync can't
 * find them (see Player.RestrictedSince in the bot) and lifts it when it can again. The export leaves them out of
 * everything, as if untracked (their dump record included), and they come back by themselves with the stamp lifted.
 */
export const restrictedIds = players => new Set(players.filter(p => p.restricted_since).map(p => p.user_id));

/** Which beatmap ids the export needs metadata for, so the 140 MB cache can be filtered while loading. */
export function neededMapIds(bot, homeCountry) {
  const ids = new Set(DAN_MAPS);
  const add = list => { for (const s of list || []) ids.add(s.beatmap_id); };
  const hidden = restrictedIds(bot.players);
  for (const p of bot.players) {
    if (p.country !== homeCountry || hidden.has(p.user_id)) continue;
    add(p.TopConvertedScores); add(p.TopUnrankedScores); add(p.RankedSpecificScores); add(p.PreRankScores);
    for (const s of p.DanPasses || []) if (s) ids.add(s.beatmap_id);
  }
  for (const p of bot.ptCatch) {
    if (p.country !== homeCountry || hidden.has(p.user_id)) continue;
    add(p.top_scores); add(p.community_scores);
  }
  return ids;
}

/** A map whose mode is known to be taiko or mania (an osu! API lookup says so; the bot's cache never does). */
const isOtherMode = raw => [MODE.TAIKO, MODE.MANIA].includes(Number(raw?.playmode));

/**
 * A cached map osu!catch can play (a catch map or a convert), as the catch dump vouches: it gave the map a catch star
 * rating. The cached mode can't say so on its own: the bot's cache files every non-standard map as catch, about 31k
 * taiko and 7k mania difficulties included. Every map the export picks from the cache rather than from PT plays (the
 * unclaimed maps, a set's other difficulties) has to pass this. It's strict: a real catch map the dump never flagged
 * is left out too, which beats letting a mania map in.
 */
export const isCatchPlayable = raw => raw?.catch_difficulty === true && !isOtherMode(raw);

/** Ranked/approved osu!catch-specific maps with a title: the pool for "maps nobody here has played yet". */
export const isUnclaimedCandidate = raw =>
  hasTitle(raw) && isCatchPlayable(raw) && Number(raw.playmode) === MODE.CATCH &&
  (Number(raw.approved) === STATUS.RANKED || Number(raw.approved) === STATUS.APPROVED);

/**
 * `extraTitles`: more cached maps (the exporter's osu! API cache) that only lend their set's artist and title to the
 * completion goal's maps, many of which the dump left without one.
 */
export function build({ bot, beatmaps, homeCountry, now, state: previous, pastOfficial = {}, extraTitles = [] }) {
  // A banned map keeps its scores, but every one of them is worth 0pp (as in the bot).
  const banned = bot.banned;
  // Restricted players (see restrictedIds) are in none of the files: never made a person, so off every board, ranking
  // and list, and the map boards' positions close up around them.
  const hidden = restrictedIds(bot.players);
  // Taiko and mania maps can't be played in catch: a score on one (filed off a wrong cached mode) is never shown. Plays
  // only need the map not to be known as another mode: they prove it's catch-playable, flagged by the dump or not.
  // Failed plays cannot hold a leaderboard position, even if an old store accidentally retained one.
  const playable = s => !!s && s.rank !== 'F' && !isOtherMode(beatmaps.get(s.beatmap_id));
  const tuple = s => {
    const t = toTuple(s);
    if (banned.has(s.beatmap_id)) t[S.PP] = 0;
    return t;
  };
  const catOf = (mapId, fallback) => {
    const raw = beatmaps.get(mapId);
    return raw ? classify(Number(raw.approved), Number(raw.playmode)) : fallback;
  };

  // ---- People: the home-country tracked players, merged with their dump-import record --------------------

  const people = new Map();
  const person = (id, name) => {
    if (!people.has(id)) people.set(id, { id, name, raw: null, dump: null, lists: { c: [], u: [], r: [] }, dump_top: [], pre: [], early: [] });
    return people.get(id);
  };
  // A play from before its map was ranked counts toward nothing, wherever the bot filed it: it goes with the player's
  // pre-rank plays instead (p.early until they're merged). The bot moves such plays itself; this keeps the site right
  // until it has, and leaves out the copy it filed on a board as well as in the archive.
  const filed = (p, list, onRankedBoard) => {
    const kept = [];
    for (const s of (list || []).filter(playable))
      (setBeforeRanking(s, beatmaps.get(s.beatmap_id), onRankedBoard) ? p.early : kept).push(s);
    return kept.map(tuple);
  };

  for (const raw of bot.players) {
    if (raw.country !== homeCountry || hidden.has(raw.user_id)) continue;
    const p = person(raw.user_id, raw.username);
    p.raw = raw;
    p.lists.c.push(...filed(p, raw.TopConvertedScores, true));
    p.lists.u.push(...filed(p, raw.TopUnrankedScores, false));
    p.lists.r.push(...filed(p, raw.RankedSpecificScores, true));
    // Plays from before their map was ranked: shown for the record, counted nowhere (they're 0pp in the bot too).
    p.early.push(...(raw.PreRankScores || []).filter(playable));
  }
  for (const dump of bot.ptCatch) {
    if (dump.country !== homeCountry || hidden.has(dump.user_id)) continue;
    const p = person(dump.user_id, dump.username);
    p.dump = dump;
    p.dump_top = filed(p, dump.top_scores, true).sort((a, b) => b[S.PP] - a[S.PP]);
    // Ranked specifics from the dump top the tracked list up; a player the bot never registered (it normally
    // does, after every import) still gets their dump plays filed by category.
    for (const s of p.raw ? dump.top_scores || [] : dump.community_scores || []) {
      if (!playable(s) || setBeforeRanking(s, beatmaps.get(s.beatmap_id), true)) continue;
      const cat = catOf(s.beatmap_id, null);
      if (cat === CAT.RANKED || (!p.raw && cat)) p.lists[cat].push(tuple(s));
    }
  }
  for (const p of people.values()) {
    for (const cat of CATS) p.lists[cat] = bestPerMap(p.lists[cat]);
    // One pre-rank play per map, the best score, at 0pp.
    const pre = new Map();
    for (const t of p.early.map(toTuple)) {
      t[S.PP] = 0;
      if (!(pre.get(t[S.MAP])?.[S.SCORE] >= t[S.SCORE])) pre.set(t[S.MAP], t);
    }
    p.pre = [...pre.values()].sort((a, b) => b[S.SCORE] - a[S.SCORE] || a[S.MAP] - b[S.MAP]);
  }

  // ---- Per-map boards --------------------------------------------------------------------------------------

  const boards = new Map(); // mapId -> { cat, entries: [[uid, ...tuple]] }
  for (const p of people.values()) {
    for (const cat of CATS) {
      for (const t of p.lists[cat]) {
        const id = t[S.MAP];
        if (!boards.has(id)) boards.set(id, { cat: catOf(id, cat) || cat, entries: [] });
        boards.get(id).entries.push([p.id, ...t]);
      }
    }
  }
  const position = new Map(); // `${uid}:${mapId}` -> PT position
  for (const [id, board] of boards) {
    // A play the bot filed under two categories (the map's status changed in between) counts once, at its best.
    const seen = new Set();
    board.entries = board.entries.sort(boardComparator(board.cat)).filter(e => !seen.has(e[0]) && seen.add(e[0]));
    board.entries.forEach((e, i) => position.set(`${e[0]}:${id}`, i + 1));
  }

  // ---- Player summaries --------------------------------------------------------------------------------------

  for (const p of people.values()) {
    const raw = p.raw || {}, dump = p.dump || {};
    p.name = raw.username || dump.username || p.name;
    p.cv = round(weightedTotal(p.lists.c.map(t => t[S.PP])));
    p.ul = round(weightedTotal(p.lists.u.map(t => t[S.PP])));
    p.official = officialStats(p.raw, p.dump);
    p.pp = round(p.official.pp || 0);
    p.global = p.official.global || null;
    p.country = p.official.country || null;
    // osu! shows a player who stopped playing as 0pp with no rank. The site keeps their official pp, from the best
    // source there is:
    //  1. the value this exporter last saw live (state.official; only exists for players who went inactive since);
    //  2. an estimate from their plays: it matches osu!'s pp for the active players to within about 1%;
    //  3. for a player with no plays to go on, an old copy from the data folder's history. Those can be years old and
    //     from before pp reworks (for players with plays they were 27-92% off the estimate, a few 3-4x under it).
    p.inactive = Boolean(raw.profile_updated) && !(p.pp > 0 && p.global);
    if (p.inactive) {
      const live = previous.official?.[p.id];
      const estimate = round(estimatedOfficialPp([...p.lists.r, ...p.lists.c, ...(p.dump_top || [])]));
      if (live) [p.pp, p.ppSeen, p.ppSource] = [round(live[0]), live[1], 'last-known'];
      else if (estimate > 0) [p.pp, p.ppSource] = [estimate, 'estimated'];
      else if (pastOfficial[p.id]) [p.pp, p.ppSource] = [round(pastOfficial[p.id].pp), 'last-known'];
      else [p.pp, p.ppSource] = [0, null];
      p.global = p.country = null;
    }
    p.firsts = Object.fromEntries(CATS.map(cat => [cat, p.lists[cat].filter(t => position.get(`${p.id}:${t[S.MAP]}`) === 1).length]));
    p.dan = (raw.DanPasses || []).map((s, i) => (playable(s) ? [i, toTuple(s)] : null)).filter(Boolean);
    p.danScore = raw.DanScore || 0;
    const all = CATS.flatMap(cat => p.lists[cat]);
    p.last = all.reduce((max, t) => Math.max(max, t[S.TIME]), 0) || null;
  }

  const ranking = key => [...people.values()].filter(p => p[key] > 0).sort((a, b) => b[key] - a[key] || a.id - b.id);
  const order = { c: ranking('cv'), u: ranking('ul'), r: ranking('pp') };
  const rankOf = Object.fromEntries(CATS.map(cat => [cat, new Map(order[cat].map((p, i) => [p.id, i + 1]))]));

  const players = [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map(p => {
    return {
      id: p.id, name: p.name,
      cv: p.cv, ul: p.ul, pp: p.pp,
      rank: { c: rankOf.c.get(p.id) || null, u: rankOf.u.get(p.id) || null, r: rankOf.r.get(p.id) || null },
      global: p.global, country: p.country,
      // Inactive on osu! (0pp, no rank there): pp is ppSource 'last-known' (as of ppSeen, when we know when) or
      // 'estimated'; null when there's nothing to go on (pp 0, off the ranked board).
      ...(p.inactive ? { inactive: true, ppSource: p.ppSource, ...(p.ppSeen ? { ppSeen: p.ppSeen } : {}) } : {}),
      acc: round(percent(p.official.acc ?? 0)), level: round(p.official.level ?? 0),
      plays: p.official.plays ?? 0,
      grades: [0, 1, 2].map(i => p.official.grades[i] ?? 0),
      count: Object.fromEntries(CATS.map(cat => [cat, p.lists[cat].length])),
      firsts: p.firsts,
      danScore: p.danScore, dan: p.dan.map(([i]) => i),
      last: p.last,
    };
  });

  // ---- Beatmap metadata dictionaries -------------------------------------------------------------------------

  const mapTuple = id => (beatmaps.has(id) ? toMapTuple(beatmaps.get(id)) : null);
  const mapsFor = ids => {
    const out = {};
    for (const id of [...new Set(ids)].sort((a, b) => a - b)) out[id] = mapTuple(id);
    return out;
  };
  // Player files only carry the fields the site reads from them (PLAYER_MAP_FIELDS in model.js).
  const keepField = new Set(PLAYER_MAP_FIELDS);
  const lastField = Math.max(...PLAYER_MAP_FIELDS);
  const playerMapsFor = ids => {
    const out = mapsFor(ids);
    for (const id in out) out[id] = out[id] && out[id].slice(0, lastField + 1).map((v, i) => (keepField.has(i) ? v : null));
    return out;
  };

  // ---- Per-player files ------------------------------------------------------------------------------------------

  const playerFiles = {};
  for (const p of people.values()) {
    const withPos = t => Object.assign([...t], { [S.POS]: position.get(`${p.id}:${t[S.MAP]}`) || null });
    const lists = Object.fromEntries(CATS.map(cat => [cat, p.lists[cat].map(withPos)]));
    const ids = [...CATS.flatMap(cat => p.lists[cat].map(t => t[S.MAP])), ...p.dan.map(([, t]) => t[S.MAP]),
      ...p.dump_top.map(t => t[S.MAP]), ...p.pre.map(t => t[S.MAP])];
    playerFiles[p.id] = {
      id: p.id, name: p.name,
      scores: lists,
      top: p.dump_top, // the dump's best ranked plays (official pp, converts included) for the "Ranked" view
      dan: p.dan,
      // Plays from before their map was ranked (no pp, no positions); left out when there are none.
      ...(p.pre.length ? { pre: p.pre } : {}),
      maps: playerMapsFor(ids),
    };
  }

  // ---- Map buckets + search index -------------------------------------------------------------------------------

  // The "played before ranked" list per map: [uid, ...tuple], best score first. Not a board - nothing is ranked on it.
  const preBoards = new Map();
  for (const p of people.values()) {
    for (const t of p.pre) {
      if (!preBoards.has(t[S.MAP])) preBoards.set(t[S.MAP], []);
      preBoards.get(t[S.MAP]).push([p.id, ...t]);
    }
  }
  for (const entries of preBoards.values()) entries.sort((a, b) => b[S.SCORE + 1] - a[S.SCORE + 1] || a[0] - b[0]);

  const mapBuckets = {};
  const mapsIndex = [];
  for (const [id, board] of [...boards].sort((a, b) => a[0] - b[0])) {
    const meta = mapTuple(id);
    const bucket = (mapBuckets[id % BUCKETS] ??= {});
    bucket[id] = {
      m: meta, c: board.cat, s: board.entries,
      ...(banned.has(id) ? { banned: true } : {}), ...(preBoards.has(id) ? { pre: preBoards.get(id) } : {}),
    };
    mapsIndex.push([
      id, meta ? meta[M.SET] : 0, meta ? meta[M.ARTIST] : '', meta ? meta[M.TITLE] : '', meta ? meta[M.VERSION] : '',
      meta ? meta[M.STARS] : 0, board.cat, board.entries.length, board.entries[0][0],
    ]);
  }
  mapsIndex.sort((a, b) => b[7] - a[7] || a[0] - b[0]);
  // Maps with only pre-rank plays still get a page (an empty board plus the list), but no place in the map index.
  for (const [id, entries] of preBoards) {
    if (boards.has(id)) continue;
    (mapBuckets[id % BUCKETS] ??= {})[id] = { m: mapTuple(id), c: catOf(id, CAT.RANKED), s: [], pre: entries };
  }

  // ---- Mod rankings ---------------------------------------------------------------------------------------------

  // Ranked is the dump's plays, with osu!'s own pp. Players inactive on osu! aren't in the dump, so they fall back to
  // the ranked plays and converts the bot keeps (what their estimated pp comes from) and stay on these boards too.
  const pools = {
    r: p => (p.dump_top.length ? p.dump_top : bestPerMap([...p.lists.r, ...p.lists.c])), c: p => p.lists.c, u: p => p.lists.u,
  };
  const modRankings = { filters: MOD_FILTERS, sources: {} };
  const modMaps = [];
  for (const [source, pool] of Object.entries(pools)) {
    modRankings.sources[source] = {};
    for (const name of MOD_FILTERS) {
      const filter = parseModFilter(name);
      const rows = [];
      for (const p of people.values()) {
        const matching = pool(p).filter(t => matchesModFilter(t[S.MODS], filter)).sort((a, b) => b[S.PP] - a[S.PP]);
        if (!matching.length) continue;
        rows.push([p.id, round(weightedTotal(matching.map(t => t[S.PP]))), matching.length, matching[0]]);
        modMaps.push(matching[0][S.MAP]);
      }
      modRankings.sources[source][name] = rows.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    }
  }
  modRankings.maps = mapsFor(modMaps);

  // ---- Top plays ------------------------------------------------------------------------------------------------
  // The country's best single plays, most pp first: every player's best play per map, as the map pages have it (filed
  // under the map's category). The site offers a top TOP_PLAYS per source and mod filter (any mods included); the file
  // holds the union of them all, which the site filters back into each view (topPlaysView in model.js). Banned maps'
  // plays are worth 0pp and left out.
  const allPlays = [...boards]
    .flatMap(([, b]) => b.entries.filter(e => e[S.PP + 1] > 0).map(([uid, ...t]) => [uid, b.cat, ...t]))
    .sort((a, b) => b[S.PP + 2] - a[S.PP + 2] || a[S.TIME + 2] - b[S.TIME + 2] || a[0] - b[0]);
  const shownPlays = new Set();
  for (const source of Object.keys(PLAY_SOURCES)) {
    for (const filter of [null, ...MOD_FILTERS.map(parseModFilter)]) {
      for (const row of topPlaysView(allPlays, source, filter, TOP_PLAYS)) shownPlays.add(row);
    }
  }
  const topPlays = { cap: TOP_PLAYS, filters: MOD_FILTERS, plays: allPlays.filter(row => shownPlays.has(row)) };
  topPlays.maps = playerMapsFor(topPlays.plays.map(row => row[S.MAP + 2]));

  // ---- Dan course ---------------------------------------------------------------------------------------------------

  const dan = {
    stages: DAN_MAPS.map((mapId, index) => ({
      index, map: mapId, meta: mapTuple(mapId),
      passers: [...people.values()]
        .flatMap(p => p.dan.filter(([i]) => i === index).map(([, t]) => [p.id, ...t]))
        .sort((a, b) => b[S.SCORE + 1] - a[S.SCORE + 1]),
    })),
    ladder: [...people.values()].filter(p => p.danScore > 0 || p.dan.length)
      .map(p => [p.id, p.danScore, p.dan.length, Math.max(...p.dan.map(([i]) => i), -1)])
      .sort((a, b) => b[1] - a[1] || b[2] - a[2] || a[0] - b[0]),
  };

  // ---- Activity --------------------------------------------------------------------------------------------------

  const since = now - ACTIVITY_DAYS * DAY;
  const derived = [];
  // A #1 is a snipe only if someone else held the spot before it. The board alone can't tell that from the holder
  // beating their own #1: either way the #1 is newer than the runner-up's score. The bot's play log can: it took each
  // play in against the player's previous one, and lists in `sniped` only the players it passed that the previous one
  // hadn't, best first. So a #1 that passed nobody was the player's already, and one that passed someone took the spot
  // from the best of them (whoever held it among the players shown here; the bot's own `held` also counts players from
  // elsewhere). A play the log can't speak for falls back to the board: a #1
  // set after the runner-up's score took the spot from them. Those are plays set before the log, plays only a dump
  // has, and loved/unranked plays that came in without pp: loved boards go by pp, and the bot only works it out after
  // its snipe check, which saw a 0pp play that passed nobody.
  const playLog = bot.plays || { from: null, lines: [] };
  const logged = new Map(); // "user:map" -> the log's lines for that player's plays on that map
  for (const line of playLog.lines) {
    if (playLog.from === null || line.t < playLog.from || (line.c === 'u' && line.pp === undefined)) continue;
    const key = `${line.u}:${line.m}`;
    if (!logged.has(key)) logged.set(key, []);
    logged.get(key).push(line);
  }
  for (const [id, board] of boards) {
    const [top, second] = board.entries;
    const time = top[S.TIME + 1];
    if (!second || time < since) continue;
    // The same play can be in the log twice (taken in by !rs and by the tracker); only the first one changed anything.
    const lines = (logged.get(`${top[0]}:${id}`) || []).filter(l => Math.abs(l.t - time) <= 1);
    const passed = lines.find(l => l.sniped?.length)?.sniped[0];
    const victim = lines.length ? passed : time > second[S.TIME + 1] ? second[0] : undefined;
    if (victim === undefined || victim === top[0] || !people.has(victim)) continue;
    derived.push({ t: time, k: 'snipe', u: top[0], v: victim, c: board.cat, s: top.slice(1) });
  }
  for (const p of people.values()) {
    for (const [index, t] of p.dan) {
      if (t[S.TIME] >= since) derived.push({ t: t[S.TIME], k: 'dan', u: p.id, d: index, s: t });
    }
    for (const cat of [CAT.CONVERT, CAT.LOVED]) {
      p.lists[cat].slice(0, 5).forEach((t, i) => {
        if (t[S.TIME] >= since) derived.push({ t: t[S.TIME], k: 'top', u: p.id, c: cat, i: i + 1, s: t });
      });
    }
  }

  // State-based events: who overtook whom on the pp boards, pp milestones and newly tracked players, found by
  // comparing with the previous export. The first export has nothing to compare with, so it only records.
  // Earlier events about a player since restricted go, whichever side of them they were on.
  const involvesHidden = e => hidden.has(e.u) || [].concat(e.v ?? []).some(id => hidden.has(id));
  const stateEvents = (previous.events || []).filter(e => !involvesHidden(e));
  if (previous.boards) {
    // An inactive player's official pp is frozen (or estimated), and the real one replaces it when they're back: a
    // move on the ranked board either way isn't an overtake.
    const wasInactive = new Set(previous.inactive || []);
    for (const cat of [CAT.CONVERT, CAT.LOVED, CAT.RANKED]) {
      const before = new Map((previous.boards[cat] || []).map((id, i) => [id, i]));
      order[cat].forEach((p, i) => {
        const was = before.get(p.id);
        if (was === undefined || was <= i) return;
        if (cat === CAT.RANKED && (p.inactive || wasInactive.has(p.id))) return;
        const passed = order[cat].slice(i + 1).filter(q => before.has(q.id) && before.get(q.id) < was).map(q => q.id);
        if (passed.length) stateEvents.push({ t: now, k: 'pass', u: p.id, c: cat, v: passed, r: i + 1, pp: p[{ c: 'cv', u: 'ul', r: 'pp' }[cat]] });
      });
    }
    for (const p of people.values()) {
      const old = previous.totals?.[p.id];
      if (!old) {
        if (previous.known && !previous.known.includes(p.id)) stateEvents.push({ t: now, k: 'join', u: p.id });
        continue;
      }
      [['c', p.cv, old[0]], ['u', p.ul, old[1]]].forEach(([cat, pp, was]) => {
        const reached = Math.floor(pp / PP_MILESTONES) * PP_MILESTONES;
        if (reached > 0 && was < reached) stateEvents.push({ t: now, k: 'mile', u: p.id, c: cat, pp: reached });
      });
    }
  }
  const keptStateEvents = stateEvents.filter(e => e.t >= since).sort((a, b) => b.t - a.t).slice(0, MAX_EVENTS);
  const events = [...derived, ...keptStateEvents].sort((a, b) => b.t - a.t || a.k.localeCompare(b.k)).slice(0, MAX_EVENTS);

  const recent = [...people.values()]
    .flatMap(p => CATS.flatMap(cat => p.lists[cat].map(t => [p.id, cat, ...t])))
    .sort((a, b) => b[S.TIME + 2] - a[S.TIME + 2])
    .slice(0, 80);

  const activity = {
    events,
    recent,
    maps: mapsFor([...events.flatMap(e => (e.s ? [e.s[S.MAP]] : [])), ...recent.map(r => r[S.MAP + 2])]),
  };

  // ---- Records -----------------------------------------------------------------------------------------------------

  const allScores = [...people.values()].flatMap(p => CATS.flatMap(cat => p.lists[cat].map(t => ({ p, cat, t }))));
  const best = (items, value) => items.reduce((top, x) => (top === null || value(x) > value(top) ? x : top), null);
  const asRow = x => (x ? [x.p.id, x.cat, ...x.t] : null);
  const leaders = (value, n = 5) => [...people.values()].map(p => [p.id, value(p)]).filter(r => r[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, n);
  const meta = id => beatmaps.get(id);
  const fairMods = t => !(t[S.MODS] & (2 | 256)); // no EZ/HT: a record shouldn't come from making the map easier
  // A play on a hard map: HARD_STARS and up in catch stars (a convert the caches have no catch rating for doesn't
  // count), not on a banned map, and without EZ/HT. DT and HR plays count at the map's nomod stars, as shown.
  const onHardMap = t => {
    const raw = meta(t[S.MAP]);
    return fairMods(t) && !banned.has(t[S.MAP]) && raw?.difficultyrating >= HARD_STARS &&
      (Number(raw.playmode) === MODE.CATCH || raw.catch_difficulty === true);
  };

  const ranksByHour = new Array(24).fill(0);
  for (const { t } of allScores) ranksByHour[Number(lisbonHour.format(new Date(t[S.TIME] * 1000)))]++;

  const contested = [...boards].filter(([, b]) => b.entries.length >= 2);
  const oldestFirst = contested.reduce((old, [id, b]) => (!old || b.entries[0][S.TIME + 1] < old.entries[0][S.TIME + 1] ? { id, ...b } : old), null);

  const records = {
    kings: starKings(boards, beatmaps),
    topPlay: Object.fromEntries(CATS.map(cat => [cat, asRow(best(allScores.filter(x => x.cat === cat), x => x.t[S.PP]))])),
    topCombo: asRow(best(allScores, x => x.t[S.COMBO])),
    hardest: Object.fromEntries(CATS.map(cat => [cat, asRow(best(allScores.filter(x => x.cat === cat && fairMods(x.t) && meta(x.t[S.MAP])),
      x => meta(x.t[S.MAP]).difficultyrating))])),
    longest: asRow(best(allScores.filter(x => fairMods(x.t) && meta(x.t[S.MAP])), x => meta(x.t[S.MAP]).hit_length)),
    oldestFirst: oldestFirst ? [oldestFirst.entries[0][0], oldestFirst.cat, ...oldestFirst.entries[0].slice(1)] : null,
    mostFirsts: Object.fromEntries(CATS.map(cat => [cat, leaders(p => p.firsts[cat])])),
    // The most #1s with only hard maps counted, so easy maps can't pad it, and the hardest full combo of all.
    hard: {
      stars: HARD_STARS,
      firsts: leaders(p => new Set(CATS.flatMap(cat => p.lists[cat]
        .filter(t => position.get(`${p.id}:${t[S.MAP]}`) === 1 && onHardMap(t)).map(t => t[S.MAP]))).size),
      fc: asRow(best(allScores.filter(x => x.t[S.MISS] === 0 && onHardMap(x.t)), x => meta(x.t[S.MAP]).difficultyrating)),
    },
    mostSS: leaders(p => CATS.reduce((n, cat) => n + p.lists[cat].filter(t => isSS(t[S.GRADE])).length, 0)),
    mostFC: leaders(p => CATS.reduce((n, cat) => n + p.lists[cat].filter(t => t[S.MISS] === 0).length, 0)),
    // "The Soul wall", "the Edward wall": the players whose #1s have stood longest in numbers (2+ years). The top 3
    // get The Wall badge.
    wall: leaders(p => CATS.reduce((n, cat) => n + p.lists[cat].filter(t => position.get(`${p.id}:${t[S.MAP]}`) === 1 && t[S.TIME] < now - 2 * 365 * DAY).length, 0), 3),
    byHour: ranksByHour,
    totals: {
      players: people.size, scores: allScores.length, maps: boards.size,
      fruits: allScores.reduce((n, x) => n + x.t[S.HITS], 0),
      ss: allScores.filter(x => isSS(x.t[S.GRADE])).length,
    },
    // The Choke d'Or: who has the most plays with exactly one miss, and the biggest one of all.
    oneMiss: leaders(p => CATS.reduce((n, cat) => n + p.lists[cat].filter(t => t[S.MISS] === 1).length, 0)),
    highestChoke: asRow(best(allScores.filter(x => x.t[S.MISS] === 1), x => x.t[S.PP])),
    // When you see it: every stored play that ended on exactly 727 combo.
    wysi: allScores.filter(x => x.t[S.COMBO] === 727).sort((a, b) => b.t[S.TIME] - a.t[S.TIME]).map(asRow),
  };

  // The throne: THRONE_PLAYER's #1s that still stand, oldest first, and who sits right behind them most often.
  if (people.has(THRONE_PLAYER)) {
    const held = [...boards].filter(([, b]) => b.entries[0][0] === THRONE_PLAYER);
    const contestedHeld = held.filter(([, b]) => b.entries.length >= 2);
    const behind = new Map();
    for (const [, b] of contestedHeld) behind.set(b.entries[1][0], (behind.get(b.entries[1][0]) || 0) + 1);
    records.throne = {
      u: THRONE_PLAYER,
      held: held.length,
      contested: contestedHeld.length,
      // [category, runner-up id, ...the #1 play]
      oldest: contestedHeld
        .sort((a, b) => a[1].entries[0][S.TIME + 1] - b[1].entries[0][S.TIME + 1] || a[0] - b[0])
        .slice(0, 12)
        .map(([, b]) => [b.cat, b.entries[1][0], ...b.entries[0].slice(1)]),
      challengers: [...behind].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5),
    };
  }

  const recordMapIds = [
    ...Object.values(records.topPlay), records.topCombo, ...Object.values(records.hardest), records.longest, records.oldestFirst,
    records.highestChoke, ...records.wysi, records.hard.fc,
  ].filter(Boolean).map(r => r[S.MAP + 2]);
  records.maps = mapsFor([...recordMapIds, ...(records.throne?.oldest || []).map(r => r[S.MAP + 2])]);

  // ---- Challenges -------------------------------------------------------------------------------------------------

  const week = lisbonWeek(now); // Monday 00:00 Lisbon: the same week as the bot's weekly highlights
  const weeks = { ...(previous.weeks || {}) };
  // The map the community voted for in the bot's weekly recap. Until the vote is counted (the first import after
  // Monday 00:00, minutes in), and for a week nobody voted on, the automatic pick below stands.
  const voted = votedMaps(bot.weekly?.weeks).get(week.id);
  if (voted && boards.has(voted)) weeks[week.id] = voted;
  else if (!weeks[week.id] || !boards.has(weeks[week.id])) {
    const pool = [...boards]
      .filter(([id, b]) => b.cat !== CAT.LOVED && !banned.has(id) && b.entries.length >= 4 && hasTitle(meta(id)) &&
        meta(id).difficultyrating >= 3.5 && meta(id).difficultyrating <= 6.5 && !Object.values(weeks).includes(id))
      .map(([id]) => id)
      .sort((a, b) => a - b);
    if (pool.length) weeks[week.id] = pool[hash(week.id) % pool.length];
  }
  const weekMap = weeks[week.id];
  const weekBoard = weekMap ? boards.get(weekMap) : null;
  // The weekly highlights (top pp play, most plays, the map vote), as the bot closed them.
  const weekly = weeklyBlock(bot.weekly, now, hidden, { picked: weeks, playersOn: id => boards.get(id)?.entries.length ?? 0 });

  const beatable = contested
    .filter(([id, b]) => b.entries.length >= 3 && !banned.has(id) && hasTitle(meta(id)) && (b.entries[0][S.ACC + 1] < 97 || b.entries[0][S.MISS + 1] >= 3))
    .sort((a, b) => b[1].entries.length - a[1].entries.length || meta(b[0]).difficultyrating - meta(a[0]).difficultyrating)
    .slice(0, 30)
    .map(([id, b]) => [id, b.cat, b.entries.length, b.entries[0]]);
  // Loved/unranked maps at 10★ and up are mostly joke maps, so they're left out (filtered before the cap, so the
  // list still fills up). Converts and ranked maps stay at any star rating.
  const lonely = [...boards]
    .filter(([id, b]) => b.entries.length === 1 && !banned.has(id) && hasTitle(meta(id)) && meta(id).difficultyrating >= 5 &&
      !(b.cat === CAT.LOVED && meta(id).difficultyrating >= 10))
    .sort((a, b) => meta(b[0]).difficultyrating - meta(a[0]).difficultyrating || a[0] - b[0])
    .slice(0, 30)
    .map(([id, b]) => [id, b.cat, b.entries[0]]);
  const unclaimed = [...beatmaps.values()]
    .filter(raw => isUnclaimedCandidate(raw) && !boards.has(raw.beatmap_id) && !banned.has(raw.beatmap_id))
    .sort((a, b) => (b.playcount || 0) - (a.playcount || 0) || a.beatmap_id - b.beatmap_id)
    .slice(0, 40)
    .map(raw => [raw.beatmap_id, raw.playcount || 0, raw.favourite_count || 0]);

  // Boss maps nobody in Portugal has full-combo'd: several players, 6.5★ and up, and every play has a miss.
  const bounties = [...boards]
    .filter(([id, b]) => b.entries.length >= 3 && !banned.has(id) && hasTitle(meta(id)) && meta(id).difficultyrating >= 6.5 &&
      !(b.cat === CAT.LOVED && meta(id).difficultyrating >= 10) && b.entries.every(e => e[S.MISS + 1] > 0))
    .sort((a, b) => b[1].entries.length - a[1].entries.length || meta(b[0]).difficultyrating - meta(a[0]).difficultyrating || a[0] - b[0])
    .slice(0, 20)
    .map(([id, b]) => [id, b.cat, b.entries.length, Math.min(...b.entries.map(e => e[S.MISS + 1]))]);

  const challenges = {
    week: weekBoard ? {
      id: week.id, start: week.start, end: week.end, map: weekMap, cat: weekBoard.cat,
      board: weekBoard.entries, weekly: weekBoard.entries.filter(e => e[S.TIME + 1] >= week.start),
    } : null,
    beatable, lonely, unclaimed, bounties,
    // Top pp play and most plays: this week so far, the open map vote and past weeks (null until the
    // bot has written any).
    weekly: weekly.block,
    maps: mapsFor([weekMap, ...beatable.map(r => r[0]), ...lonely.map(r => r[0]), ...unclaimed.map(r => r[0]),
      ...bounties.map(r => r[0]), ...weekly.mapIds].filter(Boolean)),
  };

  // ---- Mapsets ------------------------------------------------------------------------------------------------------
  // sets/{setId % 128}.json: the difficulties of each mapset a page here shows, { setId: [[mapId, version, stars,
  // players]] } easiest first (as osu! orders them), for the map page's switcher. A set lists the maps with a page plus
  // the rest of the set that osu!catch can play (isCatchPlayable), which get a page of their own: their details over an
  // empty board. Sets with a single difficulty are left out.
  const setRows = new Map(); // setId -> Map(mapId -> row)
  const addRow = (set, row) => (setRows.get(set) ?? setRows.set(set, new Map()).get(set)).set(row[0], row);
  for (const bucket of Object.values(mapBuckets)) {
    for (const [id, e] of Object.entries(bucket)) if (e.m?.[M.SET]) addRow(e.m[M.SET], [Number(id), e.m[M.VERSION], e.m[M.STARS], e.s.length]);
  }
  // Dan stages and unclaimed maps have a page too (from dan.json and challenges.json).
  for (const id of [...DAN_MAPS, ...unclaimed.map(r => r[0])]) {
    const set = meta(id)?.beatmapset_id;
    if (set && !setRows.has(set)) setRows.set(set, new Map());
  }
  // The dump's rows carry no title: a difficulty without one borrows its set's (and the set's ranked date).
  const titled = new Map();
  const unlisted = [];
  for (const raw of beatmaps.values()) {
    if (!setRows.has(raw.beatmapset_id)) continue;
    if (hasTitle(raw) && !titled.has(raw.beatmapset_id)) titled.set(raw.beatmapset_id, raw);
    if (isCatchPlayable(raw) && !setRows.get(raw.beatmapset_id).has(raw.beatmap_id)) unlisted.push(raw);
  }
  const newEntries = new Map(); // mapId -> bucket entry, for the difficulties with no page yet
  for (const raw of unlisted) {
    const cat = classify(Number(raw.approved), Number(raw.playmode));
    if (!cat) continue;
    const donor = titled.get(raw.beatmapset_id);
    const sameStatus = donor && Number(donor.approved) === Number(raw.approved);
    const m = toMapTuple(hasTitle(raw) || !donor ? raw : {
      ...raw, artist: donor.artist, title: donor.title, creator: donor.creator,
      approved_date: raw.approved_date ?? (sameStatus ? donor.approved_date : null),
    });
    newEntries.set(raw.beatmap_id, { m, c: cat, s: [] });
    addRow(raw.beatmapset_id, [raw.beatmap_id, m[M.VERSION], m[M.STARS], 0]);
  }
  const setBuckets = {};
  for (const [set, rows] of [...setRows].sort((a, b) => a[0] - b[0])) {
    if (rows.size < 2) continue;
    (setBuckets[set % BUCKETS] ??= {})[set] = [...rows.values()].sort((a, b) => a[2] - b[2] || a[0] - b[0]);
    for (const id of rows.keys()) if (newEntries.has(id)) (mapBuckets[id % BUCKETS] ??= {})[id] = newEntries.get(id);
  }

  // ---- Completion -------------------------------------------------------------------------------------------------
  // How many ranked osu!catch maps the country has cleared (completion.mjs has the rules). Each map nobody has cleared
  // gets a page too, its details over an empty board, borrowing its set's title when the dump left it without one.

  const goal = completion({ bot, beatmaps, homeCountry, previous: previous.cleared, extraTitles });
  const titledTuple = id => {
    const raw = meta(id);
    const title = hasTitle(raw) ? null : goal.titles.get(raw.beatmapset_id);
    return toMapTuple(title ? { ...raw, artist: title[0], title: title[1], creator: title[2] } : raw);
  };
  goal.file.maps = Object.fromEntries(goal.file.recent.map(r => r[0]).sort((a, b) => a - b).map(id => [id, titledTuple(id)]));
  for (const id of goal.left) {
    const bucket = (mapBuckets[id % BUCKETS] ??= {});
    if (!bucket[id]) bucket[id] = { m: titledTuple(id), c: CAT.RANKED, s: [] };
  }

  // ---- Quiz pool ---------------------------------------------------------------------------------------------------

  const sets = new Map();
  for (const [id, b] of boards) {
    const raw = meta(id);
    if (!hasTitle(raw) || !raw.beatmapset_id) continue;
    const set = sets.get(raw.beatmapset_id) || { id: raw.beatmapset_id, artist: raw.artist, title: raw.title, creator: raw.creator, n: 0 };
    set.n = Math.max(set.n, b.entries.length);
    sets.set(raw.beatmapset_id, set);
  }
  const quiz = {
    sets: [...sets.values()].filter(s => s.n >= 2).sort((a, b) => b.n - a.n || a.id - b.id).slice(0, 800)
      .map(s => [s.id, s.artist, s.title, s.creator, s.n]),
  };

  // ---- pp history (one point per day, only when something changed) ------------------------------------------------

  const today = new Date(now * 1000).toISOString().slice(0, 10);
  const history = { days: [...(previous.history?.days || [])], series: { ...(previous.history?.series || {}) }, reconstructed: null };
  for (const id of hidden) delete history.series[id]; // a restricted player's line (it starts over if they're back)
  if (history.days[history.days.length - 1] !== today) history.days.push(today);
  const dayIndex = history.days.length - 1;
  // Official pp is only recorded when osu! reports it live. An inactive player's is an estimate (or an old copy), so
  // their recorded official value is null and the reconstructed series carries the line. Once, the official points
  // recorded before this rule for players who were or are inactive (estimates, and osu!'s 0pp before them) are
  // cleared too; after that (state.officialLiveOnly), a returning player keeps the real points from before.
  const wasInactive = new Set(previous.inactive || []);
  const legacy = !previous.officialLiveOnly;
  for (const p of people.values()) {
    const official = p.inactive ? null : p.pp;
    const scrub = legacy && (p.inactive || wasInactive.has(p.id));
    const series = (history.series[p.id] || []).map(point => (scrub && point[3] !== null ? [...point.slice(0, 3), null] : point));
    const point = [dayIndex, p.cv, p.ul, official];
    const last = series[series.length - 1];
    if (last && last[0] === dayIndex) series[series.length - 1] = point;
    else if (!last || last[1] !== p.cv || last[2] !== p.ul || last[3] !== official) series.push(point);
    history.series[p.id] = series;
  }
  // Before the first recorded day: rebuilt from score dates, recomputed every export (never carried over), and shown
  // as an approximation. The recorded series above always wins from its first day on.
  history.reconstructed = reconstructHistory(people, history.days[0]);

  // ---- Player head files -----------------------------------------------------------------------------------------
  // players/{id}-head.json: what a profile needs to show its first page without the whole file. Each list's first
  // HEAD_ROWS rows in the profile's default order (most pp first; a stable sort, as in the browser, so ties match),
  // the full lengths, the Dan passes, and the badges, era, signature map and recap years, worked out here from the
  // whole file with the profile's own functions (records.json's Choke d'Or included). The profile loads the full file
  // on the first search, sort, filter or page change. Shown as of the export, like everything else.
  const playerEntry = new Map(players.map(p => [p.id, p]));
  const headFiles = {};
  for (const [id, file] of Object.entries(playerFiles)) {
    const first = list => [...list].sort((a, b) => b[S.PP] - a[S.PP]).slice(0, HEAD_ROWS);
    const scores = Object.fromEntries(CATS.map(cat => [cat, first(file.scores[cat])]));
    const top = first(file.top);
    const pre = file.pre ? first(file.pre) : null;
    const shown = [...CATS.flatMap(cat => scores[cat]), ...top, ...(pre || []), ...file.dan.map(([, t]) => t)];
    const entry = playerEntry.get(Number(id));
    headFiles[id] = {
      id: file.id, name: file.name, head: true,
      counts: {
        c: file.scores.c.length, u: file.scores.u.length, r: file.scores.r.length, top: file.top.length,
        dan: file.dan.length, pre: file.pre?.length ?? 0,
      },
      scores, top, dan: file.dan,
      ...(pre ? { pre } : {}),
      maps: Object.fromEntries(shown.map(t => t[S.MAP]).sort((a, b) => a - b).map(m => [m, file.maps[m]])),
      extras: {
        badges: playerBadges(entry, file, records, now),
        era: era(entry, file, now),
        signature: signatureMap(file),
        years: [...new Set(CATS.flatMap(cat => file.scores[cat].map(t => new Date(t[S.TIME] * 1000).getFullYear())))].sort((a, b) => b - a),
      },
    };
  }

  // ---- Meta + state -----------------------------------------------------------------------------------------------

  const metaFile = {
    generatedAt: now,
    homeCountry,
    dump: bot.ptCatchState.last_imported_dump || null,
    totals: records.totals,
    // The completion goal's slice for the home page (completion.mjs homeGoal): the headline, the easiest maps still to
    // clear and the newest first clear. Older data has only { cleared, total }.
    completion: homeGoal(goal.file),
  };

  const state = {
    boards: Object.fromEntries(CATS.map(cat => [cat, order[cat].map(p => p.id)])),
    totals: Object.fromEntries([...people.values()].map(p => [p.id, [p.cv, p.ul, p.pp]])),
    // Each player's official pp as last seen live on osu! ([pp, unix time]), what an inactive player's pp falls back to.
    official: {
      ...(previous.official || {}),
      ...Object.fromEntries([...people.values()].filter(p => !p.inactive && p.pp > 0).map(p => [p.id, [p.pp, now]])),
    },
    inactive: [...people.values()].filter(p => p.inactive).map(p => p.id).sort((a, b) => a - b),
    officialLiveOnly: true,
    // Restricted players stay known, so being unrestricted isn't a "join".
    known: [...new Set([...people.keys(), ...(previous.known || []).filter(id => hidden.has(id))])].sort((a, b) => a - b),
    events: keptStateEvents,
    weeks,
    // Each cleared ranked catch map's first clear, [userId, unix time] (completion.mjs keeps the earliest seen).
    cleared: goal.firsts,
  };

  return {
    files: {
      'meta.json': metaFile,
      'players.json': players,
      'modrankings.json': modRankings,
      'topplays.json': topPlays,
      'dan.json': dan,
      'activity.json': activity,
      'records.json': records,
      'challenges.json': challenges,
      'completion.json': goal.file,
      'quiz.json': quiz,
      'history.json': history,
      'maps-top.json': { total: mapsIndex.length, rows: mapsIndex.slice(0, MAPS_TOP) },
      'maps-search.json': encodeMapsSearch(mapsIndex),
      ...Object.fromEntries(Object.entries(playerFiles).map(([id, file]) => [`players/${id}.json`, file])),
      ...Object.fromEntries(Object.entries(headFiles).map(([id, file]) => [`players/${id}-head.json`, file])),
      ...Object.fromEntries(Object.entries(mapBuckets).map(([b, file]) => [`maps/${b}.json`, file])),
      ...Object.fromEntries(Object.entries(setBuckets).map(([b, file]) => [`sets/${b}.json`, file])),
    },
    state,
  };
}
