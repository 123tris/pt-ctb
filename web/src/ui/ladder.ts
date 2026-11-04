// The Dan course's 19 glyphs (0 to 10, then Aleph to Shin) as the site's own mark, as assets/js/core/ladder.js draws
// them. So far the profile's "jersey number"; the home page's ladder will join it. A player's passes are the core
// pack's `dan` column, bit i for stage i.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { DAN_STAGES } from '../kernel/model.ts';
import type { Players } from './players.ts';
import { danName } from './events.ts';

/** The highest stage a player has passed, or -1. */
export const highestDan = (players: Players, row: number): number => 31 - Math.clz32(players.dan[row]);

/** How many stages a player has passed. */
export function danPasses(players: Players, row: number): number {
  let n = 0;
  for (let mask = players.dan[row]; mask; mask &= mask - 1) n++;
  return n;
}

/** A profile's highest Dan as a big outlined numeral, like the number on a shirt; nothing for players with no pass. */
export function jersey(ctx: Ctx, players: Players, row: number): Safe | '' {
  const i = highestDan(players, row);
  if (i < 0) return '';
  return html`<a class="jersey${i > 10 ? ' jersey-he' : ''}" href="/challenges/dan?stage=${i}" title="${ctx.t('Highest Dan passed: {dan}', { dan: danName(ctx, i) })}">
    <span class="jersey-glyph" aria-hidden="true">${DAN_STAGES[i].glyph}</span>
    <span class="jersey-label">${danName(ctx, i)}</span>
  </a>`;
}
