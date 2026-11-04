// Duels' words and pieces, shared by Challenges' Duels tab (pages/duels.js), a duel's own page (pages/duel.js), a
// profile's duel section (pages/player.js) and the Activity feed (core/events.js): ratings, records, streaks, the format
// line and a duel as one row. The data is duels.json and duels/<n>.json (tools/lib/duels.mjs).

import { html } from './html.js';
import { avatar, nameClass, tipTag } from './ui.js';
import * as fmt from './fmt.js';
import { t, tn } from './i18n.js';

/**
 * Duels ship as an experiment: an "Experimental" tag beside their name wherever they appear (the Challenges tab, a
 * duel's page, a profile's section) and a line saying what that means on the tab and the duel page. Remove both once
 * duels are settled.
 */
export const experimentalTag = () => html`<span class="legend-tag exp-tag">${t('Experimental')}</span>`;
export const experimentalNote = () => html`<p class="notice exp-note">${t('Duels are new and still being verified; ratings and results may be reset.')}</p>`;

/** A duel's lobby on osu!. */
export const matchUrl = id => `https://osu.ppy.sh/community/matches/${id}`;

/** "provisional": a rating still settling, with what that means a tap away. */
export const provisionalTag = (opts = {}) => tipTag(t('provisional'), t('Fewer than about five ranked duels: the rating moves a lot until it settles.'), opts);

/** A rating as a whole number, with its deviation after it in small print ("1,620 ±80"). */
export const ratingText = (r, rd) => html`${fmt.num(r)}${rd ? html` <small class="faint" title="${t('Rating deviation: how sure the rating is (lower is surer)')}">±${fmt.num(rd)}</small>` : ''}`;

/** "6–1", read out as "6 wins, 1 loss". */
export const recordText = (w, l) => html`<span title="${t('{wins}, {losses}', { wins: fmt.plural(w, 'win'), losses: fmt.plural(l, 'loss', 'losses') })}">${fmt.num(w)}–${fmt.num(l)}</span>`;

/** "3 wins in a row" (streak > 0) or "2 losses in a row" (< 0); '' for none. */
export const streakWords = n => (n > 0 ? tn(n, '{n} win in a row', '{n} wins in a row') : n < 0 ? tn(-n, '{n} loss in a row', '{n} losses in a row') : '');
/** The same, short: "W3" / "L2", with the words for screen readers and on hover. */
export const streakText = n => (n ? html`<span title="${streakWords(n)}"><span aria-hidden="true">${n > 0 ? t('W{n}', { n: fmt.num(n) }) : t('L{n}', { n: fmt.num(-n) })}</span><span class="sr-only">${streakWords(n)}</span></span>` : html`<span class="faint">—</span>`);

/** A rating change: "+12", "−9" (a real minus), "±0". */
export const deltaText = d => html`<span class="duel-delta">${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmt.num(Math.abs(d))}</span>`;

/** "Ranked · Best of 5" (an unranked duel is a friendly). */
export const formatText = d => [d.ranked ? t('Ranked|duel') : t('Unranked|duel'), d.bestOf ? t('Best of {n}', { n: d.bestOf }) : ''].filter(Boolean).join(' · ');

/** A duel's end in words, for the ones that didn't end on points: '' for a finished duel. */
export const STATUS_TEXT = { finished: '', forfeit: t('Forfeit'), abandoned: t('Abandoned') };

/**
 * Why a round didn't count. The bot gives a reason; the ones it gives as codes ("wrong-map", "wrong_map" and "WrongMap"
 * alike) read in the visitor's language, and any other text shows as the bot wrote it.
 */
const VOID_TEXT = /* i18n */ {
  wrongmap: 'Wrong map',
  wrongmode: 'Not played in osu!catch',
  notscorev2: 'Not scored with ScoreV2',
  mods: 'Mods other than NF',
  missingplayer: 'A player didn’t play it',
};
export const voidText = reason => {
  const code = String(reason).toLowerCase().replace(/[^a-z0-9]/g, '');
  return Object.hasOwn(VOID_TEXT, code) ? t(VOID_TEXT[code]) : reason;
};

/** A player in a duel: their site entry, or the name the duel has. */
export const duelist = (side, index) => index.get(side.u) ?? { id: side.u, name: side.name };

/**
 * One side of a duel as it reads in a list: avatar and name (no link: the row is one), the winner's in bold with a
 * hidden "won", and their points.
 */
function sideText(side, index, winner) {
  const p = duelist(side, index);
  const won = winner === side.u;
  return html`<span class="duel-side ${won ? 'duel-winner' : ''}">${avatar(side.u, 'avatar-sm')}<span class="duel-name ${nameClass(p)}">${p.name}</span>${won ? html`<span class="sr-only"> (${t('won')})</span>` : ''}</span>`;
}

/** "Alice 3 – 1 Bob": both sides and the points between them. */
export function scoreline(d, index) {
  const [a, b] = d.players;
  return html`<span class="duel-line">${sideText(a, index, d.winner)}<span class="duel-points">${fmt.num(a.pts)}<span class="duel-dash">–</span>${fmt.num(b.pts)}</span>${sideText(b, index, d.winner)}</span>`;
}

/**
 * A finished duel as one row linking to its page: the scoreline, then its format, how it ended and when. An abandoned
 * duel is muted and says so; `me` marks the visitor's own.
 */
export function duelRow(d, index, me) {
  const ended = d.end ?? d.start;
  const mine = d.players.some(p => p.u === me);
  return html`<a class="row card-link duel-row ${d.status === 'abandoned' ? 'duel-muted' : ''} ${mine ? 'me' : ''}" href="/duel/${d.id}">
    ${scoreline(d, index)}
    <span class="row-meta">
      <span>${formatText(d)}</span>
      ${STATUS_TEXT[d.status] ? html`<span class="sep"></span><span>${STATUS_TEXT[d.status]}</span>` : ''}
      ${d.stars ? html`<span class="sep"></span><span>${fmt.num(d.stars[0], 1)}–${fmt.num(d.stars[1], 1)}★</span>` : ''}
      ${ended ? html`<span class="sep"></span><span class="faint" title="${fmt.dateTime(ended)}">${fmt.ago(ended)}</span>` : ''}
    </span>
  </a>`;
}
