// Fun profile extras worked out from a player's own file: badges named after the Discord's in-jokes, the player's
// current "era" and their signature map. Pure functions: no DOM.
//
// The exporter runs these too and writes the badges and era into each player's head file in English, so the English
// templates below stay the source; localBadge() and localEra() put them into the visitor's language (core/pt.js).

import { S, M, MOD, MODE, CATS, DAN_ROLES, adjustedAr } from './model.js';
import { t, tn, lang } from './i18n.js';

const DAY = 86400;
const isS = g => g === 'S' || g === 'SH' || g === 'X' || g === 'XH';

function allPlays(file) {
  return CATS.flatMap(cat => file.scores[cat].map(s => ({ cat, s, meta: file.maps[s[S.MAP]] })));
}

// A badge only means something if few players have it, so each rule is set to be earned by about a quarter of the
// tracked players at most (checked against the data on 2026-10-25; see notes/streamlining-analysis.md).
const REVERSE_MIN = 5;
const TRISACC_MIN = 3;
const LOW_AR_MIN = 20;
const GENIUS_MIN = 10;

/** Each badge's [name, tip] in English, {x} filled in per player; a tip that counts plays has its singular and plural. */
const BADGES = /* i18n */ {
  chokeDor: ['Choke d’Or', 'More plays with exactly one miss than anyone in Portugal ({n}).'],
  wall: ['The Wall', '{n} #1s that have stood for more than two years: one of the three biggest walls in Portugal.'],
  digits: ['{digits}-digit club', 'Global rank {rank}. "{less} digits when?"'],
  blessed: ['Blessed by the 1-miss gods', '{n} play with exactly one miss on 6★ and up.', '{n} plays with exactly one miss on 6★ and up.'],
  reverse: ['Almost a reverse choke', '{n} plays with one miss and 97%+ of the combo: so close to the end (or the start).'],
  trisAcc: ['TrisAcc', '{n} full combos with an A rank. An FC is an FC.'],
  lowAr: ['Low AR HD army', '{n} S ranks with HD at AR 8 or below. Reading that is a skill of its own.'],
  derusting: ['Derusting', 'Back after six months or more away. Welcome back.'],
  ezKing: ['EZ king', '{n} #1s with EZ. Easy? Never.'],
  wysi: ['WYSI', 'A 727 somewhere on this profile. When you see it…'],
  genius: ['Only for genius', '{n} passes on 7★ and up with 20 or more misses.'],
  // PT text (intentional): "still plenty of soup to eat", the Discord's way of saying "keep growing".
  soup: ['Ainda há muita sopa', 'Still plenty of soup to eat: {n} Dan points from {role}.'],
};

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));

/**
 * Badges as { name, tip }, rarest kinds first: each one is a running joke from the Discord, earned from the player's
 * stored plays. `records` (optional) adds the ones decided across everyone, like the Choke d'Or and The Wall.
 */
export function playerBadges(p, file, records, now = Date.now() / 1000) {
  const plays = allPlays(file);
  const count = test => plays.filter(test).length;
  const out = [];
  const add = (key, vars = {}) => {
    const [name, ...tips] = BADGES[key];
    out.push({ name: fill(name, vars), tip: fill(tips[tips.length > 1 && vars.n !== 1 ? 1 : 0], vars) });
  };

  if (records?.oneMiss?.[0]?.[0] === p.id) add('chokeDor', { n: records.oneMiss[0][1] });
  const wall = records?.wall?.find(([id]) => id === p.id);
  if (wall) add('wall', { n: wall[1] });
  if (p.global && p.global < 1000) {
    const digits = String(p.global).length;
    add('digits', { digits, rank: p.global.toLocaleString('en-GB'), less: digits - 1 });
  }

  const blessed = count(x => x.s[S.MISS] === 1 && x.meta?.[M.STARS] >= 6);
  if (blessed) add('blessed', { n: blessed });

  // A catch-specific map's max combo is the real one, so combo ≥ 97% with one miss means it was right at the start or
  // the very end. The data can't tell which, hence "almost".
  const reverse = count(x => x.s[S.MISS] === 1 && x.meta?.[M.MODE] === MODE.CATCH && x.meta[M.MAX_COMBO] && x.s[S.COMBO] >= 0.97 * x.meta[M.MAX_COMBO]);
  if (reverse >= REVERSE_MIN) add('reverse', { n: reverse });

  const trisAcc = count(x => x.s[S.MISS] === 0 && x.s[S.GRADE] === 'A');
  if (trisAcc >= TRISACC_MIN) add('trisAcc', { n: trisAcc });

  const lowAr = count(x => (x.s[S.MODS] & MOD.HD) && isS(x.s[S.GRADE]) && x.meta && adjustedAr(x.meta[M.AR], x.s[S.MODS]) <= 8);
  if (lowAr >= LOW_AR_MIN) add('lowAr', { n: lowAr });

  const times = plays.map(x => x.s[S.TIME]).sort((a, b) => a - b);
  const last = times[times.length - 1] ?? 0;
  if (last > now - 120 * DAY) {
    const recentGap = times.some((t, i) => i > 0 && t > now - 365 * DAY && t - times[i - 1] >= 180 * DAY);
    if (recentGap) add('derusting');
  }

  const ezFirsts = count(x => x.s[S.POS] === 1 && (x.s[S.MODS] & MOD.EZ));
  if (ezFirsts >= 5) add('ezKing', { n: ezFirsts });

  if (plays.some(x => x.s[S.COMBO] === 727) || p.global === 727 || p.country === 727) add('wysi');

  const genius = count(x => x.s[S.MISS] >= 20 && x.meta?.[M.STARS] >= 7);
  if (genius >= GENIUS_MIN) add('genius', { n: genius });

  const next = DAN_ROLES.find(([min]) => min > p.danScore);
  if (p.danScore > 0 && next && p.danScore >= 0.8 * next[0]) add('soup', { n: next[0] - p.danScore, role: next[1] });
  return out;
}

/** {name: value} when `text` is `template` filled in, else null. */
function unfill(template, text) {
  const names = [];
  const pattern = template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_, name) => { names.push(name); return '(.+?)'; });
  const m = new RegExp(`^${pattern}$`).exec(text);
  return m && Object.fromEntries(names.map((name, i) => [name, m[i + 1]]));
}

/** A badge ({ name, tip }, in English from playerBadges() or a head file) in the visitor's language. */
export function localBadge(b) {
  if (lang === 'en') return b;
  for (const [name, ...tips] of Object.values(BADGES)) {
    const named = unfill(name, b.name);
    if (!named) continue;
    for (const tip of tips) {
      const vars = unfill(tip, b.tip);
      if (vars) return { name: t(name, named), tip: tips.length > 1 ? tn(Number(vars.n), tips[0], tips[1], vars) : t(tip, vars) };
    }
  }
  return b;
}

/** The eras era() and eraOf() return, in English (the exporter writes them out); localEra() translates one. */
const ERA = /* i18n */ {
  retired: 'retired (for now)',
  dt: 'DT farming',
  hd: 'HD everything',
  hr: 'HR enjoyer',
  converts: 'farming converts',
  loved: 'hunting loved maps',
  ranked: 'playing specifics',
  mixed: 'a bit of everything',
};

/** An era from era() or eraOf() (or a head file) in the visitor's language. */
export const localEra = e => (e ? t(e) : e);

/** "farming converts", "HD everything"… from the player's last year of plays. */
export function era(p, file, now = Date.now() / 1000) {
  const plays = allPlays(file);
  if (!plays.length) return null;
  const last = Math.max(...plays.map(x => x.s[S.TIME]));
  if (last < now - 365 * DAY) return ERA.retired;
  return eraOf(plays.filter(x => x.s[S.TIME] > last - 365 * DAY));
}

/** The era a set of plays ({ cat, s }) shows; shared by the profile (last 12 months) and the recap (one year). */
export function eraOf(plays) {
  const share = test => (plays.length ? plays.filter(test).length / plays.length : 0);
  if (share(x => x.s[S.MODS] & (MOD.DT | MOD.NC)) >= 0.5) return ERA.dt;
  if (share(x => x.s[S.MODS] & MOD.HD) >= 0.6) return ERA.hd;
  if (share(x => x.s[S.MODS] & MOD.HR) >= 0.5) return ERA.hr;
  if (share(x => x.cat === 'c') >= 0.6) return ERA.converts;
  if (share(x => x.cat === 'u') >= 0.5) return ERA.loved;
  if (share(x => x.cat === 'r') >= 0.5) return ERA.ranked;
  return ERA.mixed;
}

/**
 * The words members use to sort maps, guessed from the map and its Portuguese board ([[uid, ...score]]).
 * Returns [{ name, tip }], in the visitor's language (only the site shows these).
 */
export function mapTags(meta, board, cat) {
  if (!meta) return [];
  const tags = [];
  const n = board.length;
  const top = board.reduce((max, e) => Math.max(max, e[S.PP + 1]), 0);
  const fcs = board.filter(e => e[S.MISS + 1] === 0).length;
  const oneMiss = board.filter(e => e[S.MISS + 1] === 1).length;
  if (meta[M.AR] <= 8) tags.push({ name: t('low AR HD'), tip: t('AR 8 or below: add HD and the fruit appears out of nowhere.') });
  if (meta[M.STARS] >= 7 && meta[M.LENGTH] >= 180 && n <= 8) tags.push({ name: t('boss'), tip: t('Long, 7★ and up, and few Portuguese players have survived it.') });
  if (n >= 4 && oneMiss / n >= 0.3) tags.push({ name: t('choke central'), tip: t('{oneMiss} of {n} Portuguese plays here have exactly one miss.', { oneMiss, n }) });
  if (n >= 5 && fcs / n >= 0.6 && top >= 250) tags.push({ name: t('free pp'), tip: t('{fcs} of {n} Portuguese players FC’d it, and the best play is worth {pp} pp.', { fcs, n, pp: Math.round(top) }) });
  if (meta[M.LENGTH] <= 120 && n >= 10 && top >= 250 && cat !== 'u') tags.push({ name: t('farm'), tip: t('Short, popular and worth a lot of pp.') });
  if (n >= 3 && fcs === 0) tags.push({ name: t('no FC yet'), tip: t('Nobody in Portugal has FC’d this. Yet.') });
  return tags.slice(0, 2); // two at most, so a map page leads with the map, not the labels
}

/**
 * The player's best #1 by pp, or else their best play. (It used to be their oldest standing #1, which for veterans
 * was often an easy diff from years ago rather than anything they're known for.)
 */
export function signatureMap(file) {
  const plays = allPlays(file).sort((a, b) => b.s[S.PP] - a.s[S.PP]);
  const first = plays.find(x => x.s[S.POS] === 1);
  if (first) return { kind: 'Best #1', ...first };
  return plays[0] ? { kind: 'Best play', ...plays[0] } : null;
}
