// The bounty board (bounties.json): the bounties moderators post with the bot's !bounty, from its Bounties.json, plus
// the automatic "wanted" list of boss maps. Pure: takes the loaded bounties and what build.mjs knows about the boards.
//
// The bot's file carries Discord ids (the announcement channel, who posted a bounty, a pledger's Discord account, the
// claim's announcement message). They never leave it: every row below is built field by field from the public ones.

import { S } from '../../assets/js/core/model.js';
import { isoTime } from './build.mjs';

const GOALS = new Set(['fc', 'pass', 'snipe']);
const round = (n, places = 2) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** places) / 10 ** places : null);
const time = iso => {
  const t = typeof iso === 'string' ? isoTime(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};
const text = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
const osuId = v => (Number.isSafeInteger(v) && v > 0 ? v : null);

/**
 * A bounty's Bananas, for the open row: [id, pot, funds, poster, expires, mods, stake], or all null for a bounty with
 * none (from before Bananas). The pot is the stake plus every fund; a fund is [osuId or null (not on the site), amount],
 * biggest first; the poster is null for a house bounty.
 */
function bananas(b, known) {
  const stake = Number.isSafeInteger(b.stake) && b.stake > 0 ? b.stake : 0;
  const funds = (Array.isArray(b.funds) ? b.funds : []).filter(f => Number.isSafeInteger(f?.amount) && f.amount > 0)
    .map(f => [known(osuId(f.user)) ? f.user : null, f.amount]).sort((x, y) => y[1] - x[1]);
  const pot = stake + funds.reduce((n, f) => n + f[1], 0);
  const mods = text(b.mods)?.replace(/^NM$/, '') || null;
  const poster = known(osuId(b.poster)) ? b.poster : null;
  return [Number.isSafeInteger(b.id) ? b.id : null, pot || null, funds, poster, time(b.expires), mods, stake || null];
}

/** A pledge as [prize, by, byOsu, until, lapsed]: `until` unix seconds or null (no end), lapsed once it's past `now`. */
function pledgeRow(p, now) {
  const until = time(p.until);
  return [text(p.prize), text(p.by), osuId(p.byOsu), until, until !== null && until < now];
}

/**
 * bounties.json.
 *  - open: [mapId, cat, goal, posted, players, closestMiss, target, pledges, id, pot, funds, poster, expires, mods, stake],
 *    newest first. `players` and `closestMiss` (the fewest misses on the board) are 0 and null for a map nobody here has
 *    played; `target` is the snipe holder. From `id` on it's the bounty's Bananas (bananas() above).
 *  - hall: [mapId, cat, goal, status, uid, at, mods, acc, combo, pp, prizes, payout], newest claim first. `done` is a
 *    goal a play from before the bounty had already met (credited quietly); `prizes` are the pledges still standing at
 *    the claim; `payout` the bananas the claim took (null for none).
 *  - posts (not part of the file): [{ t, k: 'post', u: poster, m: mapId, c: cat, g: goal, a: stake }] for the Activity
 *    feed, the open and claimed bounties players posted with Bananas.
 *  - wanted: the automatic list ([mapId, cat, players, closestMiss]) minus the maps with an open bounty.
 * Removed bounties are dropped, as are bounties on maps the export can't show and claims by players it leaves out.
 * `catOf(mapId)` is the map's category or null; `known(uid)` whether the player is on the site.
 */
export function bountyBoard({ bounties, boards, wanted, catOf, known, now }) {
  const open = [], hall = [], posts = [];
  for (const b of bounties || []) {
    if (!b || !GOALS.has(b.goal) || !Number.isSafeInteger(b.map)) continue;
    const board = boards.get(b.map);
    const cat = board?.cat ?? catOf(b.map);
    if (!cat) continue;
    if (b.status === 'open') {
      const misses = board ? Math.min(...board.entries.map(e => e[S.MISS + 1])) : null;
      const target = b.goal === 'snipe' && known(osuId(b.target)) ? b.target : null;
      open.push([b.map, cat, b.goal, time(b.posted), board?.entries.length ?? 0, misses, target,
        (b.pledges || []).map(p => pledgeRow(p, now)).filter(p => p[0]), ...bananas(b, known)]);
    } else if ((b.status === 'claimed' || b.status === 'done') && b.claim && known(osuId(b.claim.user))) {
      const c = b.claim;
      const at = time(c.at);
      const prizes = (b.pledges || []).map(p => pledgeRow(p, at ?? now)).filter(p => p[0] && !p[4]).map(p => p.slice(0, 3));
      // The bot writes "NM" for nomod; the site reads "" as nomod.
      hall.push([b.map, cat, b.goal, b.status, c.user, at, text(c.mods)?.replace(/^NM$/, '') ?? '', round(c.acc), Number.isSafeInteger(c.combo) ? c.combo : null,
        round(c.pp, 1), prizes, Number.isSafeInteger(c.payout) && c.payout > 0 ? c.payout : null]);
    }
    const [, , , poster, , , stake] = bananas(b, known);
    if (poster && stake && (b.status === 'open' || b.status === 'claimed') && time(b.posted)) posts.push({ t: time(b.posted), k: 'post', u: poster, m: b.map, c: cat, g: b.goal, a: stake });
  }
  open.sort((a, b) => (b[3] ?? 0) - (a[3] ?? 0) || a[0] - b[0]);
  hall.sort((a, b) => (b[5] ?? 0) - (a[5] ?? 0) || a[0] - b[0]);
  const posted = new Set(open.map(r => r[0]));
  return { file: { open, hall, wanted: wanted.filter(r => !posted.has(r[0])) }, posts };
}
