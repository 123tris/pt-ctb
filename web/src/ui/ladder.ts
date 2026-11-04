// The Dan course's 19 glyphs (0 to 10, then Aleph to Shin) as the site's own mark, as assets/js/core/ladder.js draws
// them: the home page's ladder and a profile's "jersey number". A player's passes are the core pack's `dan` column, bit
// i for stage i.

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

/** How many players have passed each stage, by stage index. */
export function passCounts(players: Players): number[] {
  const counts = DAN_STAGES.map(() => 0);
  for (let row = 0; row < players.rows; row++) {
    for (let mask = players.dan[row], i = 0; mask; mask >>>= 1, i++) if (mask & 1) counts[i]++;
  }
  return counts;
}

/** The index of the highest stage anyone has passed, or -1. */
export const topStage = (counts: readonly number[]): number => counts.findLastIndex(n => n > 0);

/**
 * The ladder: every stage's glyph, lit once someone in Portugal has passed it, with how many have. `mine` is the
 * highest stage of whoever is signed in (-1 for nobody), which gets a mark under it.
 */
export function ladderBand(ctx: Ctx, counts: readonly number[], { mine = -1 } = {}): Safe {
  const { t, fmt } = ctx;
  const top = topStage(counts);
  const passed = counts.filter(Boolean).length;
  const vars = { passed: fmt.num(passed), total: fmt.num(DAN_STAGES.length), dan: top >= 0 ? danName(ctx, top) : '' };
  const label = top >= 0 ? t('The Dan course: {passed} of {total} stages passed in Portugal, the highest being the {dan}', vars)
    : t('The Dan course: {passed} of {total} stages passed in Portugal', vars);
  return html`<a class="ladder" href="/challenges/dan" aria-label="${label}">
    <ol class="ladder-rungs">${DAN_STAGES.map(({ index: i, glyph }) => html`<li class="rung${i > 10 ? ' rung-he' : ''}${counts[i] ? ' lit' : ''}${i === top ? ' top' : ''}${i === mine ? ' mine' : ''}"
      title="${danName(ctx, i)}: ${counts[i] ? t('passed by {players}', { players: fmt.plural(counts[i], 'player') }) : t('nobody yet')}${i === mine ? ` ${t('(your highest)')}` : ''}">
      <span class="rung-glyph">${glyph}</span>
      <span class="rung-n">${counts[i] || '·'}</span>
    </li>`)}</ol>
  </a>`;
}
