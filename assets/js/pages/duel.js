// A duel's own page, /duel/:id (duels/<n>.json, tools/lib/duels.mjs): the two players and the final score, their
// ratings before and after, the format and the lobby on osu!, then every round with both scores. It's the link the bot
// posts with a result, so it stands on its own.

import { html } from '../core/html.js';
import { duel, playerIndex, NotFound } from '../core/data.js';
import { M } from '../core/model.js';
import { setTitle, avatar, nameClass, mapText, cover, starsBadge, empty, myId } from '../core/ui.js';
import { matchUrl, deltaText, formatText, STATUS_TEXT, voidText, duelist } from '../core/duels.js';
import { bananas } from '../core/bananas.js';
import * as fmt from '../core/fmt.js';
import { t, th } from '../core/i18n.js';

/** One player's side of the scoreboard: avatar, name, the points, and their rating before → after a ranked duel. */
function side(s, d, index, me) {
  const p = duelist(s, index);
  const won = d.winner === s.u;
  return html`<div class="duel-board-side ${won ? 'duel-winner' : ''} ${s.u === me ? 'me' : ''}">
    <a class="duel-board-player" href="/player/${s.u}">${avatar(s.u, 'avatar-md')}<span class="${nameClass(p)}">${p.name}</span></a>
    ${won ? html`<span class="badge badge-gold">${t('Winner')}</span>` : ''}
    ${s.after !== undefined ? html`<span class="duel-board-rating">${fmt.num(s.before)} → <b>${fmt.num(s.after)}</b> ${deltaText(Math.round(s.after - s.before))}</span>` : ''}
  </div>`;
}

/** A player's score on a round: the score (✓ for the round's winner), then accuracy, misses and a fail. */
function scoreCell(r, u) {
  const s = r.scores.find(x => x.u === u);
  if (!s) return html`<td class="num duel-score"><span class="faint">${t('no score')}</span></td>`;
  const won = r.winner === u;
  return html`<td class="num duel-score ${won ? 'duel-won' : ''}">
    <span class="duel-score-main">${won ? html`<span class="duel-check" aria-hidden="true">✓</span><span class="sr-only">${t('won')}: </span>` : ''}${fmt.num(s.score)}</span>
    <span class="duel-score-sub">${s.acc !== null ? fmt.acc(s.acc) : ''}${s.miss ? html` · <span class="miss-n">✕${fmt.num(s.miss)}</span>` : ''}${s.pass ? '' : html` · <span class="miss-n">${t('failed')}</span>`}</span>
  </td>`;
}

/** The rounds as a table: the map (with the stars the bot rolled it at) and each player's score; a void round says why. */
function roundsTable(d, maps, index) {
  const [a, b] = d.players;
  return html`<div class="table-wrap" data-label="${t('Rounds')}"><table class="table-compact duel-rounds">
    <thead><tr><th class="col-n">#</th><th>${t('Map')}</th>
      <th class="num col-p">${duelist(a, index).name}</th><th class="num col-p">${duelist(b, index).name}</th></tr></thead>
    <tbody>${d.rounds.map((r, i) => {
      const meta = maps[r.map];
      const { title, sub } = mapText(r.map, meta);
      const stars = r.stars ?? meta?.[M.STARS];
      return html`<tr class="${r.void ? 'duel-void' : ''}">
        <td class="col-n faint">${r.n ?? i + 1}</td>
        <td class="duel-map"><a class="map" href="/map/${r.map}">${cover(meta)}<span class="map-text">
          <span class="map-title" title="${title}">${title}</span>
          <span class="map-sub">${stars ? html`${starsBadge(stars)} ` : ''}${meta ? sub : ''}</span></span></a>
          ${r.void ? html`<span class="duel-note">${t('Didn’t count: {reason}', { reason: voidText(r.void) })}</span>`
            : r.winner === null && r.scores.length ? html`<span class="duel-note">${t('A tie: nobody scored, and a new map was rolled')}</span>` : ''}</td>
        ${scoreCell(r, a.u)}${scoreCell(r, b.u)}
      </tr>`;
    })}</tbody>
  </table></div>`;
}

export default async function duelPage(root, { params, isCurrent }) {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new NotFound(`duel ${params.id}`);
  const [{ duel: d, maps }, index] = await Promise.all([duel(id), playerIndex()]);
  if (!isCurrent()) return;
  const [a, b] = d.players;
  const names = { a: duelist(a, index).name, b: duelist(b, index).name };
  setTitle(t('{a} vs {b}', names));
  const me = myId();
  const loser = d.winner === a.u ? names.b : names.a;
  const when = d.end ?? d.start;
  const facts = [
    formatText(d),
    STATUS_TEXT[d.status],
    d.stars && `${fmt.num(d.stars[0], 2)}–${fmt.num(d.stars[1], 2)}★`,
    d.wager && th('{n} each on it', { n: bananas(d.wager) }),
    when && html`<span title="${fmt.dateTime(when)}">${fmt.date(when)}</span>`,
  ].filter(Boolean);

  root.innerHTML = String(html`
    <header class="page-head">
      <span class="eyebrow"><a href="/challenges/duels">${t('Duels')}</a> · ${t('Duel {code}', { code: d.code ?? `#${d.id}` })}</span>
      <h1>${t('{a} vs {b}', names)}</h1>
    </header>

    <section class="duel-board ${d.status === 'abandoned' ? 'duel-muted' : ''}" aria-label="${t('Final score')}">
      ${side(a, d, index, me)}
      <div class="duel-board-score"><span>${fmt.num(a.pts)}</span><span class="duel-dash" aria-label="${t('to')}">–</span><span>${fmt.num(b.pts)}</span></div>
      ${side(b, d, index, me)}
    </section>
    <p class="duel-facts">${facts.map((f, i) => html`${i ? html`<span class="sep-dot" aria-hidden="true"> · </span>` : ''}${f}`)}</p>
    ${d.status === 'abandoned' ? html`<p class="notice">${t('Abandoned: no round counted for 30 minutes, so it doesn’t count for anyone’s rating and any wager went back.')}</p>`
      : d.status === 'forfeit' ? html`<p class="notice">${d.ranked ? t('{name} forfeited, which counts as a loss.', { name: loser }) : t('{name} forfeited.', { name: loser })}</p>` : ''}
    <div class="btn-row mt-3">
      ${d.mp ? html`<a class="btn" href="${matchUrl(d.mp)}" target="_blank" rel="noopener">${t('Match on osu!')} ↗</a>` : ''}
      <a class="btn" href="/challenges/duels">${t('All duels')}</a>
    </div>

    <section class="section">
      <div class="section-head"><h2>${t('Rounds')}</h2></div>
      ${d.rounds.length ? roundsTable(d, maps, index) : empty(t('No rounds were played.'))}
    </section>`);
}
