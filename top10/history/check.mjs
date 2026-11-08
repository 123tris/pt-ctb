// Checks the past Top 10 editions (TOP10-DESIGN.md §13.10) and the 2020 all-time thread (§13.11), and computes their
// results with the §13.5 formula, on its own (no imports), so the data can be checked before the site's score.js reads
// it.
//
//   node top10/history/check.mjs                 every file: checks, then the top 10 and the rest
//   node top10/history/check.mjs 2025            one yearly edition
//   node top10/history/check.mjs alltime         the all-time files (alltime-2020 for one)
//
// A file's `kind` is 'year' or 'alltime'; missing means 'year' (§13.11). All-time files are named alltime-<year>.json
// and have no ones to watch.
//
// The formula: a pick at position p gets 11 − p (0 below 10). A group tied at spot s with k members covers positions
// s … s+k−1, and each member gets their average. A player's score is their points ÷ the ballots that could have listed
// them: every ballot except their own. Order: score, then lists, then #1s, then the median spot (lower first), then
// honourable mentions; players still equal share the rank. Exits 1 if a file is malformed or 2025 doesn't come out as
// expected.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Current osu! usernames (November 2026), for the printout only. ALIASES.md has the evidence. */
const NAMES = {
  1267642: 'SoulEater', 1700805: 'Sp1ritGG', 2600197: '[SS]Bell', 2788013: 'Airdown', 3006672: 'gold801', 3821475: 'Tris',
  4095868: 'Nelson', 4427038: 'Buffow', 4756150: '[Dementia]', 5124924: 'Ritmo Brigido', 6205809: 'DemiGod Yoxide',
  6502093: 'PTrollYO', 6748747: 'Diamond_Storm', 7385703: 'Rosa', 7894203: 'Sakuragi FanBoy', 8724722: 'RockMitic',
  9629190: 'biji', 10067533: 'TRUE_PLAYER36', 10561635: 'Nicolexd13',
  10816573: 'Godo_Plays', 11491079: 'sagiiT', 13140949: 'held', 13294871: 'AfonsoMPt', 14917517: 'suzuhiro77 (Hiroto-)',
  15009436: 'zDelightful', 16294034: 'Patatita', 16589307: '-Abstr4ct-', 16841401: 'quistyyy', 16935754: 'ExPin',
  17076179: 'tartaruga57', 17578266: '[ Ajia ]', 18649724: 'Warp', 19423459: '_wb (GoncS)', 19829882: 'DPkF',
  19896388: 'Lulushark', 20942650: 'AlexFenom', 23114439: 'iPPC', 24642612: 'anomi', 26323728: 'Leo5h',
  29380292: 'Kufas', 30021638: 'filipex13', 31305210: 'Tyiuni', 34911317: 'oldest', 36987661: 'Luana_26',
};
const name = id => NAMES[id] ?? String(id);

/**
 * 2025 as it must come out: rank, score. TOP10-DESIGN.md §13.10 gives GoncS 6.22 (5th); that's 56 points ÷ 9, as if
 * GoncS hadn't voted. GoncS did: _wb (19423459) is GoncS's account, renamed (osu! lists GoncS as its previous name,
 * and ExPin's 2023–24 and 2025 posts link "GoncS" to it). Their own ballot comes out of the denominator, so it's
 * 56 ÷ 8 = 7.00, 4th. EXPECTED_AS_DESIGNED checks that everything else in the file matches §13.10 exactly.
 */
const EXPECTED_2025 = [
  [14917517, 1, 10.0], [24642612, 2, 8.63], [16935754, 3, 8.63], [19423459, 4, 7.0], [13294871, 5, 6.78],
  [7385703, 6, 5.56], [20942650, 7, 4.25], [6205809, 8, 3.13], [26323728, 9, 3.0], [10067533, 10, 2.25],
  [4095868, 11, 1.0],
];
const EXPECTED_AS_DESIGNED = [
  [14917517, 1, 10.0], [24642612, 2, 8.63], [16935754, 3, 8.63], [13294871, 4, 6.78], [19423459, 5, 6.22],
  [7385703, 6, 5.56], [20942650, 7, 4.25], [6205809, 8, 3.13], [26323728, 9, 3.0], [10067533, 10, 2.25],
  [4095868, 11, 1.0],
];

const POSITIONS = 10;
const MIN_BALLOTS = 5;
const kindOf = ed => ed.kind ?? 'year';
const positionPoints = p => (p >= 1 && p <= POSITIONS ? POSITIONS + 1 - p : 0);

/** The problems with one edition's file, as strings. */
function problems(file, ed) {
  const out = [];
  const say = msg => out.push(`${file}: ${msg}`);
  const isId = v => Number.isInteger(v) && v > 0;
  const extraTop = Object.keys(ed).filter(k => !['kind', 'edition', 'label', 'thread', 'ballots'].includes(k));
  if (extraTop.length) say(`unknown fields ${extraTop.join(', ')}`);
  if ('kind' in ed && !['year', 'alltime'].includes(ed.kind)) say(`kind must be 'year' or 'alltime', not ${JSON.stringify(ed.kind)}`);
  const alltime = kindOf(ed) === 'alltime';
  if (alltime !== file.startsWith('alltime-')) say(`kind '${kindOf(ed)}' doesn't match the file name`);
  if (!Number.isInteger(ed.edition)) say('edition must be an integer');
  else if (!file.endsWith(`${ed.edition}.json`)) say(`edition ${ed.edition} doesn't match the file name`);
  if (typeof ed.label !== 'string' || !ed.label) say('label missing');
  if (!/^https:\/\/osu\.ppy\.sh\/community\/forums\/topics\/\d+$/.test(ed.thread ?? '')) say(`thread isn't a topic URL: ${ed.thread}`);
  if (!Array.isArray(ed.ballots) || !ed.ballots.length) { say('no ballots'); return out; }
  const voters = new Set();
  const posts = new Set();
  for (const b of ed.ballots) {
    const who = `ballot of ${b.voter}`;
    if (!isId(b.voter)) say(`${who}: voter isn't an osu! id`);
    if (voters.has(b.voter)) say(`${who}: a second ballot from the same voter`);
    voters.add(b.voter);
    if (!/^https:\/\/osu\.ppy\.sh\/community\/forums\/posts\/\d+$/.test(b.post ?? '')) say(`${who}: post isn't a post URL`);
    if (posts.has(b.post)) say(`${who}: post used twice`);
    posts.add(b.post);
    if (!Array.isArray(b.picks) || !b.picks.length) { say(`${who}: no picks`); continue; }
    const picked = new Set();
    b.picks.forEach((p, i) => {
      if (!isId(p.id)) say(`${who}: pick ${i + 1} has no id`);
      if (picked.has(p.id)) say(`${who}: ${name(p.id)} picked twice`);
      picked.add(p.id);
      const ok = i === 0 ? p.spot === 1 : p.spot === i + 1 || p.spot === b.picks[i - 1].spot;
      if (!ok) say(`${who}: pick ${i + 1} (${name(p.id)}) has spot ${p.spot}; it must be ${i + 1}, or tie with the one above`);
    });
    if (picked.has(b.voter)) say(`${who}: votes for themselves`);
    for (const key of ['mentions', 'watch']) {
      const list = b[key];
      if (!Array.isArray(list)) { say(`${who}: ${key} must be an array`); continue; }
      if (new Set(list).size !== list.length) say(`${who}: ${key} repeats an id`);
      for (const id of list) {
        if (!isId(id)) say(`${who}: ${key} has a non-id ${id}`);
        if (picked.has(id)) say(`${who}: ${name(id)} is both a pick and in ${key}`);
        if (id === b.voter) say(`${who}: ${key} names the voter`);
      }
    }
    if (alltime && b.watch?.length) say(`${who}: an all-time ballot has no ones to watch (§13.11)`);
    if ('notes' in b && typeof b.notes !== 'string') say(`${who}: notes must be text`);
    const extra = Object.keys(b).filter(k => !['voter', 'post', 'picks', 'mentions', 'watch', 'notes'].includes(k));
    if (extra.length) say(`${who}: unknown fields ${extra.join(', ')}`);
  }
  return out;
}

const median = s => (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);

/** The §13.5 ranking of one edition's ballots. `notVoters` drops players from the "voted" set (for the design check). */
function rank(ballots, { notVoters = [] } = {}) {
  const voters = new Set(ballots.map(b => b.voter).filter(v => !notVoters.includes(v)));
  const players = new Map();
  const entry = id => {
    if (!players.has(id)) players.set(id, { id, points: 0, lists: 0, firsts: 0, spots: [], mentions: 0, watch: 0 });
    return players.get(id);
  };
  for (const b of ballots) {
    const size = new Map();
    for (const p of b.picks) size.set(p.spot, (size.get(p.spot) ?? 0) + 1);
    for (const p of b.picks) {
      const k = size.get(p.spot);
      let sum = 0;
      for (let q = p.spot; q < p.spot + k; q++) sum += positionPoints(q);
      const e = entry(p.id);
      e.points += sum / k;
      e.lists++;
      e.spots.push(p.spot);
      if (p.spot === 1) e.firsts++;
    }
    for (const id of b.mentions) entry(id).mentions++;
    for (const id of b.watch) entry(id).watch++;
  }
  const ranked = [...players.values()].filter(e => e.points > 0).map(e => {
    const eligible = ballots.length - (voters.has(e.id) ? 1 : 0);
    const spots = [...e.spots].sort((a, b) => a - b);
    return { ...e, eligible, cents: Math.round((e.points / eligible) * 100), median: median(spots), best: spots[0], worst: spots.at(-1) };
  });
  const order = (a, b) => b.cents - a.cents || b.lists - a.lists || b.firsts - a.firsts || a.median - b.median || b.mentions - a.mentions;
  ranked.sort((a, b) => order(a, b) || a.id - b.id);
  ranked.forEach((e, i) => { e.rank = i > 0 && order(ranked[i - 1], e) === 0 ? ranked[i - 1].rank : i + 1; });
  const unranked = [...players.values()].filter(e => e.points === 0 && e.lists > 0);
  return { ranked, unranked };
}

function compare(label, ranked, expected) {
  const bad = [];
  expected.forEach(([id, r, score], i) => {
    const got = ranked[i];
    if (!got || got.id !== id || got.rank !== r || got.cents !== Math.round(score * 100)) {
      bad.push(`  #${i + 1}: expected ${name(id)} rank ${r} ${score.toFixed(2)}, got ${got ? `${name(got.id)} rank ${got.rank} ${(got.cents / 100).toFixed(2)}` : 'nothing'}`);
    }
  });
  console.log(bad.length ? `✗ ${label}\n${bad.join('\n')}` : `✓ ${label}`);
  return bad.length === 0;
}

const only = process.argv[2];
const wanted = f => !only || f === `${only}.json` || (only === 'alltime' && f.startsWith('alltime-'));
// Yearly editions first, then the all-time files, each in year order.
const files = readdirSync(here).filter(f => /^(alltime-)?\d{4}\.json$/.test(f) && wanted(f))
  .sort((a, b) => a.startsWith('alltime-') - b.startsWith('alltime-') || a.localeCompare(b));
if (!files.length) { console.error(`No edition file${only ? ` for ${only}` : ''} in ${here}`); process.exit(1); }

let ok = true;
for (const file of files) {
  const ed = JSON.parse(readFileSync(join(here, file), 'utf8'));
  const issues = problems(file, ed);
  console.log(`\n=== ${kindOf(ed) === 'alltime' ? 'All-time ballot: ' : ''}${ed.label} (${file}): ${ed.ballots?.length ?? 0} ballots ===`);
  if (issues.length) { ok = false; issues.forEach(m => console.log(`✗ ${m}`)); continue; }
  if (ed.ballots.length < MIN_BALLOTS) console.log(`! Only ${ed.ballots.length} ballots: below the live minimum of ${MIN_BALLOTS} (§5); computed anyway.`);
  const { ranked, unranked } = rank(ed.ballots);
  const row = e => `${String(e.rank).padStart(3)}. ${name(e.id).padEnd(22)} ${(e.cents / 100).toFixed(2).padStart(5)}`
    + `   ${String(+e.points.toFixed(2)).padStart(5)} pts, on ${e.lists} of ${e.eligible} lists, ${e.firsts} × #1, median ${e.median}, best ${e.best}, worst ${e.worst}`
    + (e.mentions ? `, ${e.mentions} mention${e.mentions > 1 ? 's' : ''}` : '');
  ranked.filter(e => e.rank <= 10).forEach(e => console.log(row(e)));
  const rest = ranked.filter(e => e.rank > 10);
  if (rest.length) { console.log('  Also received votes:'); rest.forEach(e => console.log(row(e))); }
  if (unranked.length) console.log(`  Listed, but only below #10 (0 points): ${unranked.map(e => name(e.id)).join(', ')}`);
  const tally = key => {
    const n = new Map();
    for (const b of ed.ballots) for (const id of b[key]) n.set(id, (n.get(id) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id, c]) => `${name(id)}${c > 1 ? ` ×${c}` : ''}`).join(', ');
  };
  const m = tally('mentions');
  const w = tally('watch');
  if (m) console.log(`  Honourable mentions: ${m}`);
  if (w) console.log(`  Ones to watch: ${w}`);
  if (ed.edition === 2025 && kindOf(ed) === 'year') {
    ok = compare('2025 matches the expected ranking (GoncS as a voter)', ranked, EXPECTED_2025) && ok;
    ok = compare('2025 matches §13.10 exactly when GoncS is (wrongly) counted as a non-voter', rank(ed.ballots, { notVoters: [19423459] }).ranked, EXPECTED_AS_DESIGNED) && ok;
  }
}
process.exit(ok ? 0 : 1);
