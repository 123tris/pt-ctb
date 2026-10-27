// The weekly recap the bot posts on Discord every Monday (challenges.json `weekly`): the week so far, the open vote for a
// coming map of the week and past weeks. In full on Activity's "This week" tab; as a short summary on the home page.

import { html } from './html.js';
import { S } from './model.js';
import { mapLink, playerLink, scoreStats, ppText, catChip, scoreWhen, mapLabel, scoreUrl, empty } from './ui.js';
import * as fmt from './fmt.js';

const dayMonth = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', day: 'numeric', month: 'short' });

/** True once the bot has written anything weekly: the week so far, a map vote or a closed week. */
export const hasWeekly = weekly => Boolean(weekly && (weekly.current || weekly.mapVote || weekly.past?.length));

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

/** A play in one table cell, on two lines: who and the pp (linked to the play on osu! when known), then the map. */
function playCell([uid, , ...s], maps, index) {
  const url = scoreUrl(s);
  const pp = url ? html`<a href="${url}" target="_blank" rel="noopener" title="This play on osu!">${ppText(s[S.PP])}</a>` : ppText(s[S.PP]);
  const label = mapLabel(s[S.MAP], maps[s[S.MAP]]);
  return html`<span class="cell-line">${playerLink(uid, index, 'avatar-sm')} ${pp}</span>
    <a class="cell-line dim-link small" href="#/map/${s[S.MAP]}" title="${label}">${label}</a>`;
}

/** How a past week's map was picked, when the data says. */
const PICKED = { true: 'Voted', false: 'Automatic pick' };

/** "19–25 Oct", with a * when the bot missed part of the week (the footnote under the table says so). */
const week = p => html`${weekRange(p)}${p.complete ? '' : html`<span aria-hidden="true">*</span><span class="sr-only"> (some plays missing)</span>`}`;

/**
 * Past weeks as a table that always fits the page: every cell is one or two lines, and long names end in "…". On
 * phones only the map column stays, with the week and the top play folded under it.
 */
function pastWeeks(past, maps, index) {
  const weeks = past.slice(0, 26);
  return html`<div class="table-wrap" data-label="Past weeks"><table class="table-compact table-weeks">
    <thead><tr><th class="col-opt col-week">Week</th><th>Map of the week</th><th class="col-opt col-top">Top pp play</th><th class="col-opt col-most">Most plays</th></tr></thead>
    <tbody>${weeks.map(p => html`<tr>
      <td class="col-opt"><span class="cell-line">${week(p)}</span>
        ${p.map && p.voted !== undefined ? html`<span class="cell-line faint small">${PICKED[p.voted]}</span>` : ''}</td>
      <td>${p.map ? mapLink(p.map, maps[p.map]) : '—'}
        <span class="cell-sub"><span>${week(p)}${p.map && p.voted !== undefined ? ` · ${PICKED[p.voted]}` : ''}</span></span>
        ${p.top ? html`<span class="cell-sub">Top play ${playerLink(p.top[0], index, 'avatar-sm')} ${ppText(p.top[2 + S.PP])}</span>` : ''}</td>
      <td class="col-opt">${p.top ? playCell(p.top, maps, index) : '—'}</td>
      <td class="col-opt">${p.most ? html`<span class="cell-line">${playerLink(p.most[0], index, 'avatar-sm')}</span>
        <span class="cell-line faint small">${fmt.plural(p.most[1], 'play')}</span>` : '—'}</td>
    </tr>`)}</tbody>
  </table></div>
  ${weeks.some(p => !p.complete) ? html`<p class="faint small mt-2">* The bot was offline for part of this week, so some plays may be missing.</p>` : ''}`;
}

/** The whole recap (Activity's "This week" tab). Each part only appears once the bot has written it. */
export function weeklyRecap(weekly, maps, index) {
  if (!hasWeekly(weekly)) return empty('The first weekly recap arrives with the bot’s Monday post.');
  const { current, mapVote, past = [] } = weekly;
  return html`
    ${current ? html`<section>
      <div class="section-head"><h2>This week so far</h2><span class="muted small">${weekLine(current)}</span></div>
      ${current.top || current.most.length ? html`<div class="rows">
        ${current.top ? highlightRow('Top pp play', current.top, maps, index) : ''}
        ${current.most.length ? html`<div class="row"><div class="row-main"><span class="muted small">Most plays</span></div>
          <div class="row-meta">${current.most.map(([uid, n]) => html`${playerLink(uid, index, 'avatar-sm')} <span>${fmt.plural(n, 'play')}</span>`)}</div></div>` : ''}
      </div>` : empty('Nothing yet this week. Go set something.')}
    </section>` : ''}

    ${mapVote ? html`<section class="section">
      <div class="section-head"><h2>Vote: next map of the week</h2><span class="muted small">For ${weekRange(mapVote)}. Vote with the reactions on Discord; it closes with Monday's recap, and with no votes the first map wins.</span></div>
      <div class="rows">${mapVote.candidates.map(([id, players], i) => html`<div class="row">
        <div class="row-main"><span class="muted small">${i + 1}.</span>${mapLink(id, maps[id])}</div>
        <div class="row-meta"><span>${fmt.plural(players, 'player')} from Portugal</span></div>
      </div>`)}</div>
      <div class="mt-3 btn-row"><a class="btn btn-primary" href="${mapVote.url}" target="_blank" rel="noopener">Vote on Discord ↗</a></div>
    </section>` : ''}

    ${past.length ? html`<section class="section">
      <div class="section-head"><h2>Past weeks</h2><span class="muted small">The map of the week is voted on Discord; a week nobody voted for gets an automatic pick.</span></div>
      ${pastWeeks(past, maps, index)}
    </section>` : ''}`;
}

/**
 * The home page's short version: the week's numbers, its top play and who played most, and a line about an open map
 * vote, linking to the full recap. Nothing until the bot has written the week so far or a vote.
 */
export function weeklySummary(weekly, maps, index) {
  const { current, mapVote } = weekly ?? {};
  if (!current && !mapVote) return '';
  const top = current?.top;
  return html`<section class="week-summary">
    <div class="section-head"><h2>This week so far</h2><a href="#/activity?view=week">The week’s recap</a></div>
    ${current ? html`<p class="muted small">${weekLine(current)}</p>` : ''}
    ${top ? html`<div class="week-top"><span class="faint small">Top play</span> ${playerLink(top[0], index, 'avatar-sm')}
      <span>${ppText(top[2 + S.PP])}</span> <a class="dim-link" href="#/map/${top[2 + S.MAP]}">${mapLabel(top[2 + S.MAP], maps[top[2 + S.MAP]])}</a></div>` : ''}
    ${current?.most.length ? html`<div class="week-top"><span class="faint small">Most plays</span> ${playerLink(current.most[0][0], index, 'avatar-sm')} <span class="muted">${fmt.plural(current.most[0][1], 'play')}</span></div>` : ''}
    ${mapVote ? html`<div class="week-top"><span class="faint small">Next map</span> Pick the map of the week for ${weekRange(mapVote)}. <a href="${mapVote.url}" target="_blank" rel="noopener">Vote on Discord ↗</a></div>` : ''}
  </section>`;
}
