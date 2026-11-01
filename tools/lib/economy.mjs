// Bananas 🍌 on the site: economy.json (wallets, pouches, recent earnings, the Records boards) and the tips for the
// Activity feed, from the bot's Economy/ folder (source.mjs loadEconomy), and unlocks.json, the badges and records the
// bot pays for (CURRENCY-DESIGN.md §3, the bot ↔ site contract §4). Pure: takes the loaded data and returns the files.
//
// The bot is the bank and writes every amount; this only shows them. Its wallets.json and ledger.jsonl carry osu! ids
// only (no Discord ids, by the contract), and even so every row below is built field by field: a ledger line's `ref`
// (an idempotency key that can hold any id) and `id` never leave, and only players on the site are shown.

import { S, CATS } from '../../assets/js/core/model.js';

/** Ledger kinds that count towards the 1,000 earned (the gate), as the contract lists them. */
export const EARNED = new Set([
  'daily.play', 'daily.game', 'snipe', 'hill.take',
  'fc.first', 'pass.first', 'hill.crown', 'hill.title', 'motw.play', 'motw.top', 'vote', 'dan', 'badge', 'record', 'bounty.claim',
]);
/** Ledger kinds whose bananas are gone for good: the posting fee and the shop. (Expiry's 30% never reaches a ledger.) */
const BURNED = new Set(['bounty.fee', 'shop']);
const RECENT = 8; // ledger lines per player on economy.json
const BOARD = 10;

const lisbonMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit' });
const monthOf = t => lisbonMonth.format(new Date(t * 1000)).slice(0, 7);
const time = iso => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};
const int = v => (Number.isSafeInteger(v) ? v : 0);
const note = v => (typeof v === 'string' && v.trim() ? v.replace(/[\p{C}]/gu, '').trim().slice(0, 80) : null);
const top = (totals, n = BOARD) => [...totals].filter(([, v]) => v[0] > 0).sort((a, b) => b[1][0] - a[1][0] || a[0] - b[0]).slice(0, n)
  .map(([id, v]) => [id, ...v]);

/**
 * economy.json and the Activity feed's tips. `economy` is { updated, wallets, ledger } or null (then no file);
 * `known(id)` whether a player is on the site.
 *  - players: { id: { b balance, p pouch, e earned, x escrow, s signed in, sh shield, t title, w repeatable this week,
 *    sg 1 when a signature play is pinned, c and cu the name colour and when it ends (only while it lasts),
 *    r recent: [[t, amount, kind, pouch, note]] newest first } }
 *  - month (Lisbon, yyyy-MM), boards: earned this month [[id, n]], hunters [[id, bananas, claims]] and generous
 *    [[id, bananas]] (tips and bounty funding sent), all time; totals: supply (wallets + pouches + escrow), wallets,
 *    pouches, escrow, signedIn, mintedMonth (earned this month) and burnedMonth (fees and the shop).
 *  - events: [{ t, k: 'tip', u: from, v: to, a: amount, n: reason }], a tip's two lines paired by their shared ref.
 */
export function economyBlock({ economy, known, now }) {
  if (!economy) return { file: null, events: [] };
  const month = monthOf(now);
  const players = {};
  for (const [key, w] of Object.entries(economy.wallets)) {
    const id = Number(key);
    if (!known(id) || !w || typeof w !== 'object') continue;
    players[id] = {
      b: int(w.balance), p: int(w.pouch), e: int(w.earned), x: int(w.escrow), s: w.signedIn ? 1 : 0, sh: w.shield ? 1 : 0,
      t: note(w.title), w: int(w.weekRepeatable), ...shopState(w, now), r: [],
    };
  }

  const earnedMonth = new Map(), hunters = new Map(), generous = new Map();
  const add = (map, id, n, count = 0) => { const v = map.get(id) ?? [0, 0]; map.set(id, [v[0] + n, v[1] + count]); };
  let mintedMonth = 0, burnedMonth = 0;
  const tipsOut = new Map(), tipsIn = new Map();
  for (const line of economy.ledger) {
    const t = time(line?.t);
    const id = line?.user;
    const amount = int(line?.amount);
    if (t === null || !Number.isSafeInteger(id) || typeof line.kind !== 'string') continue;
    const thisMonth = monthOf(t) === month;
    if (EARNED.has(line.kind) && amount > 0 && thisMonth) mintedMonth += amount;
    if (BURNED.has(line.kind) && thisMonth) burnedMonth -= amount;
    if (line.kind === 'tip.out' && typeof line.ref === 'string') tipsOut.set(line.ref, { t, id, amount: -amount, note: note(line.note) });
    if (line.kind === 'tip.in' && typeof line.ref === 'string') tipsIn.set(line.ref, id);
    if (!players[id]) continue;
    if (EARNED.has(line.kind) && amount > 0 && thisMonth) add(earnedMonth, id, amount);
    if (line.kind === 'bounty.claim' && amount > 0) add(hunters, id, amount, 1);
    if ((line.kind === 'tip.out' || line.kind === 'bounty.fund') && amount < 0) add(generous, id, -amount);
    players[id].r.push([t, amount, line.kind, line.pouch ? 1 : 0, ['adjust', 'reverse', 'tip.out', 'tip.in'].includes(line.kind) ? note(line.note) : null]);
  }
  for (const p of Object.values(players)) p.r = p.r.sort((a, b) => b[0] - a[0]).slice(0, RECENT);

  const events = [];
  for (const [ref, out] of tipsOut) {
    const to = tipsIn.get(ref);
    if (to !== undefined && players[out.id] && players[to] && out.amount > 0) events.push({ t: out.t, k: 'tip', u: out.id, v: to, a: out.amount, ...(out.note ? { n: out.note } : {}) });
  }

  const sum = key => Object.values(players).reduce((n, p) => n + p[key], 0);
  const file = {
    updated: time(economy.updated) ?? now,
    players,
    month,
    boards: {
      earned: top(new Map([...earnedMonth].map(([id, v]) => [id, [v[0]]]))),
      hunters: top(hunters),
      generous: top(new Map([...generous].map(([id, v]) => [id, [v[0]]]))),
    },
    totals: {
      supply: sum('b') + sum('p') + sum('x'), wallets: sum('b'), pouches: sum('p'), escrow: sum('x'),
      signedIn: Object.values(players).filter(p => p.s).length, mintedMonth, burnedMonth,
    },
  };
  return { file, events };
}

/** What the shop shows as already yours: a pinned signature play, and a name colour while it lasts. */
function shopState(w, now) {
  const until = time(w.colourUntil);
  const colour = typeof w.colour === 'string' && /^[a-z]{1,12}$/.test(w.colour) && until > now ? w.colour : null;
  return { sg: Number.isSafeInteger(w.signature) && w.signature > 0 ? 1 : 0, c: colour, cu: colour ? until : null };
}

const iso = t => new Date(t * 1000).toISOString().replace('.000Z', 'Z');

/** The site records a single play holds: [key, [userId, category, ...play] row from records.json]. */
function recordRows(records) {
  return [
    ...CATS.map(cat => [`topPlay.${cat}`, records.topPlay?.[cat]]),
    ...CATS.map(cat => [`hardest.${cat}`, records.hardest?.[cat]]),
    ['topCombo', records.topCombo], ['longest', records.longest], ['hardFc', records.hard?.fc], ['highestChoke', records.highestChoke],
  ].filter(([, row]) => row);
}

/**
 * unlocks.json: [{ osuId, kind: 'badge'|'record', key, date }], what every player on the site holds now. A record's date
 * is when its play was set. A badge's is when an export first saw it (`seen`, kept in the exporter's state); the badges
 * already held when unlocks were first tracked get 1970-01-01, so the bot (which ignores unlocks from before its launch,
 * the launch grant covers those) never pays them. The bot pays each kind:key:osuId once.
 * `badges` is [[osuId, [badgeKey]]]. Returns { file, seen }.
 */
export function unlocks({ badges, records, seen: previous, now }) {
  const first = previous === undefined || previous === null;
  const seen = { ...(previous || {}) };
  const out = [];
  for (const [id, keys] of badges) {
    for (const key of new Set(keys.filter(Boolean))) {
      const name = `${key}:${id}`;
      seen[name] ??= first ? 0 : now;
      out.push({ osuId: id, kind: 'badge', key, date: iso(seen[name]) });
    }
  }
  for (const [key, row] of recordRows(records)) out.push({ osuId: row[0], kind: 'record', key, date: iso(row[S.TIME + 2]) });
  out.sort((a, b) => a.date.localeCompare(b.date) || a.osuId - b.osuId || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
  return { file: out, seen };
}
