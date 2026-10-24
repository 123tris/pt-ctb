// Turns the bot's data into the site's public JSON. Pure: takes the loaded data, the previous exporter state and
// the current time, and returns { files, state } - nothing here touches the disk.

import {
  S, M, CAT, CATS, STATUS, MODE, DAN_MAPS, classify, boardComparator, weightedTotal, matchesModFilter,
  parseModFilter, modString, isSS,
} from '../../assets/js/core/model.js';

const DAY = 86400;
const BUCKETS = 128;
const MOD_FILTERS = ['NM', 'HD', 'HR', 'DT', 'FL', 'EZ', 'HT', 'HDHR', 'HDDT', 'HRDT'];
const PP_MILESTONES = 1000;
const ACTIVITY_DAYS = 120;
const MAX_EVENTS = 400;

const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
// Older profiles hold accuracy as a 0-1 fraction, newer ones as a percentage.
const percent = acc => (acc > 0 && acc <= 1 ? acc * 100 : acc);
const isoTime = date => Math.floor(Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(date) ? date : `${date}Z`) / 1000);

/** A bot UserScore as the compact tuple the site reads (see S in model.js). */
function toTuple(s) {
  const hits = s.count300 + s.count100 + s.count50;
  const max = hits + s.countmiss + s.countkatu;
  return [
    s.beatmap_id, round(s.pp ?? 0), round(max ? (hits * 100) / max : 0), s.maxcombo, s.countmiss,
    s.enabled_mods, s.rank, s.score, isoTime(s.date), hits,
  ];
}

/** A cached beatmap as the compact tuple the site reads (see M in model.js). */
function toMapTuple(raw) {
  return [
    raw.artist || '', raw.title || '', raw.version || '', raw.beatmapset_id || 0, round(raw.difficultyrating || 0),
    raw.diff_approach ?? 0, raw.diff_size ?? 0, raw.diff_overall ?? 0, raw.diff_drain ?? 0, raw.bpm ?? 0,
    raw.hit_length ?? 0, raw.max_combo ?? 0, Number(raw.approved), Number(raw.playmode), raw.creator || '',
  ];
}

const hasTitle = raw => raw && raw.title && raw.title !== 'Unknown';

/** The best play per map (pp first, then score), sorted best-pp-first. */
function bestPerMap(tuples) {
  const byMap = new Map();
  for (const t of tuples) {
    const old = byMap.get(t[S.MAP]);
    if (!old || t[S.PP] > old[S.PP] || (t[S.PP] === old[S.PP] && t[S.SCORE] > old[S.SCORE])) byMap.set(t[S.MAP], t);
  }
  return [...byMap.values()].sort((a, b) => b[S.PP] - a[S.PP] || a[S.MAP] - b[S.MAP]);
}

/** ISO-8601 week id ("2026-W43") and its Monday 00:00 UTC start, for a unix time. */
function isoWeek(time) {
  const date = new Date(time * 1000);
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day) / 1000;
  const thursday = new Date((monday + 3 * DAY) * 1000);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1) / 1000;
  const week = 1 + Math.floor((monday + 3 * DAY - yearStart) / (7 * DAY));
  return { id: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, start: monday, end: monday + 7 * DAY };
}

/** A small stable string hash (FNV-1a), so the weekly map pick doesn't depend on Math.random. */
function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

const lisbonHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: 'numeric', hourCycle: 'h23' });

/** Which beatmap ids the export needs metadata for, so the 140 MB cache can be filtered while loading. */
export function neededMapIds(bot, homeCountry) {
  const ids = new Set(DAN_MAPS);
  const add = list => { for (const s of list || []) ids.add(s.beatmap_id); };
  for (const p of bot.players) {
    if (p.country !== homeCountry) continue;
    add(p.TopConvertedScores); add(p.TopUnrankedScores); add(p.RankedSpecificScores);
    for (const s of p.DanPasses || []) if (s) ids.add(s.beatmap_id);
  }
  for (const p of bot.ptCatch) {
    if (p.country !== homeCountry) continue;
    add(p.top_scores); add(p.community_scores);
  }
  return ids;
}

/** Ranked/approved osu!catch-specific maps with a title: the pool for "maps nobody here has played yet". */
export const isUnclaimedCandidate = raw =>
  hasTitle(raw) && Number(raw.playmode) === MODE.CATCH &&
  (Number(raw.approved) === STATUS.RANKED || Number(raw.approved) === STATUS.APPROVED);

export function build({ bot, beatmaps, homeCountry, now, state: previous }) {
  // A banned map keeps its scores, but every one of them is worth 0pp (as in the bot).
  const banned = bot.banned;
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
    if (!people.has(id)) people.set(id, { id, name, raw: null, dump: null, lists: { c: [], u: [], r: [] }, dump_top: [] });
    return people.get(id);
  };

  for (const raw of bot.players) {
    if (raw.country !== homeCountry) continue;
    const p = person(raw.user_id, raw.username);
    p.raw = raw;
    p.lists.c.push(...(raw.TopConvertedScores || []).filter(Boolean).map(tuple));
    p.lists.u.push(...(raw.TopUnrankedScores || []).filter(Boolean).map(tuple));
    p.lists.r.push(...(raw.RankedSpecificScores || []).filter(Boolean).map(tuple));
  }
  for (const dump of bot.ptCatch) {
    if (dump.country !== homeCountry) continue;
    const p = person(dump.user_id, dump.username);
    p.dump = dump;
    p.dump_top = (dump.top_scores || []).filter(Boolean).map(tuple).sort((a, b) => b[S.PP] - a[S.PP]);
    // Ranked specifics from the dump top the tracked list up; a player the bot never registered (it normally
    // does, after every import) still gets their dump plays filed by category.
    for (const s of p.raw ? dump.top_scores || [] : dump.community_scores || []) {
      if (!s) continue;
      const cat = catOf(s.beatmap_id, null);
      if (cat === CAT.RANKED || (!p.raw && cat)) p.lists[cat].push(tuple(s));
    }
  }
  for (const p of people.values()) for (const cat of CATS) p.lists[cat] = bestPerMap(p.lists[cat]);

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
    p.pp = round(raw.pp_raw || dump.pp || 0);
    p.global = raw.pp_rank || dump.global_rank || null;
    p.country = raw.pp_country_rank || dump.country_rank || null;
    p.firsts = Object.fromEntries(CATS.map(cat => [cat, p.lists[cat].filter(t => position.get(`${p.id}:${t[S.MAP]}`) === 1).length]));
    p.dan = (raw.DanPasses || []).map((s, i) => (s ? [i, toTuple(s)] : null)).filter(Boolean);
    p.danScore = raw.DanScore || 0;
    const all = CATS.flatMap(cat => p.lists[cat]);
    p.last = all.reduce((max, t) => Math.max(max, t[S.TIME]), 0) || null;
  }

  const ranking = key => [...people.values()].filter(p => p[key] > 0).sort((a, b) => b[key] - a[key] || a.id - b.id);
  const order = { c: ranking('cv'), u: ranking('ul'), r: ranking('pp') };
  const rankOf = Object.fromEntries(CATS.map(cat => [cat, new Map(order[cat].map((p, i) => [p.id, i + 1]))]));

  const players = [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map(p => {
    const raw = p.raw || {}, dump = p.dump || {};
    return {
      id: p.id, name: p.name,
      cv: p.cv, ul: p.ul, pp: p.pp,
      rank: { c: rankOf.c.get(p.id) || null, u: rankOf.u.get(p.id) || null, r: rankOf.r.get(p.id) || null },
      global: p.global, country: p.country,
      acc: round(percent(raw.accuracy ?? dump.accuracy ?? 0)), level: round(raw.level ?? dump.level ?? 0),
      plays: raw.playcount ?? dump.playcount ?? 0,
      grades: [raw.count_rank_ss ?? dump.count_rank_ss ?? 0, raw.count_rank_s ?? dump.count_rank_s ?? 0, raw.count_rank_a ?? dump.count_rank_a ?? 0],
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

  // ---- Per-player files ------------------------------------------------------------------------------------------

  const playerFiles = {};
  for (const p of people.values()) {
    const withPos = t => [...t, position.get(`${p.id}:${t[S.MAP]}`) || null];
    const lists = Object.fromEntries(CATS.map(cat => [cat, p.lists[cat].map(withPos)]));
    const ids = [...CATS.flatMap(cat => p.lists[cat].map(t => t[S.MAP])), ...p.dan.map(([, t]) => t[S.MAP]),
      ...p.dump_top.map(t => t[S.MAP])];
    playerFiles[p.id] = {
      id: p.id, name: p.name,
      scores: lists,
      top: p.dump_top, // the dump's best ranked plays (official pp, converts included) for the "Ranked" view
      dan: p.dan,
      maps: mapsFor(ids),
    };
  }

  // ---- Map buckets + search index -------------------------------------------------------------------------------

  const mapBuckets = {};
  const mapsIndex = [];
  for (const [id, board] of [...boards].sort((a, b) => a[0] - b[0])) {
    const meta = mapTuple(id);
    const bucket = (mapBuckets[id % BUCKETS] ??= {});
    bucket[id] = { m: meta, c: board.cat, s: board.entries, ...(banned.has(id) ? { banned: true } : {}) };
    mapsIndex.push([
      id, meta ? meta[M.SET] : 0, meta ? meta[M.ARTIST] : '', meta ? meta[M.TITLE] : '', meta ? meta[M.VERSION] : '',
      meta ? meta[M.STARS] : 0, board.cat, board.entries.length, board.entries[0][0],
    ]);
  }
  mapsIndex.sort((a, b) => b[7] - a[7] || a[0] - b[0]);

  // ---- Mod rankings ---------------------------------------------------------------------------------------------

  const pools = { r: p => p.dump_top, c: p => p.lists.c, u: p => p.lists.u };
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
  // A #1 set after the current runner-up's score must have taken the spot from them: their score already stood
  // and was the best of everyone else's (nobody's best ever goes down), so no history is needed to see snipes.
  for (const [id, board] of boards) {
    const [top, second] = board.entries;
    if (!second || top[S.TIME + 1] < since || top[S.TIME + 1] <= second[S.TIME + 1]) continue;
    derived.push({ t: top[S.TIME + 1], k: 'snipe', u: top[0], v: second[0], c: board.cat, s: top.slice(1) });
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
  const stateEvents = [...(previous.events || [])];
  if (previous.boards) {
    for (const cat of [CAT.CONVERT, CAT.LOVED, CAT.RANKED]) {
      const before = new Map((previous.boards[cat] || []).map((id, i) => [id, i]));
      order[cat].forEach((p, i) => {
        const was = before.get(p.id);
        if (was === undefined || was <= i) return;
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

  const ranksByHour = new Array(24).fill(0);
  const perYear = {};
  const modUsage = {};
  for (const { t } of allScores) {
    ranksByHour[Number(lisbonHour.format(new Date(t[S.TIME] * 1000)))]++;
    const year = new Date(t[S.TIME] * 1000).getUTCFullYear();
    perYear[year] = (perYear[year] || 0) + 1;
    const mods = modString(t[S.MODS]);
    modUsage[mods] = (modUsage[mods] || 0) + 1;
  }

  const contested = [...boards].filter(([, b]) => b.entries.length >= 2);
  const oldestFirst = contested.reduce((old, [id, b]) => (!old || b.entries[0][S.TIME + 1] < old.entries[0][S.TIME + 1] ? { id, ...b } : old), null);

  const records = {
    topPlay: Object.fromEntries(CATS.map(cat => [cat, asRow(best(allScores.filter(x => x.cat === cat), x => x.t[S.PP]))])),
    topCombo: asRow(best(allScores, x => x.t[S.COMBO])),
    hardest: Object.fromEntries(CATS.map(cat => [cat, asRow(best(allScores.filter(x => x.cat === cat && fairMods(x.t) && meta(x.t[S.MAP])),
      x => meta(x.t[S.MAP]).difficultyrating))])),
    longest: asRow(best(allScores.filter(x => fairMods(x.t) && meta(x.t[S.MAP])), x => meta(x.t[S.MAP]).hit_length)),
    oldestFirst: oldestFirst ? [oldestFirst.entries[0][0], oldestFirst.cat, ...oldestFirst.entries[0].slice(1)] : null,
    mostFirsts: Object.fromEntries(CATS.map(cat => [cat, leaders(p => p.firsts[cat])])),
    mostScores: leaders(p => CATS.reduce((n, cat) => n + p.lists[cat].length, 0)),
    mostSS: leaders(p => CATS.reduce((n, cat) => n + p.lists[cat].filter(t => isSS(t[S.GRADE])).length, 0)),
    mostFC: leaders(p => CATS.reduce((n, cat) => n + p.lists[cat].filter(t => t[S.MISS] === 0).length, 0)),
    mostFruits: leaders(p => CATS.reduce((n, cat) => n + p.lists[cat].reduce((sum, t) => sum + t[S.HITS], 0), 0)),
    popularMaps: [...boards].map(([id, b]) => [id, b.cat, b.entries.length]).sort((a, b) => b[2] - a[2] || a[0] - b[0]).slice(0, 10),
    mods: Object.entries(modUsage).sort((a, b) => b[1] - a[1]).slice(0, 12),
    perYear: Object.entries(perYear).map(([y, n]) => [Number(y), n]).sort((a, b) => a[0] - b[0]),
    byHour: ranksByHour,
    totals: {
      players: people.size, scores: allScores.length, maps: boards.size,
      fruits: allScores.reduce((n, x) => n + x.t[S.HITS], 0),
      ss: allScores.filter(x => isSS(x.t[S.GRADE])).length,
    },
  };
  const recordMapIds = [
    ...Object.values(records.topPlay), records.topCombo, ...Object.values(records.hardest), records.longest, records.oldestFirst,
  ].filter(Boolean).map(r => r[S.MAP + 2]);
  records.maps = mapsFor([...recordMapIds, ...records.popularMaps.map(r => r[0])]);

  // ---- Challenges -------------------------------------------------------------------------------------------------

  const week = isoWeek(now);
  const weeks = { ...(previous.weeks || {}) };
  if (!weeks[week.id] || !boards.has(weeks[week.id])) {
    const pool = [...boards]
      .filter(([id, b]) => b.cat !== CAT.LOVED && !banned.has(id) && b.entries.length >= 4 && hasTitle(meta(id)) &&
        meta(id).difficultyrating >= 3.5 && meta(id).difficultyrating <= 6.5 && !Object.values(weeks).includes(id))
      .map(([id]) => id)
      .sort((a, b) => a - b);
    if (pool.length) weeks[week.id] = pool[hash(week.id) % pool.length];
  }
  const weekMap = weeks[week.id];
  const weekBoard = weekMap ? boards.get(weekMap) : null;

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

  const challenges = {
    week: weekBoard ? {
      id: week.id, start: week.start, end: week.end, map: weekMap, cat: weekBoard.cat,
      board: weekBoard.entries, weekly: weekBoard.entries.filter(e => e[S.TIME + 1] >= week.start),
    } : null,
    beatable, lonely, unclaimed,
    maps: mapsFor([weekMap, ...beatable.map(r => r[0]), ...lonely.map(r => r[0]), ...unclaimed.map(r => r[0])].filter(Boolean)),
  };

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
  const history = { days: [...(previous.history?.days || [])], series: { ...(previous.history?.series || {}) } };
  if (history.days[history.days.length - 1] !== today) history.days.push(today);
  const dayIndex = history.days.length - 1;
  for (const p of people.values()) {
    const series = [...(history.series[p.id] || [])];
    const point = [dayIndex, p.cv, p.ul, p.pp];
    const last = series[series.length - 1];
    if (last && last[0] === dayIndex) series[series.length - 1] = point;
    else if (!last || last[1] !== p.cv || last[2] !== p.ul || last[3] !== p.pp) series.push(point);
    history.series[p.id] = series;
  }

  // ---- Meta + state -----------------------------------------------------------------------------------------------

  const metaFile = {
    generatedAt: now,
    homeCountry,
    dump: bot.ptCatchState.last_imported_dump || null,
    totals: records.totals,
  };

  const state = {
    boards: Object.fromEntries(CATS.map(cat => [cat, order[cat].map(p => p.id)])),
    totals: Object.fromEntries([...people.values()].map(p => [p.id, [p.cv, p.ul, p.pp]])),
    known: [...people.keys()].sort((a, b) => a - b),
    events: keptStateEvents,
    weeks,
  };

  return {
    files: {
      'meta.json': metaFile,
      'players.json': players,
      'modrankings.json': modRankings,
      'dan.json': dan,
      'activity.json': activity,
      'records.json': records,
      'challenges.json': challenges,
      'quiz.json': quiz,
      'history.json': history,
      'maps-index.json': mapsIndex,
      ...Object.fromEntries(Object.entries(playerFiles).map(([id, file]) => [`players/${id}.json`, file])),
      ...Object.fromEntries(Object.entries(mapBuckets).map(([b, file]) => [`maps/${b}.json`, file])),
    },
    state,
  };
}
