// /admin: the admin panel (contract §8), for the osu! ids the site and the bot list as admins. Nothing here changes
// anything by itself: every save or action is an admin.* request the bot takes from the inbox within 15 minutes, checks
// again and applies or refuses with a code. Anyone else, signed in or not, gets "Admins only" and no data.
//
// The page reads admin.json (the bot's settings schema, current values and log: core/admin.js) and the admin's own
// requests (/api/admin/requests), so a change shows as "waiting for the bot" until the bot's next pull and export.
//   Settings  one card per group, each setting with its value as a typed field (number, toggle or list), the default,
//             a "changed" mark and Reset when it's overridden, and when it takes effect. A King of the hill slot and
//             tier's star band (its Min and Max settings) is one row with a two-thumb slider. Each card saves on its own:
//             "Review changes" lists old → new, and "Send" queues one admin.set (or admin.reset, back to the default)
//             per changed key. Fields are checked against min, max, step and length first, for a clear error.
//   Actions   King of the hill's pool (approve, reroll one slot and tier, redraft), cancelling a bounty with or without
//             refunds, adjusting a player's bananas, banning or unbanning a map. Each takes two steps: review, then send.
//   Log       your requests still waiting for the bot first, then the bot's log of admin actions, refusals in words.
// Esc steps back from a confirmation, as in the shop.

import { html, raw } from '../core/html.js';
import { playerIndex, players, hill, bounties } from '../core/data.js';
import { HILL_SLOTS, HILL_TIERS } from '../core/model.js';
import { SLOT_NAME, TIER_NAME, monthLabel } from '../core/hill.js';
import { GOAL_LABEL } from '../core/bounty.js';
import { setTitle, pageHead, empty, announce, playerPicker, pickedPlayer, mapLabel } from '../core/ui.js';
import { session, signInButton, mapIdFrom, closeOnEscape, bananas } from '../core/bananas.js';
import {
  adminPanel, isAdmin, myAdminRequests, sendAdmin, sentToast, GROUPS, groupName, EFFECTS, describe, starEdge, valueText, actionText, refusalText,
} from '../core/admin.js';
import * as fmt from '../core/fmt.js';
import { t, th, tn, locale } from '../core/i18n.js';

const LOG_LIMIT = 100;
const LOG_SHOWN = 15; // log lines before "Show all"
const CHEVRON = raw('<svg class="admin-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyId = key => key.replace(/[^A-Za-z0-9]/g, '-');

// ---- Settings fields ----------------------------------------------------------------------------------------------------

/** The field for one setting, showing `value`. Lists with a fixed length get one box each; open lists a text box. */
function field(s, value) {
  const id = `set-${keyId(s.key)}`;
  const range = { min: s.min ?? '', max: s.max ?? '', step: s.step ?? (s.type === 'int' || s.type === 'intList' ? 1 : 'any') };
  if (s.type === 'bool') {
    return html`<label class="admin-toggle"><input type="checkbox" id="${id}" ${value ? raw('checked') : ''}> <span>${t('On')}</span></label>`;
  }
  if (s.type === 'intList' && s.length) {
    return html`<div class="admin-list" role="group" aria-labelledby="${id}-text">${Array.from({ length: s.length }, (_, i) => html`<input class="input admin-num" type="number"
      inputmode="numeric" ${i === 0 ? raw(`id="${id}"`) : ''} data-i="${i}" min="${range.min}" max="${range.max}" step="${range.step}"
      value="${value?.[i] ?? ''}" aria-label="${t('Value {n} of {total}', { n: i + 1, total: s.length })}">`)}</div>`;
  }
  if (s.type === 'intList') {
    return html`<input class="input admin-text" type="text" id="${id}" inputmode="numeric" value="${(value ?? []).join(', ')}" aria-describedby="${id}-hint">
      <span class="faint small" id="${id}-hint">${t('1 to 10 whole numbers, separated by commas')}</span>`;
  }
  return html`<input class="input admin-num" type="number" id="${id}" inputmode="${s.type === 'int' ? 'numeric' : 'decimal'}"
    min="${range.min}" max="${range.max}" step="${range.step}" value="${value}">`;
}

const inRange = (s, n) => (s.min === null || n >= s.min) && (s.max === null || n <= s.max);
const rangeText = s => (s.min !== null && s.max !== null ? t('from {min} to {max}', { min: fmt.num(s.min), max: fmt.num(s.max) }) : '');

/** Reads a setting's field: { value } or { error } (in words, with the allowed range). */
function read(s, row) {
  if (s.type === 'bool') return { value: row.querySelector('input[type=checkbox]').checked };
  if (s.type === 'intList') {
    const parts = s.length ? [...row.querySelectorAll('input[data-i]')].map(i => i.value.trim())
      : row.querySelector('.admin-text').value.split(',').map(x => x.trim()).filter(Boolean);
    const nums = parts.map(Number);
    if (parts.some(p => p === '') || nums.some(n => !Number.isInteger(n))) return { error: t('Whole numbers only.') };
    if (!s.length && (nums.length < 1 || nums.length > 10)) return { error: t('Give 1 to 10 values.') };
    if (nums.some(n => !inRange(s, n))) return { error: t('Each value goes {range}.', { range: rangeText(s) }) };
    return { value: nums };
  }
  const text = row.querySelector('.admin-num').value.trim();
  const n = Number(text);
  if (text === '' || !Number.isFinite(n)) return { error: t('Enter a number.') };
  if (s.type === 'int' && !Number.isInteger(n)) return { error: t('Whole numbers only.') };
  if (!inRange(s, n)) return { error: t('It goes {range}.', { range: rangeText(s) }) };
  if (s.type === 'double' && s.step) {
    const steps = (n - (s.min ?? 0)) / s.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) return { error: t('Use steps of {step}.', { step: s.step }) };
  }
  return { value: n };
}

// ---- Star bands: a slot and tier's Min and Max settings on one two-thumb slider ------------------------------------------

const starsText = ([lo, hi]) => `${lo.toLocaleString(locale)}★ – ${hi.toLocaleString(locale)}★`;

/** The slider for a band, showing [lo, hi] on the settings' own scale and steps (the .range look of the Maps filter). */
const rangeField = (min, max, [lo, hi]) => html`<div class="range admin-stars" role="group" aria-labelledby="set-${keyId(min.key)}-text">
    <div class="range-track"><div class="range-fill"></div></div>
    <input type="range" min="${min.min}" max="${min.max}" step="${min.step}" value="${lo}" aria-label="${t('Minimum stars')}">
    <input type="range" min="${max.min}" max="${max.max}" step="${max.step}" value="${hi}" aria-label="${t('Maximum stars')}">
  </div>
  <output class="range-out on" data-out>${starsText([lo, hi])}</output>`;

const thumbs = range => [...range.querySelectorAll('input')];

/** Draws a slider's fill, readout and spoken values from its thumbs. */
function paintRange(range) {
  const [a, b] = thumbs(range);
  const at = i => `${(Number(i.value) - Number(i.min)) / (Number(i.max) - Number(i.min)) * 100}%`;
  range.style.setProperty('--lo', at(a));
  range.style.setProperty('--hi', at(b));
  for (const i of [a, b]) i.setAttribute('aria-valuetext', t('{n} stars', { n: Number(i.value).toLocaleString(locale) }));
  range.parentElement.querySelector('[data-out]').textContent = starsText([Number(a.value), Number(b.value)]);
}

/** Moves one thumb to `v`, in steps and a step short of the other, so the band never turns upside down. */
function moveThumb(input, v) {
  const range = input.closest('.admin-stars');
  const [a, b] = thumbs(range);
  const step = Number(input.step) || 0.1;
  const snap = x => Math.round(Math.min(Number(input.max), Math.max(Number(input.min), x)) / step) * step;
  const value = input === a ? Math.min(snap(v), Number(b.value) - step) : Math.max(snap(v), Number(a.value) + step);
  input.value = String(Math.round(value * 100) / 100);
  paintRange(range);
}

// ---- The page -----------------------------------------------------------------------------------------------------------

export default async function admin(root, { isCurrent }) {
  setTitle(t('Admin'));
  const head = pageHead({
    title: t('Admin'),
    intro: t('Changes go to the bot as requests. It checks them, applies them within 15 minutes and logs them at the bottom of this page.'),
  });
  const me = session();
  const only = extra => { root.innerHTML = String(html`${head}${empty(html`<p>${t('Admins only.')}</p>${extra ?? ''}`)}`); };
  if (!me) return only(signInButton());
  const [mine, panel, index, list, hillData, bountyData] = await Promise.all([
    myAdminRequests(), adminPanel().catch(() => null), playerIndex(), players(), hill().catch(() => null), bounties().catch(() => null),
  ]);
  if (!isCurrent()) return;
  if (mine.status === 403 || (!mine.ok && !isAdmin(me.id, panel))) return only();
  if (!mine.ok) {
    root.innerHTML = String(html`${head}${empty(mine.status === 503 ? t('Admin requests need Bananas set up on this copy of the site.') : t('Your requests couldn’t be read. Try again in a moment.'))}`);
    return;
  }

  let requests = mine.requests;
  const settings = panel?.settings ?? [];
  const byKey = new Map(settings.map(s => [s.key, s]));
  const groups = [...new Set(settings.map(s => s.group))].sort((a, b) => Object.keys(GROUPS).indexOf(a) - Object.keys(GROUPS).indexOf(b));
  const pendingFor = key => requests.filter(r => r.status === 'pending' && ['admin.set', 'admin.reset'].includes(r.type) && r.payload.key === key)[0] ?? null;
  // Values picked to go back to the default with Reset: sent as admin.reset rather than admin.set.
  const resets = new Set();

  const settingRow = s => {
    const id = `set-${keyId(s.key)}`;
    const pending = pendingFor(s.key);
    return html`<div class="admin-setting" data-key="${s.key}">
      <div class="admin-setting-text">
        <label for="${id}" id="${id}-text">${describe(s)}</label>
        <span class="admin-meta"><code>${s.key}</code><span aria-hidden="true"> · </span>${t('default {value}', { value: valueText(s.default) })}<span aria-hidden="true"> · </span>${EFFECTS[s.effect] ?? s.effect}</span>
        ${s.overridden ? html`<span class="admin-changed">${t('Changed from the default')} <button class="link-button" type="button" data-reset aria-label="${t('Reset {key} to its default', { key: s.key })}">${t('Reset')}</button></span>` : ''}
        ${pending ? html`<span class="req-status">${pending.type === 'admin.reset' ? t('Waiting for the bot: back to the default') : t('Waiting for the bot: {value}', { value: valueText(pending.payload.value) })}</span>` : ''}
      </div>
      <div class="admin-setting-field">${field(s, s.value)}</div>
      <p class="admin-error" role="alert" hidden></p>
    </div>`;
  };

  // A band's row: both settings, the slider, and one "waiting" line with the band as it will be.
  const rangeRow = (min, max, { slot, tier }) => {
    const id = `set-${keyId(min.key)}`;
    const pending = [min, max].map(pendingFor);
    const after = [min, max].map((s, i) => (!pending[i] ? s.value : pending[i].type === 'admin.reset' ? s.default : pending[i].payload.value));
    const mod = slot === 'HR' || slot === 'DT' ? slot : null;
    return html`<div class="admin-setting admin-range" data-key="${min.key}" data-max="${max.key}">
      <div class="admin-setting-text">
        <span class="admin-range-name" id="${id}-text">${SLOT_NAME[slot] ?? slot} · ${TIER_NAME[tier] ?? tier}</span>
        <span class="admin-meta"><code>${min.key.replace('MinStars', '{Min,Max}Stars')}</code><span aria-hidden="true"> · </span>${mod ? html`${t('stars with {mod} on', { mod })}<span aria-hidden="true"> · </span>` : ''}${t('default {value}', { value: starsText([min.default, max.default]) })}<span aria-hidden="true"> · </span>${EFFECTS[min.effect] ?? min.effect}</span>
        ${min.overridden || max.overridden ? html`<span class="admin-changed">${t('Changed from the default')} <button class="link-button" type="button" data-reset aria-label="${t('Reset {key} to its default', { key: `${SLOT_NAME[slot] ?? slot} · ${TIER_NAME[tier] ?? tier}` })}">${t('Reset')}</button></span>` : ''}
        ${pending.some(Boolean) ? html`<span class="req-status">${t('Waiting for the bot: {value}', { value: starsText(after) })}</span>` : ''}
      </div>
      <div class="admin-setting-field">${rangeField(min, max, [min.value, max.value])}</div>
      <p class="admin-error" role="alert" hidden></p>
    </div>`;
  };
  // A group's rows: a band's Min and Max settings share one row; anything else is a row of its own.
  const groupRows = g => settings.filter(s => s.group === g).map(s => {
    const star = starEdge(s.key);
    const min = star && byKey.get(s.key.replace(/MaxStars$/, 'MinStars'));
    const max = star && byKey.get(s.key.replace(/MinStars$/, 'MaxStars'));
    if (!min || !max || min === max) return settingRow(s);
    return star.edge === 'Min' ? rangeRow(min, max, star) : '';
  });
  const rowSettings = row => [row.dataset.key, row.dataset.max].filter(Boolean).map(k => byKey.get(k));

  // Each group folds (closed to start), its summary saying what's changed, waiting or edited without being sent.
  const groupSummary = g => {
    const inGroup = settings.filter(s => s.group === g);
    const changed = inGroup.filter(s => s.overridden).length;
    const waiting = inGroup.filter(s => pendingFor(s.key)).length;
    return html`<span class="admin-group-name">${groupName(g)}</span>
      <span class="admin-group-meta">${[
        tn(inGroup.length, '{n} setting', '{n} settings'),
        changed && tn(changed, '{n} changed from the default', '{n} changed from the default'),
        waiting && tn(waiting, '{n} waiting for the bot', '{n} waiting for the bot'),
      ].filter(Boolean).join(' · ')}</span>
      <span class="admin-group-edits" data-edits></span>${CHEVRON}`;
  };
  const groupCard = g => html`<details class="admin-group" data-group="${g}">
    <summary class="admin-group-head" id="g-${keyId(g)}">${groupSummary(g)}</summary>
    <div class="admin-group-body">
      <div class="admin-settings">${groupRows(g)}</div>
      <div class="admin-save">${saveStep()}</div>
    </div>
  </details>`;
  const saveStep = (n = 0) => html`<div class="shop-step" data-step="save">
    <button class="btn btn-small" type="button" data-review ${n ? '' : raw('disabled')}>${t('Review changes…')}</button>
    <span class="faint small" data-count>${n ? tn(n, '{n} change', '{n} changes') : t('No changes')}</span>
    <p class="shop-error" role="alert" hidden></p>
  </div>`;

  // The actions: each a small form whose Review button checks it and shows a confirmation.
  const slotOptions = HILL_SLOTS.map(s => html`<option value="${s}">${SLOT_NAME[s]}</option>`);
  const tierOptions = HILL_TIERS.map(s => html`<option value="${s}">${TIER_NAME[s]}</option>`);
  const actionForm = (name, fields, buttons) => html`<div class="admin-action" data-action="${name}">
    <div class="shop-step" data-step="form">${fields}${buttons}<p class="shop-error" role="alert" hidden></p></div>
  </div>`;
  const review = (label, which = '', primary = false) => html`<button class="btn btn-small ${primary ? 'btn-primary' : ''}" type="button" data-review="${which}">${label}</button>`;

  const status = (st, code, reason) => (st === 'pending' ? html`<span class="req-status">${t('waiting for the bot, up to 15 minutes')}</span>`
    : st === 'accepted' ? html`<span class="req-status req-ok">✓ ${t('done')}</span>`
      : html`<span class="req-status req-no">✕ ${t('refused: {reason}', { reason: refusalText(code, reason) })}</span>`);
  const when = iso => { const s = Date.parse(iso) / 1000; return html`<span class="faint" title="${fmt.dateTime(s)}">${fmt.ago(s)}</span>`; };
  /** Your requests of some kinds still waiting for the bot, as lines at the top of their card (a listed bounty says it in its row). */
  const waitingList = prefix => {
    const waiting = requests.filter(r => r.status === 'pending' && r.type.startsWith(prefix) && !(r.type === 'admin.bounty.cancel' && listed.has(r.payload.id)));
    return waiting.length ? html`<ul class="req-list admin-waiting">${waiting.map(r => html`<li><span>${actionText(r.type, r.payload, index)}</span> ${status('pending')} ${when(r.t)}</li>`)}</ul>` : '';
  };

  const openBounties = (bountyData?.open ?? []).filter(r => Number.isSafeInteger(r[8]));
  const listed = new Set(openBounties.map(r => r[8]));

  // King of the hill's pool. A draft waits for an admin: then it's the first card, open, with Approve as the page's one
  // primary action. Once live, approve and redraft would only be refused, so the tools fold away.
  const month = hillData?.current ?? null;
  const draft = month?.status === 'draft';
  const poolTools = html`
    ${actionForm('approve', '', review(t('Approve the pool…'), '', draft))}
    ${actionForm('reroll', html`<div class="field"><label for="reroll-slot">${t('Slot')}</label><select class="select" id="reroll-slot">${slotOptions}</select></div>
      <div class="field"><label for="reroll-tier">${t('Tier')}</label><select class="select" id="reroll-tier">${tierOptions}</select></div>`, review(t('Reroll…')))}
    ${actionForm('redraft', '', review(t('Redraft the pool…')))}`;
  const poolCard = () => html`<section class="section card admin-card ${draft ? 'admin-attention' : ''}" id="admin-pool" aria-labelledby="admin-pool-h">
    <h2 class="card-h" id="admin-pool-h">${draft ? t('King of the hill pool: waiting for approval') : t('King of the hill pool')}</h2>
    <div data-waiting="admin.hill.">${waitingList('admin.hill.')}</div>
    ${draft ? html`<p>${t('{month}’s pool is drafted but not live. Look it over in Discord with !hill pool, then approve it, reroll a slot or draft it again.', { month: monthLabel(month.month) })}</p>${poolTools}`
      : html`${month ? html`<p class="muted small">${t('{month}’s pool is live.', { month: monthLabel(month.month) })}</p>` : ''}
        <details class="admin-fold"><summary>${t('Pool tools')}${CHEVRON}</summary>${poolTools}</details>`}
  </section>`;

  // Open bounties, each with its own Cancel; the ones with a cancel already waiting say so instead.
  const cancelWaiting = id => requests.some(r => r.status === 'pending' && r.type === 'admin.bounty.cancel' && r.payload.id === id);
  const bountyRow = r => {
    const [mapId, , goal, , , , , , id, pot, , poster, expires] = r;
    const what = html`<span class="admin-bounty-what"><span><b>#${id}</b> ${GOAL_LABEL[goal] ?? goal} · <a href="/map/${mapId}">${mapLabel(mapId, bountyData.maps?.[mapId])}</a></span>
      <span class="faint small">${[pot ? t('{amount} pot', { amount: bananas(pot) }) : '', poster ? index.get(poster)?.name ?? '' : t('house bounty'), expires ? t('ends {date}', { date: fmt.date(expires) }) : ''].filter(Boolean).join(' · ')}</span></span>`;
    if (cancelWaiting(id)) return html`<li class="admin-bounty">${what}${status('pending')}</li>`;
    return html`<li class="admin-bounty admin-action" data-action="cancel" data-id="${id}">${what}
      <div class="shop-step" data-step="form">
        <label class="admin-toggle"><input type="checkbox" class="cancel-refund" checked> <span>${t('Refund everyone')}</span></label>
        ${review(t('Cancel…'))}<p class="shop-error" role="alert" hidden></p>
      </div></li>`;
  };
  const bountyCard = () => html`<section class="section card admin-card" id="admin-bounties" aria-labelledby="admin-bounties-h">
    <h2 class="card-h" id="admin-bounties-h">${t('Open bounties')} <span class="faint">${openBounties.length}</span></h2>
    <div data-waiting="admin.bounty.">${waitingList('admin.bounty.')}</div>
    ${openBounties.length ? html`<ul class="admin-bounties">${openBounties.map(bountyRow)}</ul>` : html`<p class="muted small">${t('No open bounties.')}</p>`}
    <details class="admin-fold"><summary>${t('Cancel another bounty by number')}${CHEVRON}</summary>
      ${actionForm('cancel', html`<div class="field"><label for="cancel-id">${t('Bounty #')}</label><input class="input admin-num cancel-id" type="number" id="cancel-id" inputmode="numeric" min="1" step="1"></div>
        <label class="admin-toggle"><input type="checkbox" class="cancel-refund" checked> <span>${t('Refund everyone, the fee included')}</span></label>`, review(t('Cancel the bounty…')))}
    </details>
  </section>`;

  const toolsCard = html`<section class="section card admin-card" id="admin-tools" aria-labelledby="admin-tools-h">
    <h2 class="card-h" id="admin-tools-h">${t('Players and maps')}</h2>
    <div data-waiting="admin.bananas.">${waitingList('admin.bananas.')}</div>
    <div data-waiting="admin.map.">${waitingList('admin.map.')}</div>
    ${actionForm('adjust', html`<div class="field"><label for="adjust-who">${t('Player')}</label>${playerPicker('adjust-who', list)}</div>
      <div class="field"><label for="adjust-amount">${t('Bananas (− to take)')}</label><input class="input admin-num" type="number" id="adjust-amount" inputmode="numeric" step="1"></div>
      <div class="field"><label for="adjust-note">${t('Note')}</label><input class="input" type="text" id="adjust-note" maxlength="100" placeholder="${t('admin correction')}"></div>`, review(t('Adjust…')))}
    ${actionForm('map', html`<div class="field"><label for="map-id">${t('Beatmap id or link')}</label><input class="input" type="text" id="map-id" autocomplete="off"></div>`,
      html`${review(t('Ban…'), 'ban')}${review(t('Unban…'), 'unban')}`)}
  </section>`;

  // The log: your requests the bot hasn't logged yet, then the bot's log; the first LOG_SHOWN until asked for more.
  const logged = new Set((panel?.actions ?? []).map(a => a.requestId).filter(Boolean));
  let logAll = false;
  const logList = () => {
    const own = requests.filter(r => r.status === 'pending' || !logged.has(r.requestId));
    const rows = [
      ...own.map(r => html`<li class="${r.status === 'pending' ? 'admin-pending' : ''}"><span>${actionText(r.type, r.payload, index)}</span>
        ${status(r.status, r.code, r.reason)} <span class="faint">${t('you')}</span> ${when(r.t)}</li>`),
      ...(panel?.actions ?? []).slice(0, LOG_LIMIT).map(a => html`<li><span>${actionText(a.kind, a.args, index)}</span>
        ${status(a.status, a.code, a.reason)} <span class="faint">${a.name}${a.via === 'discord' ? ` · ${t('via Discord')}` : ''}</span> ${when(a.at)}</li>`),
    ];
    if (!rows.length) return empty(t('Nothing yet.'));
    const shown = logAll ? rows : rows.slice(0, LOG_SHOWN);
    return html`<ul class="req-list admin-log">${shown}</ul>${rows.length > shown.length
      ? html`<button class="btn btn-small" type="button" data-log-all>${t('Show all {n}', { n: rows.length })}</button>` : ''}`;
  };

  const settingsSection = html`<section class="section" id="admin-settings" aria-labelledby="admin-settings-h">
    <div class="admin-settings-head">
      <h2 id="admin-settings-h">${t('Settings')}</h2>
      ${panel?.generatedAt ? html`<span class="muted small">${t('as the bot last published them, {ago}', { ago: fmt.ago(panel.generatedAt) })}</span>` : ''}
    </div>
    <div class="admin-filter">
      <div class="field"><label for="admin-find">${t('Find a setting')}</label><input class="input" type="search" id="admin-find" autocomplete="off" placeholder="${t('e.g. stars, tip, shop')}"></div>
      <label class="admin-toggle"><input type="checkbox" id="admin-changed-only"> <span>${t('Only the ones changed from the default')}</span></label>
    </div>
    <p class="muted small" id="admin-find-none" hidden>${t('No setting matches.')}</p>
    ${groups.map(groupCard)}
  </section>`;

  root.innerHTML = String(html`${head}
    ${poolCard()}
    ${bountyCard()}
    ${toolsCard}
    ${panel ? settingsSection : html`<p class="notice">${t('The bot hasn’t published its settings yet, so only the actions are here.')}</p>`}
    <section class="section card" id="admin-log" aria-labelledby="admin-log-h"><h2 class="card-h" id="admin-log-h">${t('Log')}</h2><div data-log>${logList()}</div></section>`);

  const drawLog = () => { root.querySelector('[data-log]').innerHTML = String(logList()); };
  root.querySelector('[data-log]').addEventListener('click', e => {
    if (!e.target.closest('[data-log-all]')) return;
    logAll = true;
    drawLog();
    root.querySelectorAll('.admin-log li')[LOG_SHOWN]?.setAttribute('tabindex', '-1');
    root.querySelectorAll('.admin-log li')[LOG_SHOWN]?.focus();
  });
  const noteSent = sent => {
    requests = [...[...sent].reverse().map(([type, payload, requestId]) => ({ requestId, type, payload, status: 'pending', t: new Date().toISOString(), code: null, reason: null })), ...requests];
    drawLog();
    for (const box of root.querySelectorAll('[data-waiting]')) box.innerHTML = String(waitingList(box.dataset.waiting));
  };

  // ---- Finding a setting: filters rows across groups and opens the groups with a match ----

  const find = root.querySelector('#admin-find');
  const changedOnly = root.querySelector('#admin-changed-only');
  const filter = () => {
    const q = find.value.trim().toLowerCase();
    // Each word typed must start a word of the description or key ("tip" finds tips, not "multiplier").
    const terms = q.split(/\s+/).filter(Boolean);
    const matches = text => {
      const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
      return terms.every(term => words.some(w => w.startsWith(term)));
    };
    const only = changedOnly.checked;
    let any = false;
    for (const card of root.querySelectorAll('.admin-group')) {
      let hits = 0;
      for (const row of card.querySelectorAll('.admin-setting')) {
        const all = rowSettings(row);
        const hit = (!q || matches(all.map(s => `${describe(s)} ${s.key}`).join(' '))) && (!only || all.some(s => s.overridden) || row.classList.contains('admin-dirty'));
        row.hidden = !hit;
        hits += hit;
      }
      card.hidden = !hits;
      if (q || only) card.open = hits > 0;
      any ||= hits > 0;
    }
    root.querySelector('#admin-find-none').hidden = any;
  };
  find?.addEventListener('input', filter);
  changedOnly?.addEventListener('change', filter);

  // ---- Star band sliders: a thumb never passes the other; a press anywhere on the track moves the nearer one ----

  root.querySelectorAll('.admin-stars').forEach(paintRange);
  // Capturing, so the thumb is in place before the group's own input listener counts the changes.
  root.addEventListener('input', e => {
    const input = e.target.closest?.('.admin-stars input');
    if (input) moveThumb(input, Number(input.value));
  }, true);
  root.addEventListener('pointerdown', e => {
    const range = e.target.closest?.('.admin-stars');
    if (!range || e.button !== 0) return;
    e.preventDefault();
    const [a, b] = thumbs(range);
    const track = range.querySelector('.range-track').getBoundingClientRect();
    const at = x => Number(a.min) + (x - track.left) / track.width * (Number(a.max) - Number(a.min));
    const v = at(e.clientX);
    const [lo, hi] = [Number(a.value), Number(b.value)];
    const input = v <= lo || (v < hi && v - lo < hi - v) ? a : b;
    input.focus({ preventScroll: true });
    const go = x => {
      moveThumb(input, at(x));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    go(e.clientX);
    range.setPointerCapture(e.pointerId);
    const move = ev => go(ev.clientX);
    const end = () => {
      range.removeEventListener('pointermove', move);
      range.removeEventListener('pointerup', end);
      range.removeEventListener('pointercancel', end);
    };
    range.addEventListener('pointermove', move);
    range.addEventListener('pointerup', end);
    range.addEventListener('pointercancel', end);
  });

  // ---- Settings: what changed, review, send ----

  const changes = card => [...card.querySelectorAll('.admin-setting')].flatMap(row => {
    if (row.dataset.max) return bandChanges(row);
    const s = byKey.get(row.dataset.key);
    const got = read(s, row);
    if (got.error) return { s, row, error: got.error };
    if (same(got.value, s.value) && !resets.has(s.key)) return null;
    // Back to the default on an overridden setting is a reset; anything else is a set.
    const reset = s.overridden && same(got.value, s.default);
    return { s, row, value: got.value, reset };
  }).filter(Boolean);

  // A band's edges that moved. The bot checks each against the other's current value, so a band moved up past its old
  // top sends the new top first.
  const bandChanges = row => {
    const [min, max] = rowSettings(row);
    const [lo, hi] = thumbs(row.querySelector('.admin-stars')).map(i => Number(i.value));
    const list = [[min, lo], [max, hi]].filter(([s, v]) => !same(v, s.value) || resets.has(s.key))
      .map(([s, v]) => ({ s, row, value: v, reset: s.overridden && same(v, s.default) }));
    return list.length === 2 && lo >= max.value ? list.reverse() : list;
  };

  const refresh = card => {
    const list = changes(card);
    for (const row of card.querySelectorAll('.admin-setting')) {
      const c = list.find(x => x.row === row);
      row.classList.toggle('admin-dirty', Boolean(c));
      const err = row.querySelector('.admin-error');
      err.hidden = !c?.error;
      err.textContent = c?.error ?? '';
      row.querySelectorAll('input').forEach(i => (c?.error ? i.setAttribute('aria-invalid', 'true') : i.removeAttribute('aria-invalid')));
    }
    const edits = card.querySelector('[data-edits]');
    if (edits) edits.textContent = list.length ? tn(list.length, '{n} edit not sent', '{n} edits not sent') : '';
    const step = card.querySelector('[data-step="save"]');
    if (!step) return list;
    const n = list.length;
    step.querySelector('[data-review]').disabled = !n;
    step.querySelector('[data-count]').textContent = n ? tn(n, '{n} change', '{n} changes') : t('No changes');
    return list;
  };

  const confirmChanges = list => html`<div class="shop-step shop-confirm" data-step="confirm">
    <p>${tn(list.length, 'Send this change to the bot?', 'Send these {n} changes to the bot?')}</p>
    <ul class="admin-diff">${list.map(c => html`<li><code>${c.s.key}</code> ${valueText(c.s.value)} → <b>${valueText(c.value)}</b>${c.reset ? html` <span class="faint">(${t('the default')})</span>` : ''}</li>`)}</ul>
    <div class="btn-row"><button class="btn btn-small btn-primary" type="button" data-send>${t('Send')}</button><button class="btn btn-small" type="button" data-back>${t('Back')}</button></div>
    <p class="shop-error" role="alert" hidden></p>
  </div>`;

  const backToSave = (card, focus = true) => {
    const save = card.querySelector('.admin-save');
    save.innerHTML = String(saveStep());
    refresh(card);
    if (focus) save.querySelector('[data-review]:not(:disabled)')?.focus();
  };

  for (const card of root.querySelectorAll('.admin-group')) {
    card.addEventListener('input', () => { if (card.querySelector('[data-step="save"]')) refresh(card); });
    card.addEventListener('change', () => { if (card.querySelector('[data-step="save"]')) refresh(card); });
    closeOnEscape(card, () => { if (card.querySelector('[data-step="confirm"]')) backToSave(card); });
    card.addEventListener('click', async e => {
      const resetBtn = e.target.closest('[data-reset]');
      if (resetBtn) {
        // Reset puts the default in the field; it's sent with the card's other changes.
        const row = resetBtn.closest('.admin-setting');
        const s = byKey.get(row.dataset.key);
        if (row.dataset.max) {
          const max = byKey.get(row.dataset.max);
          for (const edge of [s, max]) if (edge.overridden) resets.add(edge.key);
          row.querySelector('.admin-setting-field').innerHTML = String(rangeField(s, max, [s.default, max.default]));
          paintRange(row.querySelector('.admin-stars'));
          refresh(card);
          row.querySelector('input')?.focus();
          return;
        }
        resets.add(s.key);
        row.querySelector('.admin-setting-field').innerHTML = String(field(s, s.default));
        refresh(card);
        row.querySelector('input')?.focus();
        return;
      }
      if (e.target.closest('[data-review]')) {
        const list = refresh(card);
        const bad = list.find(c => c.error);
        if (bad) {
          const step = card.querySelector('[data-step="save"] .shop-error');
          step.hidden = false;
          step.textContent = t('Fix the highlighted values first.');
          bad.row.querySelector('input')?.focus();
          return;
        }
        if (!list.length) return;
        card.querySelector('.admin-save').innerHTML = String(confirmChanges(list));
        card.querySelector('[data-send]').focus();
        return;
      }
      if (e.target.closest('[data-back]')) return backToSave(card);
      const send = e.target.closest('[data-send]');
      if (!send || send.disabled) return;
      send.disabled = true;
      const list = changes(card).filter(c => !c.error);
      const sent = [];
      let failed = '';
      for (const c of list) {
        const [type, payload] = c.reset ? ['admin.reset', { key: c.s.key }] : ['admin.set', { key: c.s.key, value: c.value }];
        const res = await sendAdmin(type, payload);
        if (!res.ok) { failed = res.message; break; }
        sent.push([type, payload, res.requestId]);
        resets.delete(c.s.key);
      }
      if (sent.length) {
        noteSent(sent);
        sentToast(sent.length);
        announce(tn(sent.length, '{n} change sent to the bot.', '{n} changes sent to the bot.'));
        // Every field goes back to the bot's value, with what was sent showing as waiting.
        const g = card.dataset.group;
        card.querySelector('.admin-settings').innerHTML = String(html`${groupRows(g)}`);
        card.querySelectorAll('.admin-stars').forEach(paintRange);
        card.querySelector('summary').innerHTML = String(groupSummary(g));
      }
      if (failed) {
        // Stay on the confirmation with what's left, saying why.
        const left = changes(card).filter(c => !c.error);
        card.querySelector('.admin-save').innerHTML = String(left.length ? confirmChanges(left) : saveStep());
        const err = card.querySelector('.admin-save .shop-error');
        err.hidden = false;
        err.textContent = failed;
        return;
      }
      backToSave(card, false);
      card.querySelector('summary').focus();
    });
  }

  // ---- Actions ----

  /** What an action form asks for: { type, payload, text } or { error }. */
  const actionOf = (form, which) => {
    switch (form.dataset.action) {
      case 'approve': return { type: 'admin.hill.approve', payload: {} };
      case 'redraft': return { type: 'admin.hill.redraft', payload: {}, note: t('This throws the current draft away and drafts a new pool.') };
      case 'reroll': return { type: 'admin.hill.reroll', payload: { slot: form.querySelector('#reroll-slot').value, tier: form.querySelector('#reroll-tier').value } };
      case 'cancel': {
        const id = Number(form.dataset.id ?? form.querySelector('.cancel-id').value);
        if (!Number.isSafeInteger(id) || id < 1) return { error: t('Enter the bounty’s number.'), focus: '.cancel-id' };
        const refund = form.querySelector('.cancel-refund').checked;
        return { type: 'admin.bounty.cancel', payload: { id, refund }, note: refund ? '' : t('Without refunds, the bananas in it stay burned.') };
      }
      case 'adjust': {
        const who = pickedPlayer(form.querySelector('#adjust-who'), list);
        if (!who) return { error: t('Pick a player from the list.'), focus: '#adjust-who' };
        const amount = Number(form.querySelector('#adjust-amount').value);
        if (!Number.isSafeInteger(amount) || amount === 0) return { error: t('Enter a whole amount other than 0 (− to take).'), focus: '#adjust-amount' };
        const note = form.querySelector('#adjust-note').value.trim();
        return { type: 'admin.bananas.adjust', payload: { osuId: who.id, amount, ...(note ? { note } : {}) }, note: note ? t('Note: {note}', { note }) : '' };
      }
      case 'map': {
        const beatmapId = mapIdFrom(form.querySelector('#map-id').value);
        if (!beatmapId) return { error: t('Paste a beatmap id or an osu! beatmap link.'), focus: '#map-id' };
        return { type: which === 'unban' ? 'admin.map.unban' : 'admin.map.ban', payload: { beatmapId }, note: which === 'unban' ? t('An unban recalculates pp for every play on the map, which costs osu! requests.') : '' };
      }
      default: return { error: '' };
    }
  };

  const confirmAction = a => html`<div class="shop-step shop-confirm" data-step="confirm">
    <p>${th('{action}: send to the bot?', { action: actionText(a.type, a.payload, index) })}</p>
    ${a.note ? html`<p class="muted small">${a.note}</p>` : ''}
    <div class="btn-row"><button class="btn btn-small btn-primary" type="button" data-send>${t('Send')}</button><button class="btn btn-small" type="button" data-back>${t('Back')}</button></div>
    <p class="shop-error" role="alert" hidden></p>
  </div>`;

  for (const box of root.querySelectorAll('.admin-action')) {
    const form = box.querySelector('[data-step="form"]');
    let pick = null;
    let opener = null;
    const back = () => {
      box.querySelector('[data-step="confirm"]')?.remove();
      form.hidden = false;
      (opener ?? form.querySelector('[data-review]'))?.focus();
    };
    closeOnEscape(box, () => { if (box.querySelector('[data-step="confirm"]')) back(); });
    box.addEventListener('click', async e => {
      const reviewBtn = e.target.closest('[data-review]');
      if (reviewBtn) {
        const a = actionOf(box, reviewBtn.dataset.review);
        const err = form.querySelector('.shop-error');
        err.hidden = !a.error;
        err.textContent = a.error ?? '';
        if (a.error) { box.querySelector(a.focus)?.focus(); return; }
        pick = a;
        opener = reviewBtn;
        form.hidden = true;
        box.insertAdjacentHTML('beforeend', String(confirmAction(a)));
        box.querySelector('[data-send]').focus();
        return;
      }
      if (e.target.closest('[data-back]')) return back();
      const send = e.target.closest('[data-send]');
      if (!send || send.disabled || !pick) return;
      send.disabled = true;
      const res = await sendAdmin(pick.type, pick.payload);
      if (!res.ok) {
        send.disabled = false;
        const err = box.querySelector('[data-step="confirm"] .shop-error');
        err.hidden = false;
        err.textContent = res.message;
        return;
      }
      noteSent([[pick.type, pick.payload, res.requestId]]);
      sentToast(1);
      announce(t('Sent to the bot.'));
      if (box.dataset.id) {
        // A listed bounty: its row now just says it's waiting.
        box.querySelector('[data-step="confirm"]').remove();
        form.remove();
        box.insertAdjacentHTML('beforeend', String(status('pending')));
        box.closest('.admin-card').querySelector('h2').setAttribute('tabindex', '-1');
        box.closest('.admin-card').querySelector('h2').focus();
        return;
      }
      box.querySelector('[data-step="confirm"]').remove();
      form.hidden = false;
      form.querySelectorAll('input[type=text], input[type=number]').forEach(i => { i.value = ''; });
      opener?.focus();
    });
  }
}
