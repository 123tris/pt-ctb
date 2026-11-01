// #/admin: the admin panel (contract §8), for the osu! ids the site and the bot list as admins. Nothing here changes
// anything by itself: every save or action is an admin.* request the bot takes from the inbox within 15 minutes, checks
// again and applies or refuses with a code. Anyone else, signed in or not, gets "Admins only" and no data.
//
// The page reads admin.json (the bot's settings schema, current values and log: core/admin.js) and the admin's own
// requests (/api/admin/requests), so a change shows as "waiting for the bot" until the bot's next pull and export.
//   Settings  one card per group, each setting with its value as a typed field (number, toggle or list), the default,
//             a "changed" mark and Reset when it's overridden, and when it takes effect. Each card saves on its own:
//             "Review changes" lists old → new, and "Send" queues one admin.set (or admin.reset, back to the default)
//             per changed key. Fields are checked against min, max, step and length first, for a clear error.
//   Actions   King of the hill's pool (approve, reroll one slot and tier, redraft), cancelling a bounty with or without
//             refunds, adjusting a player's bananas, banning or unbanning a map. Each takes two steps: review, then send.
//   Log       your requests still waiting for the bot first, then the bot's log of admin actions, refusals in words.
// Esc steps back from a confirmation, as in the shop.

import { html, raw } from '../core/html.js';
import { playerIndex, players } from '../core/data.js';
import { HILL_SLOTS, HILL_TIERS } from '../core/model.js';
import { SLOT_NAME, TIER_NAME } from '../core/hill.js';
import { setTitle, pageHead, empty, announce, playerPicker, pickedPlayer } from '../core/ui.js';
import { session, signInButton, mapIdFrom, closeOnEscape } from '../core/bananas.js';
import {
  adminPanel, isAdmin, myAdminRequests, sendAdmin, sentToast, GROUPS, groupName, EFFECTS, describe, valueText, actionText, refusalText,
} from '../core/admin.js';
import * as fmt from '../core/fmt.js';
import { t, th, tn } from '../core/i18n.js';

const LOG_LIMIT = 100;
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
  const [mine, panel, index, list] = await Promise.all([myAdminRequests(), adminPanel().catch(() => null), playerIndex(), players()]);
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

  const groupCard = g => html`<section class="section card admin-group" data-group="${g}" aria-labelledby="g-${keyId(g)}">
    <h2 class="card-h" id="g-${keyId(g)}">${groupName(g)}</h2>
    <div class="admin-settings">${settings.filter(s => s.group === g).map(settingRow)}</div>
    <div class="admin-save">${saveStep()}</div>
  </section>`;
  const saveStep = (n = 0) => html`<div class="shop-step" data-step="save">
    <button class="btn btn-small" type="button" data-review ${n ? '' : raw('disabled')}>${t('Review changes…')}</button>
    <span class="faint small" data-count>${n ? tn(n, '{n} change', '{n} changes') : t('No changes')}</span>
    <p class="shop-error" role="alert" hidden></p>
  </div>`;

  // The actions: each a small form whose Review button checks it and shows a confirmation.
  const slotOptions = HILL_SLOTS.map(s => html`<option value="${s}">${SLOT_NAME[s]}</option>`);
  const tierOptions = HILL_TIERS.map(s => html`<option value="${s}">${TIER_NAME[s]}</option>`);
  const actionCard = (title, intro, forms) => html`<section class="section card admin-actions"><h2 class="card-h">${title}</h2>${intro ? html`<p class="muted small">${intro}</p>` : ''}${forms}</section>`;
  const actionForm = (name, fields, buttons) => html`<div class="admin-action" data-action="${name}">
    <div class="shop-step" data-step="form">${fields}${buttons}<p class="shop-error" role="alert" hidden></p></div>
  </div>`;
  const review = (label, which = '') => html`<button class="btn btn-small" type="button" data-review="${which}">${label}</button>`;

  const actions = html`
    ${actionCard(t('King of the hill pool'), t('The same as !hill pool in Discord: approve this month’s draft, reroll one slot, or draft it again.'), html`
      ${actionForm('approve', '', review(t('Approve the pool…')))}
      ${actionForm('reroll', html`<div class="field"><label for="reroll-slot">${t('Slot')}</label><select class="select" id="reroll-slot">${slotOptions}</select></div>
        <div class="field"><label for="reroll-tier">${t('Tier')}</label><select class="select" id="reroll-tier">${tierOptions}</select></div>`, review(t('Reroll…')))}
      ${actionForm('redraft', '', review(t('Redraft the pool…')))}`)}
    ${actionCard(t('Bounties, bananas and maps'), '', html`
      ${actionForm('cancel', html`<div class="field"><label for="cancel-id">${t('Bounty #')}</label><input class="input admin-num" type="number" id="cancel-id" inputmode="numeric" min="1" step="1"></div>
        <label class="admin-toggle"><input type="checkbox" id="cancel-refund" checked> <span>${t('Refund everyone, the fee included')}</span></label>`, review(t('Cancel the bounty…')))}
      ${actionForm('adjust', html`<div class="field"><label for="adjust-who">${t('Player')}</label>${playerPicker('adjust-who', list)}</div>
        <div class="field"><label for="adjust-amount">${t('Amount (− to take)')}</label><input class="input admin-num" type="number" id="adjust-amount" inputmode="numeric" step="1"></div>
        <div class="field"><label for="adjust-note">${t('Note')}</label><input class="input" type="text" id="adjust-note" maxlength="100" placeholder="${t('admin correction')}"></div>`, review(t('Adjust…')))}
      ${actionForm('map', html`<div class="field"><label for="map-id">${t('Beatmap id or link')}</label><input class="input" type="text" id="map-id" autocomplete="off"></div>`,
        html`${review(t('Ban…'), 'ban')}${review(t('Unban…'), 'unban')}`)}`)}`;

  // The log: your requests the bot hasn't logged yet, then the bot's log.
  const logged = new Set((panel?.actions ?? []).map(a => a.requestId).filter(Boolean));
  const status = (st, code, reason) => (st === 'pending' ? html`<span class="req-status">${t('waiting for the bot, up to 15 minutes')}</span>`
    : st === 'accepted' ? html`<span class="req-status req-ok">✓ ${t('done')}</span>`
      : html`<span class="req-status req-no">✕ ${t('refused: {reason}', { reason: refusalText(code, reason) })}</span>`);
  const when = iso => { const s = Date.parse(iso) / 1000; return html`<span class="faint" title="${fmt.dateTime(s)}">${fmt.ago(s)}</span>`; };
  const logList = () => {
    const own = requests.filter(r => r.status === 'pending' || !logged.has(r.requestId));
    const rows = [
      ...own.map(r => html`<li class="${r.status === 'pending' ? 'admin-pending' : ''}"><span>${actionText(r.type, r.payload, index)}</span>
        ${status(r.status, r.code, r.reason)} <span class="faint">${t('you')}</span> ${when(r.t)}</li>`),
      ...(panel?.actions ?? []).slice(0, LOG_LIMIT).map(a => html`<li><span>${actionText(a.kind, a.args, index)}</span>
        ${status(a.status, a.code, a.reason)} <span class="faint">${a.name}${a.via === 'discord' ? ` · ${t('via Discord')}` : ''}</span> ${when(a.at)}</li>`),
    ];
    return rows.length ? html`<ul class="req-list admin-log">${rows}</ul>` : empty(t('Nothing yet.'));
  };

  root.innerHTML = String(html`${head}
    ${panel ? '' : html`<p class="notice">${t('The bot hasn’t published its settings yet, so only the actions are here.')}</p>`}
    ${panel?.generatedAt ? html`<p class="muted small">${t('Settings as the bot last published them, {ago}.', { ago: fmt.ago(panel.generatedAt) })}</p>` : ''}
    ${groups.map(groupCard)}
    ${actions}
    <section class="section card" id="admin-log" aria-labelledby="admin-log-h"><h2 class="card-h" id="admin-log-h">${t('Log')}</h2><div data-log>${logList()}</div></section>`);

  const drawLog = () => { root.querySelector('[data-log]').innerHTML = String(logList()); };
  const noteSent = sent => {
    requests = [...[...sent].reverse().map(([type, payload, requestId]) => ({ requestId, type, payload, status: 'pending', t: new Date().toISOString(), code: null, reason: null })), ...requests];
    drawLog();
  };

  // ---- Settings: what changed, review, send ----

  const changes = card => [...card.querySelectorAll('.admin-setting')].map(row => {
    const s = byKey.get(row.dataset.key);
    const got = read(s, row);
    if (got.error) return { s, row, error: got.error };
    if (same(got.value, s.value) && !resets.has(s.key)) return null;
    // Back to the default on an overridden setting is a reset; anything else is a set.
    const reset = s.overridden && same(got.value, s.default);
    return { s, row, value: got.value, reset };
  }).filter(Boolean);

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
        card.querySelector('.admin-settings').innerHTML = String(html`${settings.filter(s => s.group === g).map(settingRow)}`);
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
      card.querySelector('h2').setAttribute('tabindex', '-1');
      card.querySelector('h2').focus();
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
        const id = Number(form.querySelector('#cancel-id').value);
        if (!Number.isSafeInteger(id) || id < 1) return { error: t('Enter the bounty’s number.'), focus: '#cancel-id' };
        const refund = form.querySelector('#cancel-refund').checked;
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
      box.querySelector('[data-step="confirm"]').remove();
      form.hidden = false;
      form.querySelectorAll('input[type=text], input[type=number]').forEach(i => { i.value = ''; });
      opener?.focus();
    });
  }
}
