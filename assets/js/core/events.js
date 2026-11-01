// How activity events read (home page and the activity page share this).

import { html } from './html.js';
import { S, MOD, DAN_STAGES } from './model.js';
import { catChip, CAT_LABEL, mapLabel, modsBadges, ppText, playerName, nameClass } from './ui.js';
import { QUIPS, THRONE_PLAYER, pick } from './lore.js';
import { SLOT_NAME, TIER_NAME, monthLabel } from './hill.js';
import * as fmt from './fmt.js';
import { t, th } from './i18n.js';
import { bananas, session } from './bananas.js';

/** "Zeroth Dan", "7th Dan", "Aleph". */
export const danName = i => (i === 0 ? t('Zeroth Dan') : i <= 10 ? t('{nth} Dan', { nth: fmt.ordinal(i) }) : DAN_STAGES[i].key);

export const EVENT_KINDS = {
  snipe: { tag: t('#1 sniped'), label: t('Snipes') },
  crown: { tag: t('Crown'), label: t('Crowns') },
  bounty: { tag: t('Bounty claimed'), label: t('Bounties') },
  post: { tag: t('Bounty posted'), label: t('New bounties') },
  tip: { tag: t('Tip'), label: t('Tips') },
  top: { tag: t('Top play'), label: t('Top plays') },
  dan: { tag: 'Dan', label: 'Dan' },
  pass: { tag: t('Overtake'), label: t('Overtakes') },
  mile: { tag: t('Milestone'), label: t('Milestones') },
  join: { tag: t('New player'), label: t('New players') },
};

const who = (index, id) => html`<a href="#/player/${id}"><b class="${nameClass(index.get(id))}">${playerName(index, id)}</b></a>`;

/** A bounty claim, by goal: whole sentences, as Portuguese words them differently. */
const BOUNTY_CLAIMED = /* i18n */ {
  fc: '{who} claimed the FC bounty', pass: '{who} claimed the first-pass bounty', snipe: '{who} claimed the snipe bounty',
};
/** A bounty a player posted with Bananas, by goal. */
const BOUNTY_POSTED = /* i18n */ {
  fc: '{who} put {stake} on an FC', pass: '{who} put {stake} on a first pass', snipe: '{who} put {stake} on taking the #1',
};

function describe(e, index, maps) {
  // A play's map, or the map a crown or bounty event names.
  const mapId = e.s ? e.s[S.MAP] : e.m;
  const map = mapId ? html`<a class="dim-link" href="#/map/${mapId}">${mapLabel(mapId, maps[mapId])}</a>` : '';
  switch (e.k) {
    case 'crown':
      // A crown taken on King of the hill, or a closed month's King.
      return e.mo
        ? { what: th('{who} is King of the hill for {month}, with {crowns}', { who: who(index, e.u), month: monthLabel(e.mo), crowns: fmt.plural(e.n, 'crown') }), where: '' }
        : { what: th('{who} took the {slot} crown from {other}', { who: who(index, e.u), slot: `${SLOT_NAME[e.h[0]]} · ${TIER_NAME[e.h[1]]}`, other: who(index, e.v) }), where: map };
    case 'bounty':
      return { what: th(BOUNTY_CLAIMED[e.g], { who: who(index, e.u) }), where: e.a ? html`${map} · ${t('{n} from the pot', { n: bananas(e.a) })}` : map };
    case 'post':
      return { what: th(BOUNTY_POSTED[e.g], { who: who(index, e.u), stake: bananas(e.a) }), where: map };
    case 'tip':
      return { what: th('{who} tipped {other} {n}', { who: who(index, e.u), other: who(index, e.v), n: bananas(e.a) }), where: e.n ? html`<span class="quote">“${e.n}”</span>` : '' };
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

/**
 * Plays worth a tip: a snipe, a top play, a Dan pass, a crown or a claim. Only on the Activity page (`tips`), only for a
 * signed-in player, never on their own.
 */
const TIPPABLE = new Set(['snipe', 'top', 'dan', 'crown', 'bounty']);
function tipLink(e, index) {
  const me = TIPPABLE.has(e.k) ? session() : null;
  return me && me.id !== e.u ? html`<a class="event-tip small" href="#/player/${e.u}?tip=1" aria-label="${t('Tip {name}', { name: playerName(index, e.u) })}">${t('Tip')}</a>` : '';
}

export function eventItem(e, index, maps, { tips = false } = {}) {
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
    ${tips ? tipLink(e, index) : ''}
    ${line ? html`<div class="quip">${line}</div>` : ''}
  </div>`;
}
