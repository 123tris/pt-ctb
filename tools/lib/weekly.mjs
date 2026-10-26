// The weekly highlights, as the bot writes them (Weekly/<week>.json, Weekly/current.json; see WeeklyService in the
// bot), turned into what the site reads, plus the week itself: Monday 00:00 to Monday 00:00, Lisbon time, as in the
// bot's LisbonWeek. No DOM, no osu! calls.

import { MOD } from '../../assets/js/core/model.js';

const DAY = 86400;

const lisbonDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' });
const lisbonOffset = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', timeZoneName: 'longOffset' });

/** Lisbon's UTC offset at a unix time, in seconds ("GMT+01:00" → 3600, "GMT" → 0). */
function offsetAt(time) {
  const name = lisbonOffset.formatToParts(new Date(time * 1000)).find(p => p.type === 'timeZoneName').value;
  const m = /([+-])(\d\d):(\d\d)/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60) : 0;
}

/** Midnight in Lisbon on a calendar date given as its UTC midnight (unix seconds). Clocks change at 01:00 UTC on Sundays, never near a Monday midnight. */
const lisbonMidnight = utcDate => utcDate - offsetAt(utcDate);

/** The community week a unix time falls in: { id: "2026-W44", start, end } (unix seconds; Monday 00:00 Lisbon to the next). */
export function lisbonWeek(time) {
  const [y, m, d] = lisbonDate.format(new Date(time * 1000)).split('-').map(Number);
  const day = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  const monday = Date.UTC(y, m - 1, d - day) / 1000;
  const thursday = new Date((monday + 3 * DAY) * 1000);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1) / 1000;
  const week = 1 + Math.floor((monday + 3 * DAY - yearStart) / (7 * DAY));
  return {
    id: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
    start: lisbonMidnight(monday),
    end: lisbonMidnight(monday + 7 * DAY),
  };
}

/**
 * A play's osu! score id for the site (S.ID): the current ("solo") id as a positive number, a stable play's legacy id
 * as a negative one, 0 when the bot doesn't know which kind it has. Takes a bot score (Users/*.json) or a log line.
 */
export function scoreId(s) {
  const id = s.score_id ?? s.id ?? 0;
  const legacy = s.legacy_score_id ?? s.lid ?? 0;
  if (s.solo && id > 0) return id;
  return legacy > 0 ? -legacy : 0;
}

/** "HDHR" → the mods bitmask the site's tuples carry. */
export function modMask(acronyms) {
  let mask = 0;
  for (let i = 0; acronyms && acronyms !== 'NM' && i < acronyms.length; i += 2) mask |= MOD[acronyms.slice(i, i + 2)] ?? 0;
  return mask;
}

/** A logged play as a score tuple (see S in model.js); it has no hit count, and a position slot only to reach S.ID. */
function logTuple(l) {
  const t = [l.m, l.pp ?? 0, l.acc ?? 0, l.combo ?? 0, l.miss ?? 0, modMask(l.mods), l.g, l.sc ?? 0, l.t, 0];
  const id = scoreId(l);
  return id ? [...t, null, id] : t;
}

/** A logged play as a row: [user, category, ...tuple], the shape activity.json's recent plays use. */
const row = l => (l ? [l.u, l.c, ...logTuple(l)] : null);

const isWeekId = id => /^\d{4}-W\d\d$/.test(id ?? '');

/** The week an id like "2026-W44" names: { id, start, end } (unix seconds, Lisbon time), or null. */
export function weekOf(id) {
  const m = /^(\d{4})-W(\d\d)$/.exec(id ?? '');
  if (!m) return null;
  const jan4 = Date.UTC(Number(m[1]), 0, 4) / 1000;
  const monday = jan4 - ((new Date(jan4 * 1000).getUTCDay() + 6) % 7) * DAY + (Number(m[2]) - 1) * 7 * DAY;
  return lisbonWeek(monday + 12 * 3600);
}

/**
 * The maps the bot's votes chose, by the week they're the map of the week for: each closed week's map vote, once the
 * next recap has counted it. A vote whose recap was never posted decides nothing.
 */
export function votedMaps(weeks = []) {
  const voted = new Map();
  for (const w of weeks) {
    const vote = w?.mapVote;
    if (w?.vote && isWeekId(vote?.week) && Number.isInteger(vote.map)) voted.set(vote.week, vote.map);
  }
  return voted;
}

/**
 * The weekly block of challenges.json, or null when the bot hasn't written any weekly data yet:
 *   current: the week so far (top pp play, most plays) from Weekly/current.json, when it's this week's;
 *   mapVote: the newest recap's vote for a coming map of the week, while it runs: the week it's for, the Discord post and
 *            the maps, [map id, community players on it], in their number order on the post;
 *   past:    every closed week, newest first: its map of the week (`picked`, the exporter's record, with whether a vote
 *            chose it), top pp play and most plays.
 * Also returns the map ids the block mentions.
 *
 * The players in `hidden` (restricted on osu!) are left out: a play of theirs shows as none (the bot's summary has no
 * runner-up to put in its place), and most plays goes to the next player.
 */
export function weeklyBlock({ weeks = [], current = null } = {}, now, hidden = new Set(), { picked = {}, playersOn = () => 0 } = {}) {
  const closed = weeks.filter(w => isWeekId(w?.week)).sort((a, b) => a.week.localeCompare(b.week));
  const live = isWeekId(current?.week) && current.week === lisbonWeek(now).id ? current : null;
  if (!closed.length && !live) return { block: null, mapIds: [] };

  const latest = closed.at(-1);
  const shown = play => (play && !hidden.has(play.u) ? play : null);
  const most = rows => (rows ?? []).filter(r => !hidden.has(r[0]));
  const vote = latest?.mapVote;
  const open = latest?.vote?.url && vote?.candidates?.length && !Number.isInteger(vote.winner) ? weekOf(vote.week) : null;
  const voted = votedMaps(closed);
  const block = {
    current: live ? {
      week: live.week, start: live.start, end: live.end, complete: live.complete, passes: live.passes, players: live.players,
      top: row(shown(live.topPp)), most: most(live.mostPlays).slice(0, 3),
    } : null,
    mapVote: open ? {
      week: open.id, start: open.start, end: open.end, url: latest.vote.url,
      candidates: vote.candidates.map(id => [id, playersOn(id)]),
    } : null,
    past: closed.slice().reverse().map(w => ({
      week: w.week, start: w.start, end: w.end, complete: w.complete,
      map: picked[w.week] ?? null, voted: Boolean(picked[w.week]) && voted.get(w.week) === picked[w.week],
      top: row(shown(w.topPp)), most: most(w.mostPlays)[0] ?? null,
    })),
  };

  const mapIds = [block.current?.top?.[2], ...(block.mapVote?.candidates ?? []).map(c => c[0]),
    ...block.past.flatMap(p => [p.map, p.top?.[2]])].filter(Boolean);
  return { block, mapIds };
}
