// The community's own voice, as assets/js/core/lore.js has it: the parts the new client's pages show. That file is
// browser code (it imports core/i18n.js), so its texts are here as functions of the Ctx, with the same English, which
// pt.js translates. Keep the two in step until the old pages that read lore.js are gone.

import type { Ctx } from '../kernel/ctx.ts';
import { M } from '../kernel/model.ts';
import type { MapMeta } from './maps.ts';

/**
 * Portugal at the Catch World Cup (CWC) and its 4-digit edition (4CWC), as remembered on the Discord: [year, title,
 * text]. Pieced together from chat: check results against the official brackets before relying on them.
 */
export const teamTimeline = ({ t }: Ctx): [number, string, string][] => [
  [2018, 'CWC 2018', t('Portugal’s first World Cup. A group with the Netherlands, the USA and Argentina: 0-4, 1-4, 1-4. "We do it for fun."')],
  [2019, 'AxS 2019', t('A Portuguese team in the AxS tournament, kept forever in its own channel "for history purposes".')],
  [2020, 'Sightread 2020', t('Team RonaldoSoccer64. 37th on weighted pp, five places short of the 32-team cut.')],
  [2021, '3 Digit World Cup', t('Unseeded and getting FCs anyway. Took games off Brazil and played Belgium in the losers’ bracket.')],
  [2022, 'CWC 2022', t('A round of 16 against Finland.')],
  [2022, '4CWC 2022', t('Top 16, beating the 25–32 prediction. A tiebreaker against Malaysia and a win over Australia.')],
  [2024, '4CWC 2024', t('Beat Poland in a tiebreaker, then lost one to Chile.')],
  [2025, 'CWC 2025', t('40th in the qualifiers. Bulgaria was 41st. WE BEAT 41.')],
  [2025, '4CWC 2025', t('Tryouts held, team announced, and then the organisers cancelled the tournament (18 October).')],
  [2026, 'CWC 2026', t('Seeded 25th. On 14 June, the first series win in Portugal’s CWC history. Out in the losers’ bracket quarter-final against South Korea.')],
  [2026, '4CWC 2026', t('Top of the qualifier averages on NM1, NM2, NM3 and HD1, then a round of 32 against the United Kingdom.')],
];

/** The yearly "Top 10 PT Catch Players" forum threads: [year, address]. */
export const TOP10_THREADS: readonly (readonly [number, string])[] = [
  [2022, 'https://osu.ppy.sh/community/forums/topics/1692581'],
  [2024, 'https://osu.ppy.sh/community/forums/topics/2015344'],
  [2025, 'https://osu.ppy.sh/community/forums/topics/2172025'],
];

/** A random item; `seed` makes the pick stable (one quip per event that doesn't change on every redraw). */
export function pick<T>(list: readonly T[], seed?: string | number): T {
  if (seed === undefined) return list[Math.floor(Math.random() * list.length)];
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return list[h % list.length];
}

/** The line under "Page not found", one at random. */
export const notFoundQuips = ({ t }: Ctx): string[] => [
  t('It’s probably been in qualified since 2018.'),
  t('Reverse choke: everything was going fine and we died right at the end.'),
  t('Like Shin, the last Dan: nobody has made it here.'),
];

/** The footer's line, one at random per visit. */
export const footerQuips = ({ t }: Ctx): string[] => [
  t('Catching fruit since 2018.'),
  t('trisKappa: everything on this site is a joke, except your misses.'),
  t('No Alphonses were harmed in the making of this site.'),
  t('Bad scores are most appreciated :)'),
];

/** The few lines under activity events (ui/events.ts quip()): each tied to a real in-joke or a rare moment. */
export const quips = ({ t }: Ctx) => ({
  trisAcc: [t('TrisAcc: an FC is an FC.')],
  noRealSnipe: t('That’s not a real snipe (NF).'),
  christmas: t('An early Christmas present.'),
  throne: t('The throne wobbles.'),
});

/** Dan role lore, shown under each role on the Dan tab, by role. `empty` replaces the text while nobody has the role. */
export const danRoleLore = ({ t }: Ctx): Record<string, { text: string; empty?: string }> => ({
  'Dan Skrub': { text: t('The bottom rung, as in “back to Skrub”.') },
  'Dan Intermed': { text: t('Back in 2018, this one came with the right to add a custom emoji to the server.') },
  'Dan Expert': { text: t('Where the Dan course stops being polite.') },
  'Dan Beast': { text: t('For the beasts.'), empty: t('Beast: still vacant.') },
  'PT Best Player': { text: t('The top title.'), empty: t('The joke top title nobody has reached. Yet.') },
});

/** A map with a story: its card's title and text, and whether it's a Portuguese song or meme map ("tuga certified"). */
export interface MapLore {
  title: string;
  /** The card's text, from the diff's Portuguese board: `n` players, `top` the best play's pp. */
  text(n: number, top: number): string;
  tuga?: boolean;
}

/** Maps with a story (lore.js MAP_LORE). `match` gets the map's tuple; the first hit wins. */
const mapStories = ({ t, fmt }: Ctx): (MapLore & { match(m: NonNullable<MapMeta>): boolean })[] => [
  {
    match: m => /everything will freeze/i.test(m[M.TITLE]) && /undead corporation/i.test(m[M.ARTIST]),
    title: t('The eternal grind'),
    text: n => t('Everything Will Freeze: retry-spammed by every era of PT-CTB since 2018. {n} Portuguese players on this diff alone.', { n: fmt.num(n) }),
  },
  {
    match: m => /eu estou aqui/i.test(m[M.TITLE]) && /anjos/i.test(m[M.ARTIST]),
    title: t('Eu estou aqui… are you?'), // PT text (intentional): the song title
    text: (n, top) => `${t('A Portuguese pop song turned meme map, and {n} Portuguese players have been here.', { n: fmt.num(n) })} ${top >= 100
      ? t('“Faz o 100pp do eu estou aqui”? Done: the best play on this diff is worth {pp} pp.', { pp: fmt.num(Math.round(top)) })
      : t('The 100pp play is still waiting.')}`,
    tuga: true,
  },
  {
    match: m => /quim barreiros/i.test(m[M.ARTIST]),
    title: t('A Portuguese classic, in fruit form'),
    text: () => t('Quim Barreiros on osu!catch. Of course someone mapped it.'),
    tuga: true,
  },
  {
    match: m => /ronaldo/i.test(m[M.TITLE]),
    title: t('Ronaldo, but catch'),
    text: () => t('A Portuguese meme map, with diffs named by the people who play it.'),
    tuga: true,
  },
  {
    match: m => /the big black/i.test(m[M.TITLE]),
    title: t('The benchmark'),
    text: () => t('If you FC the Big Black, you can call it a farm map.'),
  },
  {
    match: m => /image -material-/i.test(m[M.TITLE]),
    title: t('The consistency exam'),
    text: () => t('Seven minutes long, one choke away from glory. Every era measures itself against this one.'),
  },
  {
    match: m => /inferno/i.test(m[M.TITLE]) && /9mm parabellum/i.test(m[M.ARTIST]),
    title: t('Rocking out in hell'),
    text: () => t('The map behind the 2018 "FC INFERNO" retry diary. Retry #30: almost a clear.'),
  },
  {
    match: m => /der wald/i.test(m[M.TITLE]),
    title: t('Devastating, as advertised'),
    text: () => t('Good luck getting a B.'),
  },
];

/** The story of the map with this tuple, or null for most maps (and a map without details). */
export const mapLore = (ctx: Ctx, meta: MapMeta): MapLore | null =>
  (meta ? mapStories(ctx).find(l => l.match(meta)) ?? null : null);

/** The home page's "Since 2018": [year, text]. */
export const history = ({ t }: Ctx): [number, string][] => [
  [2018, t('The server opens on 29 May. The Dan bot follows on 22 June.')],
  [2021, t('Portugal gets its own leaderboards: converts in January, loved in February.')],
  [2022, t('A round of 16 at the Catch World Cup, and the Dan course comes back to life.')],
  [2025, t('40th in the CWC qualifiers. Bulgaria was 41st. WE BEAT 41.')],
  [2026, t('The first series win in Portugal’s CWC history. Alphonse wakes up again two weeks later.')],
];

/** The first Portuguese players past 10k pp: [day, name, osu! id (null when not tracked), the play that did it]. */
export const first10k = ({ t }: Ctx): [string, string, number | null, string][] => [
  ['2018-09-02', 'Buffow', 4427038, t('Oriental Blossom [Oriental] with HDHR')],
  ['2019-09-17', 'gold801', 3006672, 'Chroma - I [LACRIMA’S MAXIMUM]'],
  ['2020-04-16', 'Tris', 3821475, t('iLLness LiLin [NELLY’S GRAVITY], nomod with one miss')],
  ['2021-11-24', 'Airdown', 2788013, t('night birds [Starry Night] with HR')],
  ['2023-06-12', 'Hiroto', null, 'XIII Charlotte [Resonance]'],
];

/** Boss maps for the games' boss round (beatmapset ids), as lore.js BOSS_SETS. */
export const BOSS_SETS: readonly number[] = [158023, 41823, 432720, 502553, 406881];
/** The Portuguese bonus round: Anjos - Eu estou aqui (lore.js TUGA_SET). */
export const TUGA_SET = 958558;
