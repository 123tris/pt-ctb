// The community's own voice, as assets/js/core/lore.js has it: the parts the new client's pages show. That file is
// browser code (it imports core/i18n.js), so its texts are here as functions of the Ctx, with the same English, which
// pt.js translates. Keep the two in step until the old pages that read lore.js are gone.

import type { Ctx } from '../kernel/ctx.ts';

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
