// Shared data model: used by the site in the browser AND by tools/export.mjs in Node, so the shapes the
// exporter writes and the shapes the pages read can never drift apart. No DOM, no Node APIs in here.

/**
 * Indices into a score tuple: [map, pp, acc, combo, miss, mods, grade, score, time, hits]. In a player's own file
 * each tuple also carries POS, the play's position among Portuguese players on that map.
 */
export const S = { MAP: 0, PP: 1, ACC: 2, COMBO: 3, MISS: 4, MODS: 5, GRADE: 6, SCORE: 7, TIME: 8, HITS: 9, POS: 10 };

/**
 * Indices into a beatmap tuple:
 * [artist, title, version, setId, stars, ar, cs, od, hp, bpm, length, maxCombo, status, mode, creator].
 */
export const M = {
  ARTIST: 0, TITLE: 1, VERSION: 2, SET: 3, STARS: 4, AR: 5, CS: 6, OD: 7, HP: 8,
  BPM: 9, LENGTH: 10, MAX_COMBO: 11, STATUS: 12, MODE: 13, CREATOR: 14,
  // When the map was ranked, approved, qualified or loved (unix seconds); null otherwise or unknown. Data from before
  // 2026-10-25 has no such element, so read it as `meta[M.RANKED_AT] ?? null`.
  RANKED_AT: 15,
  // When the map was last updated (unix seconds), or null when unknown. Same caveat: read as `meta[M.UPDATED_AT] ?? null`.
  UPDATED_AT: 16,
};

/** Tris: the player whose #1s the records page dares everyone to take (he keeps asking to be sniped). */
export const THRONE_PLAYER = 3821475;

/** Score categories, as the bot files them (see CatchScoreRules in the bot). */
export const CAT = { CONVERT: 'c', LOVED: 'u', RANKED: 'r' };
export const CATS = [CAT.CONVERT, CAT.LOVED, CAT.RANKED];

/** osu! beatmap approval states (the bot's Approved enum). */
export const STATUS = { GRAVEYARD: -2, WIP: -1, PENDING: 0, RANKED: 1, APPROVED: 2, QUALIFIED: 3, LOVED: 4 };

/** osu! game modes (the bot's GameMode enum). */
export const MODE = { OSU: 0, TAIKO: 1, CATCH: 2, MANIA: 3 };

/** Which category a score on a map with this status/mode belongs to; null = untracked (qualified). */
export function classify(status, mode) {
  if (status === STATUS.RANKED || status === STATUS.APPROVED) return mode === MODE.OSU ? CAT.CONVERT : CAT.RANKED;
  if (status === STATUS.QUALIFIED) return null;
  return CAT.LOVED;
}

// ---- Mods -------------------------------------------------------------------------------------------

export const MOD = {
  NF: 1, EZ: 2, TD: 4, HD: 8, HR: 16, SD: 32, DT: 64, RX: 128, HT: 256, NC: 512, FL: 1024, AU: 2048,
  SO: 4096, AP: 8192, PF: 16384,
};

// Community order: difficulty-reducers first, then HD before HR/DT ("HDHR", "HDDT"), then the rest.
const MOD_ORDER = ['EZ', 'HD', 'HR', 'DT', 'NC', 'HT', 'FL', 'NF', 'SD', 'PF', 'RX', 'TD', 'SO', 'AP', 'AU'];

/** "HDHR", "HDNC", "NM"… from an enabled_mods bitmask. NC implies DT and PF implies SD, so those pairs show once. */
export function modString(mask) {
  const names = MOD_ORDER.filter(name => {
    if (!(mask & MOD[name])) return false;
    if (name === 'DT' && (mask & MOD.NC)) return false;
    if (name === 'SD' && (mask & MOD.PF)) return false;
    return true;
  });
  return names.length ? names.join('') : 'NM';
}

/** Mods a mod ranking filters on; NF/SD/PF/… never disqualify a play (matches the bot's ModRankingService). */
export const FILTERABLE = MOD.EZ | MOD.HD | MOD.HR | MOD.DT | MOD.HT | MOD.FL;

/** A play matches a mod filter when it includes every requested mod; the nomod filter (0) requires none. */
export function matchesModFilter(mask, filter) {
  const relevant = mask & FILTERABLE;
  return filter === 0 ? relevant === 0 : (relevant & filter) === filter;
}

/** Parses "HD", "HDDT", "NM" into a filter mask, or null for anything unknown. */
export function parseModFilter(text) {
  const s = String(text || '').toUpperCase().replace(/\+/g, '');
  if (s === 'NM' || s === '') return 0;
  if (s.length % 2) return null;
  let mask = 0;
  for (let i = 0; i < s.length; i += 2) {
    const name = s.slice(i, i + 2) === 'NC' ? 'DT' : s.slice(i, i + 2);
    if (!(MOD[name] & FILTERABLE)) return null;
    mask |= MOD[name];
  }
  return mask;
}

// ---- Totals and ordering ------------------------------------------------------------------------------

/** osu!'s weighted total: the n-th best play counts 0.95^n. Expects pp values sorted best-first. */
export function weightedTotal(ppSortedDesc) {
  let total = 0, weight = 1;
  for (const pp of ppSortedDesc) {
    total += (pp || 0) * weight;
    weight *= 0.95;
  }
  return total;
}

/**
 * Orders a map's scores the way the bot ranks them: community pp on loved/unranked maps (there is no meaningful
 * official board there), classic score everywhere else. Each entry is [userId, ...scoreTuple].
 */
export function boardComparator(cat) {
  const pp = S.PP + 1, score = S.SCORE + 1;
  return cat === CAT.LOVED
    ? (a, b) => (b[pp] - a[pp]) || (b[score] - a[score])
    : (a, b) => (b[score] - a[score]) || (b[pp] - a[pp]);
}

/** Grades that count as SS. */
export const isSS = grade => grade === 'X' || grade === 'XH';

// ---- osu!catch pp ---------------------------------------------------------------------------------------

/** The factor Hidden multiplies a play's pp by at a (mod-adjusted) approach rate. */
export const hiddenBonus = ar => (ar <= 10 ? 1.05 + 0.075 * (10 - ar) : 1.01 + 0.04 * (11 - Math.min(11, ar)));

/**
 * osu!catch performance points — a port of the bot's PPCalculator (ppy/osu's CatchPerformanceCalculator as deployed
 * 2025-10-29). Stars and AR must already be mod-adjusted; only HD/FL/NF are applied here.
 */
export function catchPp({ stars, ar, maxCombo, combo, misses = 0, acc, mods = 0, comboHits }) {
  if (!(maxCombo > 0)) return 0;
  const hits = comboHits ?? maxCombo;
  let value = Math.pow(5 * Math.max(1, stars / 0.0049) - 4, 2) / 100000;

  const lengthBonus = 0.95 + 0.3 * Math.min(1, hits / 2500) + (hits > 2500 ? Math.log10(hits / 2500) * 0.475 : 0);
  value *= lengthBonus;
  value *= Math.pow(0.97, misses);
  value *= Math.min(Math.pow(combo, 0.35) / Math.pow(maxCombo, 0.35), 1);

  let arFactor = 1;
  if (ar > 9) arFactor += 0.1 * (ar - 9);
  if (ar > 10) arFactor += 0.1 * (ar - 10);
  else if (ar < 8) arFactor += 0.025 * (8 - ar);
  value *= arFactor;

  if (mods & MOD.HD) value *= hiddenBonus(ar);
  if (mods & MOD.FL) value *= 1.35 * lengthBonus;
  value *= Math.pow(Math.min(1, Math.max(0, acc / 100)), 5.5);
  if (mods & MOD.NF) value *= Math.max(0.9, 1 - 0.02 * misses);

  return Number.isFinite(value) ? Math.round(100 * value) / 100 : 0;
}

/** Approach rate after EZ/HR (the multiplier) and DT/HT (the clock), as osu! computes it. */
export function adjustedAr(ar, mods) {
  if (mods & MOD.HR) ar = Math.min(10, ar * 1.4);
  if (mods & MOD.EZ) ar = ar / 2;
  const rate = (mods & (MOD.DT | MOD.NC)) ? 1.5 : (mods & MOD.HT) ? 0.75 : 1;
  if (rate === 1) return ar;
  const ms = ar < 5 ? 1800 - 120 * ar : 1200 - 150 * (ar - 5);
  const scaled = ms / rate;
  return scaled > 1200 ? (1800 - scaled) / 120 : 5 + (1200 - scaled) / 150;
}

// ---- Dan course -------------------------------------------------------------------------------------------

/** The Dan stages in the bot's DanTitles order: name, Hebrew glyph (if any), points and pass accuracy. */
export const DAN_STAGES = [
  ['Zeroth', '0', 5], ['First', '1', 5], ['Second', '2', 5], ['Third', '3', 10], ['Fourth', '4', 10],
  ['Fifth', '5', 15], ['Sixth', '6', 15], ['Seventh', '7', 20], ['Eighth', '8', 20], ['Nineth', '9', 30],
  ['Tenth', '10', 30], ['Aleph', 'א', 50], ['Beth', 'ב', 75], ['Ghimel', 'ג', 100], ['Zayin', 'ז', 200],
  ['Lamed', 'ל', 350], ['Samech', 'ס', 600], ['Tsadi', 'צ', 1500], ['Shin', 'ש', 5000],
].map(([key, glyph, points], index) => ({ index, key, glyph, points, passAcc: index > 10 ? 99 : 98 }));

/** Dan stage beatmap ids, by stage index (the bot's DanProject.MapIds). */
export const DAN_MAPS = [
  1668132, 1644298, 1644299, 1644300, 1644301, 1644302, 1850071, 1850072, 1850073, 3143922,
  1850070, 1850074, 1850075, 1848953, 1848957, 1848954, 1848955, 1848956, 1872971,
];

/** Discord role titles by Dan score threshold, lowest first (the bot's DanProject.GetTitle). */
export const DAN_ROLES = [
  [30, 'Dan Skrub'], [80, 'Dan Intermed'], [120, 'Dan Expert'], [250, 'Dan Beast'], [1000, 'PT Best Player'],
];

export function danRole(score) {
  let role = null;
  for (const [min, name] of DAN_ROLES) if (score >= min) role = name;
  return role;
}
