// The Dan course's 19 glyphs (0 to 10, then Aleph to Shin) as the site's own mark: the ladder on the home page and
// the "jersey number" on a profile. The loader that climbs them lives in ui.js (climber).

import { html } from './html.js';
import { DAN_STAGES } from './model.js';
import { danName } from './events.js';
import * as fmt from './fmt.js';
import { t } from './i18n.js';

/** How many players have passed each stage, by stage index (players.json `dan` lists the stages a player passed). */
export function passCounts(players) {
  const counts = DAN_STAGES.map(() => 0);
  for (const p of players) for (const i of p.dan ?? []) counts[i]++;
  return counts;
}

/** The highest stage a player has passed, or -1. */
export const highestDan = p => (p?.dan?.length ? Math.max(...p.dan) : -1);

/** The index of the highest stage anyone has passed, or -1. */
export const topStage = counts => counts.findLastIndex(n => n > 0);

/**
 * The ladder: every stage's glyph, lit once someone in Portugal has passed it, with how many have. `mine` is the
 * highest stage of whoever this browser marked "This is me" (-1 for nobody), which gets a mark under it.
 */
export function ladderBand(counts, { mine = -1 } = {}) {
  const top = topStage(counts);
  const passed = counts.filter(Boolean).length;
  const vars = { passed: fmt.num(passed), total: fmt.num(DAN_STAGES.length), dan: top >= 0 ? danName(top) : '' };
  const label = top >= 0 ? t('The Dan course: {passed} of {total} stages passed in Portugal, the highest being the {dan}', vars)
    : t('The Dan course: {passed} of {total} stages passed in Portugal', vars);
  return html`<a class="ladder" href="#/challenges/dan" aria-label="${label}">
    <ol class="ladder-rungs">${DAN_STAGES.map(({ index: i, glyph }) => html`<li class="rung${i > 10 ? ' rung-he' : ''}${counts[i] ? ' lit' : ''}${i === top ? ' top' : ''}${i === mine ? ' mine' : ''}"
      title="${danName(i)}: ${counts[i] ? t('passed by {players}', { players: fmt.plural(counts[i], 'player') }) : t('nobody yet')}${i === mine ? ` ${t('(your highest)')}` : ''}">
      <span class="rung-glyph">${glyph}</span>
      <span class="rung-n">${counts[i] || '·'}</span>
    </li>`)}</ol>
  </a>`;
}

/** A profile's highest Dan as a big outlined numeral, like the number on a shirt; nothing for players with no pass. */
export function jersey(p) {
  const i = highestDan(p);
  if (i < 0) return '';
  return html`<a class="jersey${i > 10 ? ' jersey-he' : ''}" href="#/challenges/dan?stage=${i}" title="${t('Highest Dan passed: {dan}', { dan: danName(i) })}">
    <span class="jersey-glyph" aria-hidden="true">${DAN_STAGES[i].glyph}</span>
    <span class="jersey-label">${danName(i)}</span>
  </a>`;
}
