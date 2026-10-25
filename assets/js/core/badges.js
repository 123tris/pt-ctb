// Fun profile extras worked out from a player's own file: badges named after the Discord's in-jokes, the player's
// current "era" and their signature map. Pure functions: no DOM.

import { S, M, MOD, MODE, CATS, DAN_ROLES, adjustedAr } from './model.js';
import { THRONE_PLAYER } from './lore.js';

const DAY = 86400;
const isS = g => g === 'S' || g === 'SH' || g === 'X' || g === 'XH';

function allPlays(file) {
  return CATS.flatMap(cat => file.scores[cat].map(s => ({ cat, s, meta: file.maps[s[S.MAP]] })));
}

/**
 * Badges as { name, tip }: each one is a running joke from the Discord, earned from the player's stored plays.
 * `records` (optional) adds the all-time ones decided across everyone, like the Choke d'Or.
 */
export function playerBadges(p, file, records, now = Date.now() / 1000) {
  const plays = allPlays(file);
  const count = test => plays.filter(test).length;
  const out = [];
  const add = (name, tip) => out.push({ name, tip });

  if (p.global && p.global < 10000) {
    const digits = String(p.global).length;
    add(`${digits}-digit club`, `Global rank ${p.global.toLocaleString('en-GB')}. "${digits - 1} digits when?"`);
  }
  if (p.id === THRONE_PLAYER) add('Final boss', 'Every #1 here is up for grabs. Dethrone him on the records page.');
  if (records?.oneMiss?.[0]?.[0] === p.id) add('Choke d’Or', `More plays with exactly one miss than anyone in Portugal (${records.oneMiss[0][1]}).`);

  const blessed = count(x => x.s[S.MISS] === 1 && x.meta?.[M.STARS] >= 6);
  if (blessed) add('Blessed by the 1-miss gods', `${blessed} ${blessed === 1 ? 'play' : 'plays'} with exactly one miss on 6★ and up.`);

  // A catch-specific map's max combo is the real one, so combo ≥ 90% with one miss means it was right at the start or
  // the very end. The data can't tell which, hence "almost".
  const reverse = count(x => x.s[S.MISS] === 1 && x.meta?.[M.MODE] === MODE.CATCH && x.meta[M.MAX_COMBO] && x.s[S.COMBO] >= 0.9 * x.meta[M.MAX_COMBO]);
  if (reverse) add('Almost a reverse choke', `${reverse} ${reverse === 1 ? 'play' : 'plays'} with one miss and 90%+ of the combo: so close to the end (or the start).`);

  const trisAcc = count(x => x.s[S.MISS] === 0 && x.s[S.GRADE] === 'A');
  if (trisAcc) add('TrisAcc', `${trisAcc} full ${trisAcc === 1 ? 'combo' : 'combos'} with an A rank. An FC is an FC.`);

  const walls = count(x => x.s[S.POS] === 1 && x.s[S.TIME] < now - 2 * 365 * DAY);
  if (walls) add('The Wall', `${walls} #1 ${walls === 1 ? 'play has' : 'plays have'} stood for more than two years.`);

  const lowAr = count(x => (x.s[S.MODS] & MOD.HD) && isS(x.s[S.GRADE]) && x.meta && adjustedAr(x.meta[M.AR], x.s[S.MODS]) <= 8);
  if (lowAr >= 3) add('Low AR HD army', `${lowAr} S ranks with HD at AR 8 or below. Reading that is a skill of its own.`);

  const times = plays.map(x => x.s[S.TIME]).sort((a, b) => a - b);
  const last = times[times.length - 1] ?? 0;
  if (last > now - 120 * DAY) {
    const recentGap = times.some((t, i) => i > 0 && t > now - 365 * DAY && t - times[i - 1] >= 180 * DAY);
    if (recentGap) add('Derusting', 'Back after six months or more away. Welcome back.');
  }

  const ezFirsts = count(x => x.s[S.POS] === 1 && (x.s[S.MODS] & MOD.EZ));
  if (ezFirsts >= 5) add('EZ king', `${ezFirsts} #1s with EZ. Easy? Never.`);

  const specifics = Math.max(p.ul, p.pp);
  if (p.cv > 0 && p.cv >= 1.5 * specifics) add('Convert main', 'Converts or specifics? This one picked a side.');
  else if (specifics > 0 && specifics >= 1.5 * p.cv) add('Specifics main', 'Converts or specifics? This one picked a side.');

  if (plays.some(x => x.s[S.COMBO] === 727) || p.global === 727 || p.country === 727) add('WYSI', 'A 727 somewhere on this profile. When you see it…');

  const day = t => { const d = new Date(t * 1000); return [d.getUTCMonth(), d.getUTCDate()]; };
  const xmas = count(x => x.s[S.POS] === 1 && (([m, d]) => m === 11 && (d === 24 || d === 25))(day(x.s[S.TIME])));
  if (xmas) add('Early Christmas present', `${xmas} #1 ${xmas === 1 ? 'play' : 'plays'} set on Christmas Eve or Christmas Day.`);
  if (plays.some(x => (([m, d]) => m === 5 && d === 10)(day(x.s[S.TIME])))) add('Portugal Day', 'Played on 10 June, as a patriot should.');

  const genius = count(x => x.s[S.MISS] >= 20 && x.meta?.[M.STARS] >= 7);
  if (genius) add('Only for genius', `${genius} ${genius === 1 ? 'pass' : 'passes'} on 7★ and up with 20 or more misses.`);

  const next = DAN_ROLES.find(([min]) => min > p.danScore);
  if (p.danScore > 0 && next && p.danScore >= 0.8 * next[0]) {
    // PT text (intentional): "still plenty of soup to eat", the Discord's way of saying "keep growing".
    add('Ainda há muita sopa', `Still plenty of soup to eat: ${next[0] - p.danScore} Dan points from ${next[1]}.`);
  }
  return out;
}

/** "farming converts", "HD everything"… from the player's last year of plays. */
export function era(p, file, now = Date.now() / 1000) {
  const plays = allPlays(file);
  if (!plays.length) return null;
  const last = Math.max(...plays.map(x => x.s[S.TIME]));
  if (last < now - 365 * DAY) return 'retired (for now)';
  const recent = plays.filter(x => x.s[S.TIME] > last - 365 * DAY);
  const share = test => recent.filter(test).length / recent.length;
  if (share(x => x.s[S.MODS] & (MOD.DT | MOD.NC)) >= 0.5) return 'DT farming';
  if (share(x => x.s[S.MODS] & MOD.HD) >= 0.6) return 'HD everything';
  if (share(x => x.s[S.MODS] & MOD.HR) >= 0.5) return 'HR enjoyer';
  if (share(x => x.cat === 'c') >= 0.6) return 'farming converts';
  if (share(x => x.cat === 'u') >= 0.5) return 'hunting loved maps';
  if (share(x => x.cat === 'r') >= 0.5) return 'playing specifics';
  return 'a bit of everything';
}

/**
 * The words members use to sort maps, guessed from the map and its Portuguese board ([[uid, ...score]]).
 * Returns [{ name, tip }].
 */
export function mapTags(meta, board, cat) {
  if (!meta) return [];
  const tags = [];
  const n = board.length;
  const top = board.reduce((max, e) => Math.max(max, e[S.PP + 1]), 0);
  const fcs = board.filter(e => e[S.MISS + 1] === 0).length;
  const oneMiss = board.filter(e => e[S.MISS + 1] === 1).length;
  if (meta[M.AR] <= 8) tags.push({ name: 'low AR HD', tip: 'AR 8 or below: add HD and the fruit appears out of nowhere.' });
  if (meta[M.STARS] >= 7 && meta[M.LENGTH] >= 180 && n <= 8) tags.push({ name: 'boss', tip: 'Long, 7★ and up, and few Portuguese players have survived it.' });
  if (n >= 4 && oneMiss / n >= 0.3) tags.push({ name: 'choke central', tip: `${oneMiss} of ${n} Portuguese plays here have exactly one miss.` });
  if (n >= 5 && fcs / n >= 0.6 && top >= 250) tags.push({ name: 'free pp', tip: `${fcs} of ${n} Portuguese players FC’d it, and the best play is worth ${Math.round(top)} pp.` });
  if (meta[M.LENGTH] <= 120 && n >= 10 && top >= 250 && cat !== 'u') tags.push({ name: 'farm', tip: 'Short, popular and worth a lot of pp.' });
  if (n >= 3 && fcs === 0) tags.push({ name: 'no FC yet', tip: 'Nobody in Portugal has FC’d this. Yet.' });
  return tags;
}

/** The player's oldest #1 that still stands, or else their best play. */
export function signatureMap(file) {
  const plays = allPlays(file);
  const firsts = plays.filter(x => x.s[S.POS] === 1).sort((a, b) => a.s[S.TIME] - b.s[S.TIME]);
  if (firsts.length) return { kind: 'Oldest #1 still standing', ...firsts[0] };
  const best = plays.sort((a, b) => b.s[S.PP] - a.s[S.PP])[0];
  return best ? { kind: 'Best play', ...best } : null;
}
