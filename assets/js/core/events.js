// How activity events read (home page and the activity page share this).

import { html } from './html.js';
import { S, MOD, DAN_STAGES } from './model.js';
import { catChip, CAT_LABEL, mapLabel, modsBadges, ppText, playerName } from './ui.js';
import { QUIPS, THRONE_PLAYER, pick } from './lore.js';
import * as fmt from './fmt.js';
import { t, th } from './i18n.js';

/** "Zeroth Dan", "7th Dan", "Aleph". */
export const danName = i => (i === 0 ? t('Zeroth Dan') : i <= 10 ? t('{nth} Dan', { nth: fmt.ordinal(i) }) : DAN_STAGES[i].key);

export const EVENT_KINDS = {
  snipe: { tag: t('#1 sniped'), label: t('Snipes') },
  top: { tag: t('Top play'), label: t('Top plays') },
  dan: { tag: 'Dan', label: 'Dan' },
  pass: { tag: t('Overtake'), label: t('Overtakes') },
  mile: { tag: t('Milestone'), label: t('Milestones') },
  join: { tag: t('New player'), label: t('New players') },
};

const who = (index, id) => html`<a href="#/player/${id}"><b>${playerName(index, id)}</b></a>`;

function describe(e, index, maps) {
  const map = e.s ? html`<a class="dim-link" href="#/map/${e.s[S.MAP]}">${mapLabel(e.s[S.MAP], maps[e.s[S.MAP]])}</a>` : '';
  switch (e.k) {
    case 'snipe':
      return { what: th('{who} took the #1 from {other}', { who: who(index, e.u), other: who(index, e.v) }), where: map };
    case 'top':
      return {
        what: e.i === 1
          ? th('{who} set a new best play in {cat}', { who: who(index, e.u), cat: CAT_LABEL[e.c] })
          : th('{who} set a new {nth} best play in {cat}', { who: who(index, e.u), nth: fmt.ordinal(e.i, { feminine: true }), cat: CAT_LABEL[e.c] }),
        where: map,
      };
    case 'dan':
      return { what: th('{who} passed the {dan}', { who: who(index, e.u), dan: danName(e.d) }), where: html`${fmt.acc(e.s[S.ACC])} · ${map}` };
    case 'pass': {
      const vars = { who: who(index, e.u), other: who(index, e.v[0]), n: fmt.num(e.v.length - 1), cat: CAT_LABEL[e.c] };
      return {
        what: e.v.length > 1 ? th('{who} overtook {other} and {n} more in {cat}', vars) : th('{who} overtook {other} in {cat}', vars),
        where: t('Now {rank} with {pp} pp', { rank: fmt.rank(e.r), pp: fmt.pp(e.pp) }),
      };
    }
    case 'mile':
      return { what: th('{who} reached {pp} pp in {cat}', { who: who(index, e.u), pp: fmt.num(e.pp), cat: CAT_LABEL[e.c] }), where: '' };
    case 'join':
      return { what: th('{who} joined the leaderboards', { who: who(index, e.u) }), where: '' };
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
