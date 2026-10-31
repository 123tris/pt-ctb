// The bounty board's pieces shared by the Bounties tab (pages/challenges.js) and the map page: a bounty's goal line and
// its prizes. Rows come from bounties.json (tools/lib/bounties.mjs).

import { html } from './html.js';
import { MOD } from './model.js';
import { playerLink, modsBadges } from './ui.js';
import * as fmt from './fmt.js';
import { t, th } from './i18n.js';

/** A goal's short name, for the hall of fame. */
export const GOAL_LABEL = { fc: t('Full combo'), pass: t('First pass'), snipe: t('Snipe') };

/** What the bounty asks for, as a dare: "Nobody’s FC’d this. Yet." or "Take {holder}’s #1." with the holder linked. */
export function goalLine(goal, target, index) {
  if (goal === 'fc') return html`<span class="bounty-tag">${t('Nobody’s FC’d this. Yet.')}</span>`;
  if (goal === 'pass') return html`<span class="bounty-tag">${t('Nobody’s passed this. Yet.')}</span>`;
  return html`<span class="bounty-tag">${target ? th('Take {holder}’s #1.', { holder: playerLink(target, index, 'avatar-sm') }) : t('Take the #1.')}</span>`;
}

/**
 * The prizes ([prize, by, byOsu, until, lapsed] pledges, or [prize, by, byOsu] for a claimed bounty's) as tags. A lapsed
 * pledge stays, struck through, so the board shows what was offered.
 */
export function prizeTags(pledges) {
  if (!pledges.length) return '';
  return html`<span class="prizes">${pledges.map(([prize, by, , until, lapsed]) => {
    const tip = lapsed ? t('Offer ended {date}', { date: fmt.date(until) }) : until ? t('Offered until {date}', { date: fmt.date(until) }) : '';
    return html`<span class="prize ${lapsed ? 'prize-lapsed' : ''}" title="${tip}">${by ? t('{prize} · from {by}', { prize, by }) : prize}${lapsed ? html`<span class="sr-only"> (${t('offer ended')})</span>` : ''}</span>`;
  })}</span>`;
}

/** A claim's mods ("HDHR", "" for nomod) as the mod badges plays show; none for nomod, as in scoreStats(). */
export function claimMods(text) {
  const mask = (text.match(/.{2}/g) ?? []).reduce((m, name) => m | (MOD[name] ?? 0), 0);
  return mask ? modsBadges(mask) : '';
}
