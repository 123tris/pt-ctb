// Duels: rated 1v1 osu!catch matches played in osu! multiplayer lobbies, which the bot follows and scores (DuelService
// in the bot). It writes Duels/ratings.json (Glicko-2 ratings by osu! id), Duels/matches/<month>.json (every finished
// duel with its rounds) and Duels/state.json, whose `active` list is the duels being played right now. This turns them
// into what the site reads: duels.json for Challenges' Duels tab, duels/<n>.json for each duel's own page, a slice on
// each duelist's profile and the Activity feed's duel results. No DOM, no osu! calls.
//
// state.json is the bot's own and holds Discord ids (threads, messages, who clicked what); so may anything the bot adds
// to the other files later. Nothing is passed through: every row below is built field by field from the public ones,
// and players are only ever osu! ids. A duel with a player the site doesn't show (restricted, or not a Portuguese
// player it tracks) is left out whole, as is a cancelled one (it never started).

import { isoTime } from './build.mjs';
import { DUEL_PROVISIONAL_RD, duelFile } from '../../assets/js/core/model.js';

/** Duels in duels.json's recent list. Older ones are on their own pages (duels/<n>.json). */
export const RECENT_DUELS = 100;
/** Duels on a profile. */
export const PROFILE_DUELS = 20;
/** Duel results in the Activity feed at most, newest first, so a busy week of duels doesn't crowd out the rest. */
const FEED_DUELS = 60;

const STATUSES = new Set(['finished', 'forfeit', 'abandoned']);
const FORMATS = new Set([1, 3, 5, 7, 9]);

const osuId = v => (Number.isSafeInteger(v) && v > 0 ? v : null);
const int = v => (Number.isSafeInteger(v) ? v : null);
const count = v => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
const round = (n, places = 0) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** places) / 10 ** places : null);
const time = iso => {
  const t = typeof iso === 'string' ? isoTime(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};
const text = (v, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** A duel's two players as the site shows them, or null when it doesn't have exactly two the site can show. */
function sides(players, known, ranked) {
  if (!Array.isArray(players) || players.length !== 2) return null;
  const out = players.map(p => {
    const u = osuId(p?.osuId);
    if (!u || !known(u)) return null;
    const rating = ranked && round(p.ratingBefore) !== null && round(p.ratingAfter) !== null;
    return {
      u, name: text(p.name, 40) ?? `#${u}`, pts: count(p.points),
      ...(rating ? { before: round(p.ratingBefore), after: round(p.ratingAfter), rd: round(p.rdAfter) } : {}),
    };
  });
  return out.every(Boolean) && out[0].u !== out[1].u ? out : null;
}

/** A round: its map and stars, the winner (null for a tie or a void round) and both players' scores. */
function roundCopy(r, ids) {
  const map = osuId(r?.beatmapId);
  if (!map) return null;
  const scores = (Array.isArray(r.scores) ? r.scores : []).filter(s => ids.includes(s?.osuId)).map(s => ({
    u: s.osuId, score: count(s.score), acc: round(s.acc, 2), combo: count(s.combo), miss: count(s.misses), pass: s.passed !== false,
  }));
  const reason = text(r.void, 120);
  return {
    n: int(r.n), map, stars: round(r.stars, 2),
    winner: !reason && ids.includes(r.winner) ? r.winner : null,
    void: reason, scores,
  };
}

/** A finished, forfeited or abandoned duel as the site shows it, or null to leave it out. */
export function duelCopy(d, known) {
  const id = osuId(d?.id);
  if (!id || !STATUSES.has(d.status)) return null;
  const ranked = d.ranked === true;
  // An abandoned duel counts for nobody's rating, ranked or not.
  const players = sides(d.players, known, ranked && d.status !== 'abandoned');
  if (!players) return null;
  const ids = players.map(p => p.u);
  const min = round(d.stars?.min, 2), max = round(d.stars?.max, 2);
  return {
    id, code: text(d.code, 24), ranked, bestOf: FORMATS.has(d.bestOf) ? d.bestOf : null, status: d.status,
    start: time(d.startedAt), end: time(d.endedAt), mp: osuId(d.matchId),
    stars: min !== null && max !== null ? [min, max] : null,
    wager: osuId(d.wager),
    winner: d.status !== 'abandoned' && ids.includes(d.winner) ? d.winner : null,
    players,
    rounds: (Array.isArray(d.rounds) ? d.rounds : []).map(r => roundCopy(r, ids)).filter(Boolean),
  };
}

/** A duel being played now (state.json `active`), from its allow-listed fields only, or null to leave it out. */
export function liveCopy(d, known) {
  const id = osuId(d?.id);
  if (!id || !Array.isArray(d.players) || d.players.length !== 2) return null;
  const players = d.players.map(p => (osuId(p?.osuId) && known(p.osuId) ? { u: p.osuId, name: text(p.name, 40) ?? `#${p.osuId}`, pts: count(p.points) } : null));
  if (!players.every(Boolean) || players[0].u === players[1].u) return null;
  return {
    id, code: text(d.code, 24), ranked: d.ranked === true, bestOf: FORMATS.has(d.bestOf) ? d.bestOf : null,
    start: time(d.startedAt), mp: osuId(d.matchId), players,
  };
}

/** A ladder row from ratings.json, or null for a player the site doesn't show or who has no ranked duel yet. */
function ladderRow(key, r, known) {
  const u = osuId(Number(key));
  if (!u || !known(u) || !r || round(r.r) === null) return null;
  const w = count(r.w), l = count(r.l);
  if (!w && !l) return null;
  const rd = round(r.rd) ?? 350;
  return {
    u, name: text(r.name, 40) ?? `#${u}`, r: round(r.r), rd, w, l, streak: int(r.streak) ?? 0,
    peak: Math.max(round(r.peak) ?? 0, round(r.r)), last: time(r.lastAt), prov: rd >= DUEL_PROVISIONAL_RD,
  };
}

/** Sorts newest first: by when it ended, else when it started, then by id. */
const newestFirst = (a, b) => (b.end ?? b.start ?? 0) - (a.end ?? a.start ?? 0) || b.id - a.id;

/**
 * Everything the site shows of duels, or { file: null, … } before the bot has a Duels/ folder. `known(osuId)` is
 * whether the player is on the site (restricted players and players it doesn't track aren't).
 *   file:    duels.json: { ladder, live, recent, total, maps }. The ladder is every player with a ranked duel, rated
 *            ones by rating with their place (`rank`), then the provisional ones (rank null); `recent` the newest
 *            RECENT_DUELS duels with their rounds (abandoned ones too, which the site shows muted); `total` how many
 *            duels there are in all.
 *   pages:   { 'duels/12.json': { duels: { id: duel }, maps } }, every duel by id for its own page, a hundred ids a
 *            file (duelFile in model.js), so a file stops changing once its hundred are played.
 *   profiles: osu! id → the profile's slice: rating (null with no ranked duel), place, record, the last PROFILE_DUELS
 *            duels and the head-to-head against each opponent.
 *   mapIds:  the duels' maps, for build.mjs to fill in (maps: { id: null } until it does).
 *   events:  the Activity feed's duel results: { t, k: 'duel', u: winner, v: loser, d: id, sc: [won, lost], r: rating
 *            change, ff: 1 for a forfeit }, ranked duels only.
 *   summary: meta.json's line: { live, players, total, leader }.
 */
export function duelsBlock(duels, known) {
  if (!duels) return { file: null, pages: {}, profiles: new Map(), mapIds: [], events: [], summary: null };
  // The same duel twice (in two month files): the one read last, from the later month, wins.
  const byId = new Map();
  for (const d of duels.matches ?? []) {
    const copy = duelCopy(d, known);
    if (copy) byId.set(copy.id, copy);
  }
  const all = [...byId.values()].sort(newestFirst);

  const rows = Object.entries(duels.ratings ?? {}).map(([key, r]) => ladderRow(key, r, known)).filter(Boolean);
  const rated = rows.filter(r => !r.prov).sort((a, b) => b.r - a.r || a.u - b.u);
  const provisional = rows.filter(r => r.prov).sort((a, b) => b.r - a.r || a.u - b.u);
  const ladder = [...rated.map((r, i) => ({ ...r, rank: i + 1 })), ...provisional.map(r => ({ ...r, rank: null }))];
  const live = (duels.active ?? []).map(d => liveCopy(d, known)).filter(Boolean).sort((a, b) => (b.start ?? 0) - (a.start ?? 0) || b.id - a.id);

  const recent = all.slice(0, RECENT_DUELS);
  const mapsOf = list => Object.fromEntries([...new Set(list.flatMap(d => d.rounds.map(r => r.map)))].sort((a, b) => a - b).map(id => [id, null]));
  const pages = {};
  for (const d of all) ((pages[duelFile(d.id)] ??= { duels: {}, maps: {} }).duels[d.id] = d);
  for (const page of Object.values(pages)) page.maps = mapsOf(Object.values(page.duels));

  // Each duelist's slice: their rating, their last duels and their record against each opponent (abandoned duels
  // show in the list but count for nobody).
  const profiles = new Map();
  const ladderOf = new Map(ladder.map(r => [r.u, r]));
  const profile = u => profiles.get(u) ?? profiles.set(u, { rating: null, recent: [], h2h: new Map() }).get(u);
  for (const r of ladder) profile(r.u).rating = { r: r.r, rd: r.rd, prov: r.prov, rank: r.rank, w: r.w, l: r.l, streak: r.streak, peak: r.peak };
  for (const d of all) {
    for (const [me, them] of [[d.players[0], d.players[1]], [d.players[1], d.players[0]]]) {
      const p = profile(me.u);
      const res = d.winner === me.u ? 'w' : d.winner === them.u ? 'l' : 'x';
      if (p.recent.length < PROFILE_DUELS) {
        p.recent.push({
          id: d.id, t: d.end ?? d.start, opp: them.u, s: [me.pts, them.pts], res, ranked: d.ranked,
          ...(d.status === 'forfeit' ? { ff: 1 } : {}), ...(me.after !== undefined ? { d: Math.round(me.after - me.before) } : {}),
        });
      }
      if (res === 'x') continue;
      const h = p.h2h.get(them.u) ?? p.h2h.set(them.u, [them.u, 0, 0]).get(them.u);
      h[res === 'w' ? 1 : 2]++;
    }
  }
  for (const p of profiles.values()) p.h2h = [...p.h2h.values()].sort((a, b) => b[1] + b[2] - a[1] - a[2] || b[1] - a[1] || a[0] - b[0]);

  const events = all.filter(d => d.ranked && d.winner && d.end).slice(0, FEED_DUELS).map(d => {
    const [won, lost] = d.players[0].u === d.winner ? d.players : [d.players[1], d.players[0]];
    return {
      t: d.end, k: 'duel', u: won.u, v: lost.u, d: d.id, sc: [won.pts, lost.pts],
      ...(won.after !== undefined ? { r: Math.round(won.after - won.before) } : {}), ...(d.status === 'forfeit' ? { ff: 1 } : {}),
    };
  });

  return {
    file: { ladder, live, recent, total: all.length, maps: mapsOf(recent) },
    pages,
    profiles,
    mapIds: [...new Set(all.flatMap(d => d.rounds.map(r => r.map)))],
    events,
    summary: { live: live.length, players: ladder.length, total: all.length, leader: rated[0]?.u ?? null },
  };
}

/** The maps duels were played on, from the bot's files as they are: for neededMapIds, before anything is filtered. */
export function duelMapIds(duels) {
  return (duels?.matches ?? []).flatMap(d => (Array.isArray(d?.rounds) ? d.rounds : []).map(r => osuId(r?.beatmapId)).filter(Boolean));
}
