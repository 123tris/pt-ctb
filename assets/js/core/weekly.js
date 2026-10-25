// The weekly recap the bot posts on Discord every Monday (challenges.json `weekly`): the week so far, the open Score of
// the week vote and past weeks. In full on Activity's "This week" tab; as a short summary on the home page.

import { html } from './html.js';
import { S } from './model.js';
import { mapLink, playerLink, scoreStats, ppText, catChip, scoreWhen, mapLabel, scoreUrl, empty } from './ui.js';
import * as fmt from './fmt.js';

const LENS = { topPp: 'Top pp', snipe: 'Biggest snipe', hardestFc: 'Hardest FC', fill: 'Next best pp' };
const dayMonth = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', day: 'numeric', month: 'short' });

/** True once the bot has written anything weekly: the week so far, a vote or a closed week. */
export const hasWeekly = weekly => Boolean(weekly && (weekly.current || weekly.vote || weekly.past?.length));

/** "13–19 Jul" (Lisbon dates, Monday to Sunday). */
function weekRange({ start, end }) {
  const [from, to] = [start, end - 86400].map(t => dayMonth.formatToParts(new Date(t * 1000)));
  const part = (parts, type) => parts.find(p => p.type === type).value;
  return part(from, 'month') === part(to, 'month')
    ? `${part(from, 'day')}–${part(to, 'day')} ${part(to, 'month')}`
    : `${part(from, 'day')} ${part(from, 'month')}–${part(to, 'day')} ${part(to, 'month')}`;
}

/** "19–25 Oct · 77 passes by 11 players", noting when the bot missed part of the week. */
const weekLine = current => `${weekRange(current)} · ${fmt.plural(current.passes, 'pass', 'passes')} by ${fmt.plural(current.players, 'player')}${current.complete ? '' : ' · some plays may be missing'}`;

/** A highlighted play ([user, category, ...tuple]) as a row, with what it's highlighted for. */
const highlightRow = (label, [uid, cat, ...s], maps, index) => html`<div class="row">
  <div class="row-main"><span class="muted small">${label}</span>${mapLink(s[S.MAP], maps[s[S.MAP]])}<div>${playerLink(uid, index, 'avatar-sm')}</div></div>
  <div class="row-meta">${catChip(cat)} ${scoreStats(s)}<span class="sep"></span>${ppText(s[S.PP])}
    <span class="faint" title="${fmt.dateTime(s[S.TIME])}">${scoreWhen(s, fmt.ago(s[S.TIME]))}</span></div>
</div>`;

/** A play in one table cell: who, pp (linked to the play on osu! when known) and the map. */
function playCell([uid, , ...s], maps, index) {
  const url = scoreUrl(s);
  const pp = url ? html`<a href="${url}" target="_blank" rel="noopener" title="This play on osu!">${ppText(s[S.PP])}</a>` : ppText(s[S.PP]);
  return html`${playerLink(uid, index, 'avatar-sm')} ${pp} <a class="dim-link small" href="#/map/${s[S.MAP]}">${mapLabel(s[S.MAP], maps[s[S.MAP]])}</a>`;
}

/** The whole recap (Activity's "This week" tab). Each part only appears once the bot has written it. */
export function weeklyRecap(weekly, maps, index) {
  if (!hasWeekly(weekly)) return empty('The first weekly recap arrives with the bot’s Monday post.');
  const { current, vote, past = [] } = weekly;
  return html`
    ${current ? html`<section>
      <div class="section-head"><h2>This week so far</h2><span class="muted small">${weekLine(current)}</span></div>
      ${current.top || current.most.length ? html`<div class="rows">
        ${current.top ? highlightRow('Top pp play', current.top, maps, index) : ''}
        ${current.most.length ? html`<div class="row"><div class="row-main"><span class="muted small">Most plays</span></div>
          <div class="row-meta">${current.most.map(([uid, n]) => html`${playerLink(uid, index, 'avatar-sm')} <span>${fmt.plural(n, 'play')}</span>`)}</div></div>` : ''}
      </div>` : empty('Nothing yet this week. Go set something.')}
    </section>` : ''}

    ${vote ? html`<section class="section">
      <div class="section-head"><h2>Vote: Score of the week</h2><span class="muted small">The candidates from ${weekRange(past.find(p => p.week === vote.week) ?? past[0])}. Vote with the reactions on Discord; it closes with Monday's recap.</span></div>
      <div class="rows">${vote.candidates.map(([lens, row, n], i) => highlightRow(`${n ?? i + 1}. ${LENS[lens] ?? LENS.fill}`, row, maps, index))}</div>
      <div class="btn-row" style="margin-top:12px"><a class="btn btn-primary" href="${vote.url}" target="_blank" rel="noopener">Vote on Discord ↗</a></div>
    </section>` : ''}

    ${past.length ? html`<section class="section">
      <div class="section-head"><h2>Past weeks</h2><span class="muted small">Score of the week is voted on Discord; with no votes, the top pick wins.</span></div>
      <div class="table-wrap" data-label="Past weeks"><table class="table-compact">
        <thead><tr><th>Week</th><th>Score of the week</th><th class="col-opt">Top pp play</th><th class="col-opt">Most plays</th></tr></thead>
        <tbody>${past.slice(0, 26).map(p => html`<tr>
          <td title="${p.complete ? '' : 'The bot was offline for part of this week'}">${weekRange(p)}${p.complete ? '' : '*'}</td>
          <td>${p.sotw ? playCell(p.sotw, maps, index) : html`<span class="faint">${p.week === vote?.week ? 'voting' : '—'}</span>`}</td>
          <td class="col-opt">${p.top ? playCell(p.top, maps, index) : '—'}</td>
          <td class="col-opt">${p.most ? html`${playerLink(p.most[0], index, 'avatar-sm')} ${fmt.num(p.most[1])}` : '—'}</td>
        </tr>`)}</tbody>
      </table></div>
    </section>` : ''}`;
}

/**
 * The home page's short version: the week's numbers, its top play and who played most, and a line about an open vote,
 * linking to the full recap. Nothing until the bot has written the week so far or a vote.
 */
export function weeklySummary(weekly, maps, index) {
  const { current, vote } = weekly ?? {};
  if (!current && !vote) return '';
  const top = current?.top;
  return html`<section class="week-summary">
    <div class="section-head"><h2>This week so far</h2><a href="#/activity?view=week">The week’s recap →</a></div>
    ${current ? html`<p class="muted small">${weekLine(current)}</p>` : ''}
    ${top ? html`<div class="week-top"><span class="faint small">Top play</span> ${playerLink(top[0], index, 'avatar-sm')}
      <span>${ppText(top[2 + S.PP])}</span> <a class="dim-link" href="#/map/${top[2 + S.MAP]}">${mapLabel(top[2 + S.MAP], maps[top[2 + S.MAP]])}</a></div>` : ''}
    ${current?.most.length ? html`<div class="week-top"><span class="faint small">Most plays</span> ${playerLink(current.most[0][0], index, 'avatar-sm')} <span class="muted">${fmt.plural(current.most[0][1], 'play')}</span></div>` : ''}
    ${vote ? html`<div class="week-top"><span class="faint small">Score of the week</span> The vote is open. <a href="${vote.url}" target="_blank" rel="noopener">Vote on Discord ↗</a></div>` : ''}
  </section>`;
}
