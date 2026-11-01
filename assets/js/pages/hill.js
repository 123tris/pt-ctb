// The King of the hill tab of Challenges (hill.json, tools/lib/hill.mjs): this month's pool and who holds each crown,
// the crown table (all time or one season) and the past months.

import { html, raw } from '../core/html.js';
import { M, HILL_SLOTS, HILL_TIERS, HILL_MOD_STARS, sharedRanks } from '../core/model.js';
import {
  playerLink, modsBadges, empty, announce, writeQuery, isInactive, statusTag, cover, mapText, starsBadge, chipGroup, setPressed,
} from '../core/ui.js';
import { SLOT_NAME, TIER_NAME, monthLabel, nextMonthLabel, lisbonDay, andList, seasonLabel, titleName, slotTally } from '../core/hill.js';
import { challengeChips } from '../core/challenge-chips.js';
import * as fmt from '../core/fmt.js';
import { t, th, tn } from '../core/i18n.js';

/** The season picker is chips up to this many choices (DESIGN.md §9), a select past that. */
const SCOPE_CHIPS = 5;

/** A player in the hill's lists: their site entry, or the name the bot gave for someone the site doesn't list. */
const who = (id, name, index) => index.get(id) ?? { id, name: name || `#${id}` };
/** A player's name as a plain link, for names in running text and the past months' tables (no avatar to line up). */
const nameLink = (id, name, index) => html`<a class="hill-name" href="/player/${id}">${who(id, name, index).name}</a>`;
/** Names in a sentence: "A, B and C", each linked. */
const names = (ids, index) => andList(ids.map(id => nameLink(id, '', index)));

/** The stars a slot's map shows: HR and DT slots' with the mod (the bot's), the others' nomod. */
const slotStars = (s, maps) => (HILL_MOD_STARS.includes(s.slot) && s.stars ? s.stars : maps[s.map]?.[M.STARS] ?? 0);

/** "Open · 6.2–7.8★": a tier with the stars its maps span. */
function tierHead(tier, pool, maps) {
  const stars = pool.filter(s => s.tier === tier).map(s => slotStars(s, maps)).filter(Boolean);
  if (!stars.length) return TIER_NAME[tier];
  const [low, high] = [Math.min(...stars), Math.max(...stars)];
  return t('{tier} · {stars}★', { tier: TIER_NAME[tier], stars: low === high ? fmt.num(low, 1) : `${fmt.num(low, 1)}–${fmt.num(high, 1)}` });
}

/**
 * One slot of one tier: the map (cover, stars, title), then the holder and their hill score, when the play was set
 * (linked to it on osu! when known), the snipes if any, and the chips of the other challenges the map is in. A free slot
 * says "Up for grabs", or "Nobody kept this crown" once the month is over (`closed`).
 */
function slotCell(s, maps, index, closed, now) {
  if (!s) return html`<div class="hill-cell"></div>`;
  const meta = maps[s.map];
  const { title, sub } = mapText(s.map, meta);
  const h = s.holder;
  const when = h?.time ? (closed ? fmt.date(h.time) : fmt.ago(h.time)) : '';
  const chips = now ? challengeChips(s.map, now, 'hill') : [];
  return html`<div class="hill-cell" data-tier="${s.tier}">
    <a class="map" href="/map/${s.map}">
      ${cover(meta, 'list', 'map-cover hill-cover')}
      <span class="map-title" title="${title} ${sub}">${starsBadge(slotStars(s, maps))} ${title} <span class="map-sub">${sub}</span></span>
    </a>
    <div class="hill-holder">${h ? html`
      ${playerLink(who(h.u, h.name, index), null, 'avatar-sm')}
      ${h.score !== undefined ? html`<span class="hill-score">${fmt.num(h.score)}</span>` : ''}
      ${['FM', 'CV'].includes(s.slot) && h.mods ? modsBadges(h.mods) : ''}
      ${when ? (h.url ? html`<a class="dim-link" href="${h.url}" target="_blank" rel="noopener" title="${t('This play on osu!')}">${when}</a>`
        : html`<span class="faint" title="${fmt.dateTime(h.time)}">${when}</span>`) : ''}`
      : closed ? html`<span class="faint">${t('Nobody kept this crown')}</span>` : html`<span class="hill-free">${t('Up for grabs')}</span>`}
      ${s.snipes ? html`<span class="faint">${fmt.plural(s.snipes, 'snipe')}</span>` : ''}
      ${chips}
    </div>
  </div>`;
}

/**
 * A pool as one list of six rows, NM to Convert, with the Open and Challenger cells side by side under a line naming
 * each tier and its stars. On phones one tier shows at a time (`tier`, chosen with the chips above it).
 */
function poolGrid(pool, maps, index, { closed = false, now = null, tier = 'open' } = {}) {
  const at = (slot, t) => pool.find(s => s.slot === slot && s.tier === t);
  return html`<div class="hill-pool" data-show="${tier}">
    <div class="hill-tiers" aria-hidden="true"><span></span>${HILL_TIERS.map(x => html`<span data-tier="${x}">${tierHead(x, pool, maps)}</span>`)}</div>
    <div class="rows">${HILL_SLOTS.filter(slot => HILL_TIERS.some(x => at(slot, x))).map(slot => html`<div class="row hill-row">
      <span class="hill-slot">${SLOT_NAME[slot]}</span>
      ${HILL_TIERS.map(x => html`<div class="hill-tier-cell" data-tier="${x}"><span class="sr-only">${TIER_NAME[x]}: </span>${slotCell(at(slot, x), maps, index, closed, now)}</div>`)}
    </div>`)}</div>
  </div>`;
}

/** The status line with a leader, or several tied: whole sentences, as the verb agrees in both languages. */
const LEADS = /* i18n */ {
  one: '{left} · {held} of {total} crowns taken · {players} leads with {crowns}',
  many: '{left} · {held} of {total} crowns taken · {players} lead with {crowns}',
};

/** "29 days left" or "5 hours left". */
function leftWords(end) {
  const left = end - Date.now() / 1000;
  if (left >= 86400) return tn(Math.floor(left / 86400), '{n} day left', '{n} days left');
  const hours = Math.max(1, Math.floor(left / 3600));
  return tn(hours, '{n} hour left', '{n} hours left');
}

/**
 * This month: one line on where it stands (time left, crowns taken, who leads), then its pool. Once its end has passed
 * and before the bot settles it, the line says so and the free slots read as kept by nobody.
 */
function currentSection(current, maps, index, now, tier) {
  if (!current) return html`<section class="section"><div class="section-head"><h2>${t('This month')}</h2></div>
    ${empty(t('The next pool appears here when the month starts.'))}</section>`;
  if (current.status === 'draft') return html`<section class="section"><div class="section-head"><h2>${monthLabel(current.month)}</h2></div>
    ${empty(t('This month’s pool is being picked. It shows here once a moderator approves it.'))}</section>`;
  const ended = current.end <= Date.now() / 1000;
  const held = current.pool.filter(s => s.holder).length;
  const { leaders } = current;
  const crowns = leaders && (leaders.players.length > 1 ? t('{crowns} each', { crowns: fmt.plural(leaders.held, 'crown') }) : fmt.plural(leaders.held, 'crown'));
  const counts = { held: fmt.num(held), total: fmt.num(current.pool.length) };
  return html`<section class="section">
    <div class="section-head"><h2>${monthLabel(current.month)}</h2></div>
    ${ended ? html`
      <p class="hill-lead">${t('Ended {date} · {held} of {total} crowns kept', { date: lisbonDay(current.end - 1), ...counts })}</p>
      <p class="hill-lead-sub">${leaders ? th('Most crowns (final after the bot’s next update): {players} with {crowns}.', { players: names(leaders.players, index), crowns }) : ''}
        ${t('{month}’s pool appears after that.', { month: nextMonthLabel(current.month) })}</p>`
    : html`<p class="hill-lead">${leaders
      ? th(LEADS[leaders.players.length > 1 ? 'many' : 'one'], {
        left: leftWords(current.end), ...counts, players: names(leaders.players, index), crowns,
      })
      : t('{left} · {held} of {total} crowns taken', { left: leftWords(current.end), ...counts })}</p>
      <p class="hill-lead-sub">${t('Ends {date}, Lisbon time.', { date: lisbonDay(current.end - 1) })}</p>`}
    <div class="hill-pick">${chipGroup(t('Tier'), 'tier', HILL_TIERS.map(x => [x, TIER_NAME[x]]), tier)}</div>
    ${poolGrid(current.pool, maps, index, { closed: ended, now: ended ? null : now, tier })}
  </section>`;
}

/** The crown table's rows for a scope ('all' or a season id): [id, name, crowns, per slot], most first. */
function tableRows(players, scope) {
  if (scope === 'all') return players.map(([id, name, total, slots]) => [id, name, total, slots]);
  return players.filter(p => p[4][scope]).map(([id, name, , , seasons]) => [id, name, seasons[scope].reduce((a, b) => a + b, 0), seasons[scope]])
    .sort((a, b) => b[2] - a[2] || a[0] - b[0]);
}

/** Who holds which title in a season: each slot's king(s) and the All-rounders. */
function seasonTitles(season, index) {
  const items = [
    ...HILL_SLOTS.filter(slot => season.kings[slot]).map(slot => [titleName({ kind: 'slot', slot }), season.kings[slot]]),
    ...(season.allRounders.length ? [[t('All-rounder'), season.allRounders]] : []),
  ];
  return html`<ul class="badge-list hill-titles">${items.map(([name, ids]) => html`<li><b>${name}</b><span>${names(ids, index)}</span></li>`)}</ul>`;
}

/**
 * The crown table: everyone with a crown in the scope, most first, tied counts sharing a rank. Gold only for a sole #1;
 * a season's slot king is in bold.
 */
function crownTable(rows, season, index, me) {
  if (!rows.length) return empty(t('No crowns yet.'));
  const ranks = sharedRanks(rows.map(r => r[2]));
  const soleFirst = ranks.filter(r => r === 1).length === 1;
  return html`<div class="table-wrap" data-label="${t('Crown table')}"><table class="hill-table">
    <thead><tr><th>#</th><th>${t('Player')}</th><th class="num">${t('Crowns')}</th>${HILL_SLOTS.map(slot => html`<th class="num col-opt">${SLOT_NAME[slot]}</th>`)}</tr></thead>
    <tbody>${rows.map(([id, name, total, slots], i) => {
      const p = index.get(id);
      const tag = p ? statusTag(p) : '';
      return html`<tr class="${id === me ? 'me' : ''} ${p && isInactive(p) ? 'inactive' : ''}">
        <td class="rank ${soleFirst && ranks[i] === 1 ? 'king-rank' : ''}">${ranks[i]}</td>
        <td class="cell-player">${playerLink(who(id, name, index))}${tag ? html` ${tag}` : ''}<span class="cell-sub">${slotTally(slots)}</span></td>
        <td class="num king-count">${fmt.num(total)}</td>
        ${HILL_SLOTS.map((slot, k) => {
          const king = season?.kings[slot]?.includes(id);
          return html`<td class="num col-opt ${king ? 'hill-king' : ''}">${slots[k] ? fmt.num(slots[k]) : html`<span class="faint">—</span>`}${king ? html`<span class="sr-only"> (${titleName({ kind: 'slot', slot })})</span>` : ''}</td>`;
        })}
      </tr>`;
    })}</tbody>
  </table></div>`;
}

/**
 * A closed month in brief: its King(s) of the hill as a sentence, then who kept each slot's crown in each tier, a fixed
 * table (like Star kings) whose names end in "…" rather than run into the next column.
 */
function pastMonth(m, index) {
  const kept = (slot, tier) => m.pool.find(s => s.slot === slot && s.tier === tier);
  const holder = s => (s?.holder ? nameLink(s.holder.u, s.holder.name, index) : html`<span class="faint">—</span>`);
  // A tier nobody kept a crown in that month (all "—") gets no column.
  const tiers = HILL_TIERS.filter(tier => m.pool.some(s => s.tier === tier && s.holder));
  return html`<div class="hill-month">
    <h3 class="hill-month-h">${monthLabel(m.month)}</h3>
    <p class="muted small">${m.kings.length ? th('{title}: {players} with {crowns}', {
      title: t('King of the hill'), players: names(m.kings, index),
      crowns: m.kings.length > 1 ? t('{crowns} each', { crowns: fmt.plural(m.most, 'crown') }) : fmt.plural(m.most, 'crown'),
    }) : t('No crowns given')}</p>
    <div class="table-wrap"><table class="table-compact hill-kept">
      <thead><tr><th class="col-slot"><span class="sr-only">${t('Slot')}</span></th>${tiers.map(tier => html`<th>${TIER_NAME[tier]}</th>`)}</tr></thead>
      <tbody>${HILL_SLOTS.filter(slot => tiers.some(tier => kept(slot, tier))).map(slot => html`<tr>
        <th scope="row">${SLOT_NAME[slot]}</th>${tiers.map(tier => html`<td><span class="cell-line">${holder(kept(slot, tier))}</span></td>`)}
      </tr>`)}</tbody>
    </table></div>
  </div>`;
}

/**
 * The tab's panel, which Challenges only shows when the export has hill.json. `now` is what else is running
 * (challenge-chips.js runningNow). ?season=2026-Q4 opens the crown table on that season; ?tier=challenger shows that
 * tier first on phones.
 */
export function renderHill(root, { hill, index, me, query, now }) {
  const { current, months, seasons, players, maps } = hill;
  const scopes = [['all', t('All time')], ...seasons.map(s => [s.id, s.final ? seasonLabel(s.id) : t('{season}, so far', { season: seasonLabel(s.id) })])];
  let scope = scopes.some(([id]) => id === query.season) ? query.season : 'all';
  let tier = HILL_TIERS.includes(query.tier) ? query.tier : 'open';
  const save = () => writeQuery({ season: scope, tier }, { season: 'all', tier: 'open' });

  root.innerHTML = String(html`
    ${currentSection(current, maps, index, now, tier)}
    <section class="section">
      <div class="section-head"><h2>${t('Crown table')}</h2></div>
      ${scopes.length > SCOPE_CHIPS ? html`<div class="toolbar"><label class="hill-scope-label" for="hill-scope">${t('Crowns from')}</label>
        <select class="select" id="hill-scope">${scopes.map(([id, label]) => html`<option value="${id}" ${id === scope ? raw('selected') : ''}>${label}</option>`)}</select></div>`
        : scopes.length > 1 ? html`<div class="toolbar" id="hill-scopes">${chipGroup(t('Crowns from'), 'scope', scopes, scope)}</div>` : ''}
      <div id="hill-titles"></div>
      <p class="result-count" id="hill-count"></p>
      <div id="hill-table"></div>
    </section>
    ${months.length ? html`<section class="section">
      <div class="section-head"><h2>${t('Past months')}</h2></div>
      <div class="hill-months">${months.map(m => pastMonth(m, index))}</div>
    </section>` : ''}`);

  const titlesEl = root.querySelector('#hill-titles');
  const tableEl = root.querySelector('#hill-table');
  const count = root.querySelector('#hill-count');
  const draw = ({ speak = false } = {}) => {
    const season = seasons.find(s => s.id === scope) ?? null;
    const rows = tableRows(players, scope);
    titlesEl.innerHTML = String(season ? seasonTitles(season, index) : '');
    tableEl.innerHTML = String(crownTable(rows, season, index, me));
    count.textContent = rows.length ? t('{players} with a crown', { players: fmt.plural(rows.length, 'player') }) : '';
    setPressed(root, 'scope', scope);
    save();
    if (speak) announce(count.textContent || t('No crowns yet.'));
  };
  draw();
  root.querySelector('#hill-scope')?.addEventListener('change', e => { scope = e.target.value; draw({ speak: true }); });
  root.querySelector('#hill-scopes')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-scope]');
    if (chip) { scope = chip.dataset.scope; draw({ speak: true }); }
  });
  // Phones show one tier of the pool at a time.
  root.querySelector('.hill-pick')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-tier]');
    if (!chip) return;
    tier = chip.dataset.tier;
    root.querySelector('.hill-pool').dataset.show = tier;
    setPressed(root.querySelector('.hill-pick'), 'tier', tier);
    save();
    announce(TIER_NAME[tier]);
  });
}
