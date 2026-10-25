// The community's own voice: in-jokes, catchphrases and history from the PT-CTB Discord, used as copy around the
// site. Everything here is hand-written; edit freely. Portuguese appears only where the joke needs it.

import { M } from './model.js';

/** Tris: the player the records page dares everyone to snipe (he keeps asking for it). Matches build.mjs. */
export const THRONE_PLAYER = 3821475;

/** The last time osu!catch pp changed for real (the formula model.js implements). */
export const LAST_REWORK = Date.UTC(2025, 9, 29) / 1000;

/**
 * Legends: players who were in Portugal's top 5 at some point. They get the "legend" tag only while they're inactive
 * (inactive on osu!, or no play stored in over a year); every other inactive player gets the plain "inactive" one. To
 * add someone, add their osu! user id (the number in their osu! profile's address) with their name and when.
 */
export const LEGENDS = new Map([
  [2788013, 'Airdown'],
  [4427038, 'Buffow'],
  [6502093, 'PTrollYO'],
  [1267642, 'SoulEater, #1 in Portugal in 2014'],
]);

/** A random item; `seed` makes the pick stable (e.g. one quip per event that doesn't change on every redraw). */
export function pick(list, seed) {
  if (seed === undefined) return list[Math.floor(Math.random() * list.length)];
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return list[h % list.length];
}

export const LOADING = [
  'Derusting…',
  'Catching fruit…',
  'Counting misses…',
  'Waking up Alphonse…',
  'Loading copium…',
  'Recalculating the rework (again)…',
  'Farming pp for you…',
  'Reading low AR HD… this may take a while.',
  'Looking for that one miss…',
  'Retry #30: almost a clear with a 400x combo.',
  'Everything will freeze. The site won’t.',
  'Asking peppy to fix CTB star rating…',
  'Ainda há muita sopa para comer…', // PT text (intentional): "still plenty of soup to eat", i.e. lots of growing to do
];

export const NOT_FOUND = [
  'It’s probably been in qualified since 2018.',
  'Reverse choke: everything was going fine and we died right at the end.',
  'Is water soup? We don’t know. This page doesn’t exist either.',
];

export const FOOTER = [
  'Catching fruit since 2018.',
  'trisKappa: everything on this site is a joke, except your misses.',
  'No Alphonses were harmed in the making of this site.',
  'Bad scores are most appreciated :)',
];

/** Short lines under activity events, by kind. A function gets the event and returns a line or null. */
export const QUIPS = {
  snipe: ['Hey bro, you just got sniped. What u gonna do, huh?', 'Sniped. Respect.', 'The #1 changes hands.'],
  topFirst: ['NEW TOP PLAY 🔥'],
  oneMiss: ['The 1-miss gods have blessed you.'],
  trisAcc: ['TrisAcc: an FC is an FC.'],
  noRealSnipe: 'That’s not a real snipe (NF).',
  christmas: 'An early Christmas present.',
  throne: 'The throne wobbles.',
  mile: ['Another thousand. Respect.'],
  join: ['Welcome! Bad scores are most appreciated :)'],
};

/** Dan role lore, shown under each role on the Dan page. `empty` replaces the text while nobody has the role. */
export const DAN_ROLE_LORE = {
  'Dan Skrub': { text: 'If you’re above Skrub, you hack.' },
  'Dan Intermed': { text: 'Back in 2018, this one came with the right to add a custom emoji to the server.' },
  'Dan Expert': { text: 'Where the Dan course stops being polite.' },
  'Dan Beast': { text: 'For the beasts.', empty: 'Beast: still vacant.' },
  'PT Best Player': { text: 'The top title.', empty: 'The joke top title nobody has reached. Yet.' },
};

/** Maps with a story. `match` gets the map's meta tuple; the first hit wins. */
export const MAP_LORE = [
  {
    match: m => /everything will freeze/i.test(m[M.TITLE]) && /undead corporation/i.test(m[M.ARTIST]),
    title: 'The eternal grind',
    text: n => `Everything Will Freeze: retry-spammed by every era of PT-CTB since 2018. ${n} Portuguese players on this diff alone.`,
  },
  {
    match: m => /eu estou aqui/i.test(m[M.TITLE]) && /anjos/i.test(m[M.ARTIST]),
    title: 'Eu estou aqui… are you?', // PT text (intentional): the song title
    text: (n, top) => `A Portuguese pop song turned meme map, and ${n} Portuguese players have been here. ${top >= 100
      ? `“Faz o 100pp do eu estou aqui”? Done: the best play on this diff is worth ${Math.round(top)} pp.`
      : 'The 100pp play is still waiting.'}`,
    tuga: true,
  },
  {
    match: m => /quim barreiros/i.test(m[M.ARTIST]),
    title: 'A Portuguese classic, in fruit form',
    text: () => 'Quim Barreiros on osu!catch. Of course someone mapped it.',
    tuga: true,
  },
  {
    match: m => /ronaldo/i.test(m[M.TITLE]),
    title: 'Ronaldo, but catch',
    text: () => 'A Portuguese meme map, with diffs named by the people who play it.',
    tuga: true,
  },
  {
    match: m => /the big black/i.test(m[M.TITLE]),
    title: 'The benchmark',
    text: () => 'If you FC the Big Black, you can call it a farm map.',
  },
  {
    match: m => /image -material-/i.test(m[M.TITLE]),
    title: 'The consistency exam',
    text: () => 'Seven minutes long, one choke away from glory. Every era measures itself against this one.',
  },
  {
    match: m => /inferno/i.test(m[M.TITLE]) && /9mm parabellum/i.test(m[M.ARTIST]),
    title: 'Rocking out in hell',
    text: () => 'The map behind the 2018 "FC INFERNO" retry diary. Retry #30: almost a clear.',
  },
  {
    match: m => /der wald/i.test(m[M.TITLE]),
    title: 'Devastating, as advertised',
    text: () => 'Good luck getting a B.',
  },
];

export const mapLore = meta => (meta ? MAP_LORE.find(l => l.match(meta)) ?? null : null);

/** Boss maps for the games' boss round (beatmapset ids). */
export const BOSS_SETS = [158023, 41823, 432720, 502553, 406881];
/** The Portuguese bonus round: Anjos - Eu estou aqui. */
export const TUGA_SET = 958558;

/** Calculator presets. */
export const CALC_PRESETS = [
  [2311555, 'Eu estou aqui'],
  [553131, 'Everything Will Freeze'],
  [933017, 'Image Material'],
];

/** Compare presets: rivalries the Discord has argued about for years. */
export const RIVALRIES = [
  [3821475, 3006672, 'The spinner war'],
  [6205809, 7385703, 'Who’s the better HD player?'],
  [4095868, 6205809, 'The official Yoxide snipe'],
];

/**
 * Portugal at the Catch World Cup (CWC) and its 4-digit edition (4CWC), as remembered on the Discord. Pieced
 * together from chat: check results against the official brackets before relying on them.
 */
export const TEAM_TIMELINE = [
  [2018, 'CWC 2018', 'Portugal’s first World Cup. A group with the Netherlands, the USA and Argentina: 0-4, 1-4, 1-4. "We do it for fun."'],
  [2019, 'AxS 2019', 'A Portuguese team in the AxS tournament, kept forever in its own channel "for history purposes".'],
  [2020, 'Sightread 2020', 'Team RonaldoSoccer64. 37th on weighted pp, five places short of the 32-team cut.'],
  [2021, '3 Digit World Cup', 'Unseeded and getting FCs anyway. Took games off Brazil and played Belgium in the losers’ bracket.'],
  [2022, 'CWC 2022', 'A round of 16 against Finland.'],
  [2022, '4CWC 2022', 'Top 16, beating the 25–32 prediction. A tiebreaker against Malaysia and a win over Australia.'],
  [2024, '4CWC 2024', 'Beat Poland in a tiebreaker, then lost one to Chile.'],
  [2025, 'CWC 2025', '40th in the qualifiers. Bulgaria was 41st. WE BEAT 41.'],
  [2025, '4CWC 2025', 'Tryouts held, team announced, and then the organisers cancelled the tournament (18 October).'],
  [2026, 'CWC 2026', 'Seeded 25th. On 14 June, the first series win in Portugal’s CWC history. Out in the losers’ bracket quarter-final against South Korea.'],
  [2026, '4CWC 2026', 'Top of the qualifier averages on NM1, NM2, NM3 and HD1, then a round of 32 against the United Kingdom.'],
];

/** The first Portuguese players past 10,000 pp, and the play that took them there (a 2023 community post). */
export const FIRST_10K = [
  ['2018-09-02', 'Buffow', 4427038, 'Oriental Blossom [Oriental] with HDHR'],
  ['2019-09-17', 'gold801', 3006672, 'Chroma - I [LACRIMA’S MAXIMUM]'],
  ['2020-04-16', 'Tris', 3821475, 'iLLness LiLin [NELLY’S GRAVITY], nomod with one miss'],
  ['2021-11-24', 'Airdown', 2788013, 'night birds [Starry Night] with HR'],
  ['2023-06-12', 'Hiroto', null, 'XIII Charlotte [Resonance]'],
];

/** The yearly "Top 10 PT Catch Players" forum threads. */
export const TOP10_THREADS = [
  [2022, 'https://osu.ppy.sh/community/forums/topics/1692581'],
  [2024, 'https://osu.ppy.sh/community/forums/topics/2015344'],
  [2025, 'https://osu.ppy.sh/community/forums/topics/2172025'],
];
