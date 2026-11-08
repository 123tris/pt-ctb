// A player pack (packs/player/<id>.ptcb: one player's plays and the maps they're on, by column) for the views, and the
// pp maths over it. The shared helpers (ui/maps.ts, ui/scores.ts) take the JSON's tuples; mapMeta() and play() give
// them one, for a row that's being drawn, so only what's on screen is turned into tuples.

import { GRADES, type PlayerPack } from '../gen/packs.ts';
import { M } from '../kernel/model.ts';
import type { MapMeta } from './maps.ts';
import type { Cat, Play } from './scores.ts';

export type Plays = PlayerPack['c'];

const mapIndex = new WeakMap<PlayerPack, Map<number, number>>();

/** A map's row in the pack's maps by beatmap id, or -1 (an index built once per pack). */
export function mapRow(pack: PlayerPack, id: number): number {
  let index = mapIndex.get(pack);
  if (!index) {
    index = new Map();
    for (let row = 0; row < pack.maps.rows; row++) index.set(pack.maps.id[row], row);
    mapIndex.set(pack, index);
  }
  return index.get(id) ?? -1;
}

/** A map's details as the JSON's map tuple (M): the fields player files carry (PLAYER_MAP_FIELDS), else null. */
export function mapMeta(pack: PlayerPack, id: number): MapMeta {
  const row = mapRow(pack, id);
  if (row < 0) return null;
  const set = pack.maps.set[row];
  const meta: unknown[] = new Array(M.CREATOR + 1).fill(null);
  meta[M.ARTIST] = pack.sets.artist.at(set);
  meta[M.TITLE] = pack.sets.title.at(set);
  meta[M.VERSION] = pack.maps.version.at(row);
  meta[M.SET] = pack.sets.set[set] || null;
  meta[M.STARS] = pack.maps.stars[row] / 100;
  meta[M.AR] = pack.maps.ar[row];
  meta[M.MAX_COMBO] = pack.maps.maxCombo[row];
  meta[M.MODE] = pack.maps.mode[row];
  meta[M.CREATOR] = pack.sets.creator.at(set);
  return meta;
}

const NONE = 0xffffffff;

/** A play as the JSON's score tuple (S). */
export function play(plays: Plays, row: number): Play {
  const opt = (v: number) => (v === NONE ? null : v);
  const pos = 'pos' in plays ? (plays as Plays & { pos: Uint16Array }).pos[row] : 0;
  return [
    plays.map[row], plays.pp[row] / 100, plays.acc[row] / 100, opt(plays.combo[row]), opt(plays.miss[row]), plays.mods[row],
    GRADES[plays.grade[row]] || null, plays.score[row], plays.time[row] || null, opt(plays.hits[row]), pos || null, plays.sid[row] || null,
  ];
}

/**
 * The pp a player's pack counts in a category, one value per map, best first (model.js countedPp): a convert map's
 * best-pp play off its board (`ppc`) counts instead of the board play when it's worth more.
 */
export function countedPp(pack: PlayerPack, cat: Cat): number[] {
  const plays = pack[cat];
  const byMap = new Map<number, number>();
  for (let i = 0; i < plays.rows; i++) byMap.set(plays.map[i], plays.pp[i] / 100);
  if (cat === 'c') {
    for (let i = 0; i < pack.ppc.rows; i++) byMap.set(pack.ppc.map[i], Math.max(byMap.get(pack.ppc.map[i]) ?? 0, pack.ppc.pp[i] / 100));
  }
  return [...byMap.values()].sort((a, b) => b - a);
}

/**
 * osu!'s weighted total (the n-th best play counts 0.95^n) of `pp` (best first), and of it with one more play, for as
 * many trial values as wanted: a binary search and two sums each, instead of sorting and summing the whole list again
 * (the calculator tries 40 values to find the play that passes someone).
 */
export class WeightedTotals {
  private readonly pp: number[];
  /** weight[i] = 0.95^i, multiplied out as model.js weightedTotal does. */
  private readonly weight: Float64Array;
  /** head[k]: the first k plays at their own weights. */
  private readonly head: Float64Array;
  /** tail[k]: the plays from k on, each one place lower (as they are once a better play goes in before them). */
  private readonly tail: Float64Array;

  constructor(ppBestFirst: number[]) {
    const n = ppBestFirst.length;
    this.pp = ppBestFirst;
    this.weight = new Float64Array(n + 2);
    this.weight[0] = 1;
    for (let i = 1; i < n + 2; i++) this.weight[i] = this.weight[i - 1] * 0.95;
    this.head = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) this.head[i + 1] = this.head[i] + (ppBestFirst[i] || 0) * this.weight[i];
    this.tail = new Float64Array(n + 1);
    for (let i = n - 1; i >= 0; i--) this.tail[i] = this.tail[i + 1] + (ppBestFirst[i] || 0) * this.weight[i + 1];
  }

  /** The total as it is. */
  get total(): number {
    return this.head[this.pp.length];
  }

  /** The total with one more play worth `extra` (after any equal ones, as a stable sort puts it). */
  with(extra: number): number {
    let lo = 0, hi = this.pp.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.pp[mid] >= extra) lo = mid + 1;
      else hi = mid;
    }
    return this.head[lo] + extra * this.weight[lo] + this.tail[lo];
  }

  /** The smallest single new play (pp) that lifts the total past `target`; null if none up to 3000 does. */
  toReach(target: number): number | null {
    if (this.with(3000) <= target) return null;
    let lo = 0, hi = 3000;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.with(mid) > target) hi = mid;
      else lo = mid;
    }
    return hi;
  }
}

/**
 * mapMeta(), or null for a map the player's file has no details for: null there, and a row of empty strings and zeros
 * in the pack. For the JSON's helpers, which tell the two apart (a map link shows no star badge for a null map).
 */
export function mapDetails(pack: PlayerPack, id: number): MapMeta {
  const row = mapRow(pack, id);
  if (row < 0) return null;
  const set = pack.maps.set[row];
  const known = pack.sets.title.at(set) || pack.sets.artist.at(set) || pack.maps.version.at(row)
    || pack.sets.set[set] || pack.maps.stars[row];
  return known ? mapMeta(pack, id) : null;
}
