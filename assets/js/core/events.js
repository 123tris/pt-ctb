// How activity events read (home page and the activity page share this).

import { html } from './html.js';
import { S, MOD, DAN_STAGES } from './model.js';
import { catChip, CAT_LABEL, mapLabel, modsBadges, ppText, playerName } from './ui.js';
import { QUIPS, THRONE_PLAYER, pick } from './lore.js';
import * as fmt from './fmt.js';

/** "Zeroth Dan", "7th Dan", "Aleph". */
export const danName = i => (i === 0 ? 'Zeroth Dan' : i <= 10 ? `${fmt.ordinal(i)} Dan` : DAN_STAGES[i].key);

export const EVENT_KINDS = {
  snipe: { tag: '#1 sniped', label: 'Snipes' },
  top: { tag: 'Top play', label: 'Top plays' },
  dan: { tag: 'Dan', label: 'Dan' },
  pass: { tag: 'Overtake', label: 'Overtakes' },
  mile: { tag: 'Milestone', label: 'Milestones' },
  join: { tag: 'New player', label: 'New players' },
};

const who = (index, id) => html`<a href="#/player/${id}"><b>${playerName(index, id)}</b></a>`;

function describe(e, index, maps) {
  const map = e.s ? html`<a class="dim-link" href="#/map/${e.s[S.MAP]}">${mapLabel(e.s[S.MAP], maps[e.s[S.MAP]])}</a>` : '';
  switch (e.k) {
    case 'snipe':
      return { what: html`${who(index, e.u)} took the #1 from ${who(index, e.v)}`, where: map };
    case 'top':
      return {
        what: e.i === 1
          ? html`${who(index, e.u)} set a new best play in ${CAT_LABEL[e.c]}`
          : html`${who(index, e.u)} set a new ${fmt.ordinal(e.i)} best play in ${CAT_LABEL[e.c]}`,
        where: map,
      };
    case 'dan':
      return { what: html`${who(index, e.u)} passed the ${danName(e.d)}`, where: html`${fmt.acc(e.s[S.ACC])} · ${map}` };
    case 'pass': {
      const others = e.v.length > 1 ? html` and ${e.v.length - 1} more` : '';
      return {
        what: html`${who(index, e.u)} overtook ${who(index, e.v[0])}${others} in ${CAT_LABEL[e.c]}`,
        where: html`Now ${fmt.rank(e.r)} with ${fmt.pp(e.pp)} pp`,
      };
    }
    case 'mile':
      return { what: html`${who(index, e.u)} reached ${fmt.num(e.pp)} pp in ${CAT_LABEL[e.c]}`, where: '' };
    case 'join':
      return { what: html`${who(index, e.u)} joined the leaderboards`, where: '' };
    default:
      return { what: '', where: '' };
  }
}

/**
 * The Discord's reaction to an event, in its own words, only for the few moments that have a real in-joke (a no-fail
 * "snipe", Tris losing a #1, Christmas, a TrisAcc FC). Most events have none: one joke lands, a joke on every line is
 * wallpaper (DESIGN.md §12). Stable per event, so it doesn't change on redraw.
 */
function quip(e) {
  const seed = `${e.k}:${e.u}:${e.t}`;
  const date = new Date(e.t * 1000);
  switch (e.k) {
    case 'snipe':
      if (e.s[S.MODS] & MOD.NF) return QUIPS.noRealSnipe;
      if (e.v === THRONE_PLAYER) return QUIPS.throne;
      if (date.getUTCMonth() === 11 && (date.getUTCDate() === 24 || date.getUTCDate() === 25)) return QUIPS.christmas;
      return null;
    case 'top':
      return e.s[S.MISS] === 0 && e.s[S.GRADE] === 'A' ? pick(QUIPS.trisAcc, seed) : null;
    default:
      return null;
  }
}

export function eventItem(e, index, maps) {
  const { what, where } = describe(e, index, maps);
  const line = quip(e);
  const play = e.s && (e.k === 'snipe' || e.k === 'top')
    ? html`<div class="event-play">${catChip(e.c)} ${modsBadges(e.s[S.MODS])} ${ppText(e.s[S.PP])}</div>`
    : '';
  return html`<div class="event ev-${e.k}">
    <div class="event-head">
      <span class="event-kind">${EVENT_KINDS[e.k]?.tag}</span>
      <span title="${fmt.dateTime(e.t)}">${fmt.ago(e.t)}</span>
    </div>
    <div class="what">${what}</div>
    ${where ? html`<div class="where">${where}</div>` : ''}
    ${play}
    ${line ? html`<div class="quip">${line}</div>` : ''}
  </div>`;
}
