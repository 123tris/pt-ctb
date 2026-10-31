// King of the hill, as the bot writes it (Hill/<month>.json, Hill/current.json, Hill/crowns.json; see HillService in
// the bot), turned into what the site reads (hill.json) and each player's crowns for their profile. Each Lisbon month
// has a pool of one map per slot and tier; the best valid play there this month holds the crown, and whoever holds it
// when the month closes keeps it. Seasons are calendar quarters. No DOM, no osu! calls.

import { modMask } from './weekly.mjs';
import { HILL_SLOTS, HILL_TIERS } from '../../assets/js/core/model.js';
/** An All-rounder has crowns in this many different slots in one season. */
const ALL_ROUNDER = 3;

const isMonthId = id => /^\d{4}-\d\d$/.test(id ?? '');
const unix = iso => Math.floor(Date.parse(iso) / 1000);

/** "2026-11" → "2026-Q4". */
export const seasonOf = month => `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;
/** A season's months: "2026-Q4" → ["2026-10", "2026-11", "2026-12"]. */
export const seasonMonths = season => {
  const first = (Number(season.slice(6)) - 1) * 3 + 1;
  return [0, 1, 2].map(i => `${season.slice(0, 4)}-${String(first + i).padStart(2, '0')}`);
};

/** The players with the most of `counts` (a Map id → n, n ≥ 1): all of them when tied, none when it's empty. */
function most(counts) {
  const top = Math.max(0, ...counts.values());
  return top ? [...counts].filter(([, n]) => n === top).map(([id]) => id).sort((a, b) => a - b) : [];
}

/** When a title was won, for ordering them newest first (a season's before its last month's): its month, or its season's last month. */
const titleTime = title => title.month ?? seasonMonths(title.season)[2];
const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const slotIndex = slot => HILL_SLOTS.indexOf(slot);
const knownSlot = s => slotIndex(s?.slot) >= 0 && HILL_TIERS.includes(s?.tier);
const bySlot = (a, b) => slotIndex(a.slot) - slotIndex(b.slot) || HILL_TIERS.indexOf(a.tier) - HILL_TIERS.indexOf(b.tier);

/**
 * A board entry as the site reads it, with the play's osu! page when the bot knows it (`url`: the bot reads a stable
 * play by its legacy id, whose page isn't /scores/<id>, so the site never builds one from `scoreId`).
 */
const entry = e => ({
  u: e.userId, name: e.username, score: e.hillScore, acc: e.acc, combo: e.combo, miss: e.miss,
  mods: modMask((e.mods ?? []).join('')), time: unix(e.time),
  ...(/^https:\/\/osu\.ppy\.sh\//.test(e.url ?? '') ? { url: e.url } : {}),
});

/**
 * A month's pool as the site shows it: each slot's map, its holder and how many players and snipes it had. A
 * restricted holder comes off the board: while the month runs the next play holds the slot, as on the site's map
 * boards; once it's closed the crown was theirs, so nobody shows.
 */
function pool(month, hidden) {
  return (month.slots ?? []).filter(knownSlot).sort(bySlot).map(s => {
    const board = (s.board ?? []).filter(e => !hidden.has(e.userId));
    const holder = s.holder && !hidden.has(s.holder.userId) ? s.holder : month.status === 'closed' ? null : board[0] ?? null;
    return {
      slot: s.slot, tier: s.tier, map: s.beatmapId, convert: Boolean(s.convert),
      holder: holder ? entry(holder) : null, players: board.length,
      // Taking the slot from someone; the first play on an empty slot (fromUserId null) took it from nobody.
      snipes: (s.snipes ?? []).filter(x => x.fromUserId != null && !hidden.has(x.toUserId) && !hidden.has(x.fromUserId)).length,
    };
  });
}

/**
 * hill.json, or null before the bot has written any King of the hill:
 *   current: the month running now: { month, start, end, status ('live' or 'draft': picked, not approved yet, so no
 *            maps shown), pool, leaders: the players holding the most crowns right now, and how many };
 *            null between a month's close and the next pool;
 *   months:  every closed month, newest first: its pool with who kept each crown, and its King(s) of the hill;
 *   seasons: newest first: each slot's king(s), the All-rounders, and whether the season is over (`final`);
 *   players: everyone with a crown, most first: [id, name, total, [crowns per slot], { season: [crowns per slot] }];
 *   maps:    the pools' maps as map tuples, from what the bot says about them (the exporter swaps in the beatmap
 *            cache's tuple where it has the map).
 * `profiles` is each crowned or holding player's slice for their profile: { total, slots, titles, holding }.
 * Restricted players (`hidden`) hold nothing and their crowns don't count, as everywhere on the site.
 */
export function hillBlock(hill, hidden = new Set()) {
  if (!hill) return { file: null, profiles: new Map(), mapIds: [] };
  const byMonth = new Map();
  for (const m of hill.months ?? []) if (isMonthId(m?.month)) byMonth.set(m.month, m);
  // current.json is the bot's newest word on its month.
  if (isMonthId(hill.current?.month)) byMonth.set(hill.current.month, hill.current);
  const months = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
  const closed = months.filter(m => m.status === 'closed');
  const running = months.find(m => m.status === 'live' || m.status === 'draft');
  const open = running && (!closed.length || running.month > closed[0].month) ? running : null;

  const maps = {};
  // A map tuple (M in model.js) from what the bot says about the map: the fields a map link shows.
  const remember = m => {
    for (const s of (m.slots ?? []).filter(knownSlot)) {
      maps[s.beatmapId] = [s.artist ?? '', s.title ?? '', s.version ?? '', s.beatmapsetId ?? 0, s.stars ?? 0,
        null, null, null, null, null, null, s.maxCombo ?? null, null, s.convert ? 0 : 2, s.creator ?? ''];
    }
  };

  // The crowns: crowns.json when the bot wrote it, otherwise who held each slot when its month closed.
  const crownMonths = Array.isArray(hill.crowns?.months)
    ? hill.crowns.months.filter(m => isMonthId(m?.month)).map(m => ({ month: m.month, crowns: (m.crowns ?? []).filter(knownSlot) }))
    : closed.map(m => ({ month: m.month, crowns: (m.slots ?? []).filter(s => knownSlot(s) && s.holder).map(s => ({ ...s, userId: s.holder.userId, username: s.holder.username })) }));
  const crowns = crownMonths.flatMap(m => m.crowns.filter(c => !hidden.has(c.userId)).map(c => ({ ...c, month: m.month, season: seasonOf(m.month) })));

  const people = new Map();
  const person = (id, name) => people.get(id) ?? people.set(id, { id, name, total: 0, slots: HILL_SLOTS.map(() => 0), seasons: {}, titles: [], holding: [] }).get(id);
  for (const c of crowns) {
    const p = person(c.userId, c.username);
    p.name = c.username || p.name;
    p.total++;
    p.slots[slotIndex(c.slot)]++;
    (p.seasons[c.season] ??= HILL_SLOTS.map(() => 0))[slotIndex(c.slot)]++;
  }

  // Titles. King of the hill: the most crowns in a closed month. <Slot> king: the most crowns in that slot in a season
  // (both tiers count), only settled once the season is over. All-rounder: crowns in 3+ slots in a season, which
  // can't be taken away once earned. Ties share the title.
  const latest = open?.month ?? closed[0]?.month ?? '';
  const finished = season => seasonMonths(season)[2] < latest || closed.some(m => m.month === seasonMonths(season)[2]);
  const monthKings = new Map(crownMonths.map(m => {
    const counts = new Map();
    for (const c of crowns.filter(x => x.month === m.month)) bump(counts, c.userId);
    return [m.month, { kings: most(counts), count: Math.max(0, ...counts.values()) }];
  }));
  for (const [month, { kings }] of monthKings) for (const id of kings) person(id).titles.push({ kind: 'king', month, final: true });

  const seasons = [...new Set(crowns.map(c => c.season))].sort().reverse().map(id => {
    const inSeason = crowns.filter(c => c.season === id);
    const final = finished(id);
    const kings = {};
    for (const slot of HILL_SLOTS) {
      const counts = new Map();
      for (const c of inSeason.filter(x => x.slot === slot)) bump(counts, c.userId);
      if (counts.size) kings[slot] = most(counts);
      for (const p of kings[slot] ?? []) person(p).titles.push({ kind: 'slot', season: id, slot, final });
    }
    const slotsOf = new Map();
    for (const c of inSeason) (slotsOf.get(c.userId) ?? slotsOf.set(c.userId, new Set()).get(c.userId)).add(c.slot);
    const allRounders = [...slotsOf].filter(([, s]) => s.size >= ALL_ROUNDER).map(([u]) => u).sort((a, b) => a - b);
    for (const u of allRounders) person(u).titles.push({ kind: 'allrounder', season: id, final: true });
    return { id, final, kings, allRounders };
  });

  let current = null;
  if (open) {
    const draft = open.status === 'draft';
    const shown = draft ? [] : pool(open, hidden);
    if (!draft) remember(open);
    const held = new Map();
    for (const s of shown) if (s.holder) {
      bump(held, s.holder.u);
      person(s.holder.u, s.holder.name).holding.push([s.slot, s.tier, s.map]);
    }
    const leaders = most(held);
    current = {
      month: open.month, start: unix(open.start), end: unix(open.end), status: draft ? 'draft' : 'live', pool: shown,
      leaders: leaders.length ? { players: leaders, held: held.get(leaders[0]) } : null,
    };
  }

  const archive = closed.map(m => {
    remember(m);
    const { kings = [], count = 0 } = monthKings.get(m.month) ?? {};
    // The crowns the month gave, which its holders should match; where they don't, crowns.json wins.
    const given = new Map(crowns.filter(c => c.month === m.month).map(c => [`${c.slot}/${c.tier}`, c]));
    const listed = crownMonths.some(x => x.month === m.month);
    const shown = pool(m, hidden).map(s => {
      const crown = given.get(`${s.slot}/${s.tier}`);
      if (!listed || s.holder?.u === crown?.userId) return s;
      return { ...s, holder: crown ? { u: crown.userId, name: crown.username } : null };
    });
    return { month: m.month, start: unix(m.start), end: unix(m.end), kings, most: count, pool: shown };
  });

  const ranked = [...people.values()].filter(p => p.total).sort((a, b) => b.total - a.total || a.id - b.id);
  const file = {
    current,
    months: archive,
    seasons,
    players: ranked.map(p => [p.id, p.name, p.total, p.slots, p.seasons]),
    maps,
  };
  const profiles = new Map([...people.values()].filter(p => p.total || p.holding.length).map(p => [p.id, {
    total: p.total, slots: p.slots, titles: p.titles.sort((a, b) => titleTime(b).localeCompare(titleTime(a)) || Boolean(b.season) - Boolean(a.season)), holding: p.holding,
  }]));
  return { file, profiles, mapIds: Object.keys(maps).map(Number) };
}
