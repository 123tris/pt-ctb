// The admin panel's browser half: finding a setting, the star band sliders, each settings card's review and send, each
// action's two steps, and the log's "Show all". The admin's own requests go through client/bananas.ts api(): the
// list is fetched with the page's data (myAdminRequests(), for the entry), and each change or action is sent on its
// own (sendAdmin()). What's sent shows as waiting for the bot at once, in the log and at the top of its card. Esc steps
// back from a confirmation, as in the shop.

import { html } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { announce } from '../client/ui.ts';
import { api, closeOnEscape } from '../client/bananas.ts';
import { toast } from '../client/fun.ts';
import { track } from '../client/track.ts';
import { describe, problemText, sentText, type ActionArgs, type AdminRequest, type Setting } from '../ui/admin.ts';
import {
  LOG_SHOWN, actionOf, adminOf, checkValue, confirmAction, confirmChanges, field, groupRows, groupSummary, logList, rangeField,
  saveStep, starsText, status, viewOf, waitingList, type Action, type ActionFields, type Change, type Data, type Mine,
} from './admin.ts';

/** The signed-in admin's own admin requests, newest first: `status` 403 means not an admin. */
export async function myAdminRequests(): Promise<Mine> {
  const res = await api('/api/admin/requests');
  return { ok: res.ok, status: res.status, requests: res.ok ? (res.body as { requests: AdminRequest[] }).requests : [] };
}

/** Sends one admin request: { ok, requestId, message }. Toasts nothing; the page says what's waiting. */
async function sendAdmin(ctx: Ctx, type: string, payload: ActionArgs): Promise<{ ok: boolean; requestId: string; message: string }> {
  const res = await api('/api/admin/request', { method: 'POST', body: { type, payload } });
  track('use', 'admin', type);
  return res.ok ? { ok: true, requestId: (res.body as { requestId: string }).requestId, message: '' }
    : { ok: false, requestId: '', message: problemText(ctx, res.status, res.body as { error?: string } | null) };
}

/** A settings row's change: what `Change` sends, its row, or why its field can't be sent. */
interface RowChange extends Change {
  row: HTMLElement;
  error?: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const thumbs = (range: Element) => [...range.querySelectorAll<HTMLInputElement>('input')];

export function mount(root: HTMLElement, ctx: Ctx, data: Data): void {
  if (viewOf(ctx, data) !== 'panel') return;
  const { t, tn } = ctx;
  const m = adminOf(data.loaded!);
  const { byKey } = m;
  // Values picked to go back to the default with Reset: sent as admin.reset rather than admin.set.
  const resets = new Set<string>();

  // ---- The log, and what was just sent ----

  let logAll = false;
  const drawLog = () => { root.querySelector('[data-log]')!.innerHTML = String(logList(ctx, m, logAll)); };
  root.querySelector('[data-log]')!.addEventListener('click', e => {
    if (!(e.target as Element).closest('[data-log-all]')) return;
    logAll = true;
    drawLog();
    // Focus goes to the first line that wasn't there, as the button that was is gone.
    const first = root.querySelectorAll<HTMLElement>('.admin-log li')[LOG_SHOWN];
    first?.setAttribute('tabindex', '-1');
    first?.focus();
  });
  /** Requests just sent, [type, payload, requestId] in the order sent: waiting for the bot, first in the log. */
  const noteSent = (sent: [string, ActionArgs, string][]) => {
    const added = [...sent].reverse().map(([type, payload, requestId]): AdminRequest => ({
      requestId, type, payload, status: 'pending', t: new Date().toISOString(), code: null, reason: null,
    }));
    m.requests = [...added, ...m.requests];
    drawLog();
    for (const box of root.querySelectorAll<HTMLElement>('[data-waiting]')) box.innerHTML = String(waitingList(ctx, m, box.dataset.waiting!));
  };

  // ---- Finding a setting: filters rows across groups and opens the groups with a match ----

  const rowSettings = (row: HTMLElement) => [row.dataset.key, row.dataset.max].filter(Boolean).map(k => byKey.get(k!)!);
  const find = root.querySelector<HTMLInputElement>('#admin-find');
  const changedOnly = root.querySelector<HTMLInputElement>('#admin-changed-only');
  const filter = () => {
    const q = find!.value.trim().toLowerCase();
    // Each word typed must start a word of the description or key ("tip" finds tips, not "multiplier").
    const terms = q.split(/\s+/).filter(Boolean);
    const matches = (text: string) => {
      const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
      return terms.every(term => words.some(w => w.startsWith(term)));
    };
    const only = changedOnly!.checked;
    let any = false;
    for (const card of root.querySelectorAll<HTMLDetailsElement>('.admin-group')) {
      let hits = 0;
      for (const row of card.querySelectorAll<HTMLElement>('.admin-setting')) {
        const all = rowSettings(row);
        const hit = (!q || matches(all.map(s => `${describe(ctx, s)} ${s.key}`).join(' ')))
          && (!only || all.some(s => s.overridden) || row.classList.contains('admin-dirty'));
        row.hidden = !hit;
        hits += Number(hit);
      }
      card.hidden = !hits;
      if (q || only) card.open = hits > 0;
      any ||= hits > 0;
    }
    root.querySelector<HTMLElement>('#admin-find-none')!.hidden = any;
  };
  find?.addEventListener('input', filter);
  changedOnly?.addEventListener('change', filter);

  // ---- Star band sliders: a thumb never passes the other; a press anywhere on the track moves the nearer one ----

  /** Draws a slider's fill, readout and spoken values from its thumbs. */
  const paintRange = (range: HTMLElement) => {
    const [lo, hi] = thumbs(range);
    const at = (i: HTMLInputElement) => `${(Number(i.value) - Number(i.min)) / (Number(i.max) - Number(i.min)) * 100}%`;
    range.style.setProperty('--lo', at(lo));
    range.style.setProperty('--hi', at(hi));
    for (const i of [lo, hi]) i.setAttribute('aria-valuetext', t('{n} stars', { n: Number(i.value).toLocaleString(ctx.locale) }));
    range.parentElement!.querySelector('[data-out]')!.textContent = starsText(ctx, [Number(lo.value), Number(hi.value)]);
  };
  /** Moves one thumb to `v`, in steps and a step short of the other, so the band never turns upside down. */
  const moveThumb = (input: HTMLInputElement, v: number) => {
    const range = input.closest<HTMLElement>('.admin-stars')!;
    const [lo, hi] = thumbs(range);
    const step = Number(input.step) || 0.1;
    const snap = (x: number) => Math.round(Math.min(Number(input.max), Math.max(Number(input.min), x)) / step) * step;
    const value = input === lo ? Math.min(snap(v), Number(hi.value) - step) : Math.max(snap(v), Number(lo.value) + step);
    input.value = String(Math.round(value * 100) / 100);
    paintRange(range);
  };

  root.querySelectorAll<HTMLElement>('.admin-stars').forEach(paintRange);
  // Capturing, so the thumb is in place before the group's own input listener counts the changes.
  root.addEventListener('input', e => {
    const input = (e.target as Element).closest?.<HTMLInputElement>('.admin-stars input');
    if (input) moveThumb(input, Number(input.value));
  }, true);
  root.addEventListener('pointerdown', e => {
    const range = (e.target as Element).closest?.<HTMLElement>('.admin-stars');
    if (!range || e.button !== 0) return;
    e.preventDefault();
    const [lo, hi] = thumbs(range);
    const track = range.querySelector('.range-track')!.getBoundingClientRect();
    const at = (x: number) => Number(lo.min) + (x - track.left) / track.width * (Number(lo.max) - Number(lo.min));
    const v = at(e.clientX);
    const [a, b] = [Number(lo.value), Number(hi.value)];
    const input = v <= a || (v < b && v - a < b - v) ? lo : hi;
    input.focus({ preventScroll: true });
    const go = (x: number) => {
      moveThumb(input, at(x));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    go(e.clientX);
    range.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => go(ev.clientX);
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

  /** A setting's field, checked: { value } or { error }. */
  const read = (s: Setting, row: HTMLElement) => {
    if (s.type === 'bool') return checkValue(ctx, s, row.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked);
    if (s.type === 'intList') {
      return checkValue(ctx, s, s.length ? [...row.querySelectorAll<HTMLInputElement>('input[data-i]')].map(i => i.value.trim())
        : row.querySelector<HTMLInputElement>('.admin-text')!.value.split(',').map(x => x.trim()).filter(Boolean));
    }
    return checkValue(ctx, s, row.querySelector<HTMLInputElement>('.admin-num')!.value.trim());
  };

  // A band's edges that moved. The bot checks each against the other's current value, so a band moved up past its old
  // top sends the new top first.
  const bandChanges = (row: HTMLElement): RowChange[] => {
    const [min, max] = rowSettings(row);
    const [lo, hi] = thumbs(row.querySelector('.admin-stars')!).map(i => Number(i.value));
    const list = ([[min, lo], [max, hi]] as [Setting, number][]).filter(([s, v]) => !same(v, s.value) || resets.has(s.key))
      .map(([s, v]) => ({ s, row, value: v, reset: s.overridden && same(v, s.default) }));
    return list.length === 2 && lo >= (max.value as number) ? list.reverse() : list;
  };

  const changes = (card: HTMLElement): RowChange[] => [...card.querySelectorAll<HTMLElement>('.admin-setting')].flatMap((row): RowChange[] => {
    if (row.dataset.max) return bandChanges(row);
    const s = byKey.get(row.dataset.key!)!;
    const got = read(s, row);
    if (got.error !== undefined) return [{ s, row, error: got.error }];
    if (same(got.value, s.value) && !resets.has(s.key)) return [];
    // Back to the default on an overridden setting is a reset; anything else is a set.
    return [{ s, row, value: got.value, reset: s.overridden && same(got.value, s.default) }];
  });

  /** Marks the card's edited and invalid rows, and counts its changes; returns them. */
  const refresh = (card: HTMLElement): RowChange[] => {
    const list = changes(card);
    for (const row of card.querySelectorAll<HTMLElement>('.admin-setting')) {
      const c = list.find(x => x.row === row);
      row.classList.toggle('admin-dirty', Boolean(c));
      const err = row.querySelector<HTMLElement>('.admin-error')!;
      err.hidden = !c?.error;
      err.textContent = c?.error ?? '';
      row.querySelectorAll('input').forEach(i => (c?.error ? i.setAttribute('aria-invalid', 'true')
        : i.removeAttribute('aria-invalid')));
    }
    const edits = card.querySelector('[data-edits]');
    if (edits) edits.textContent = list.length ? tn(list.length, '{n} edit not sent', '{n} edits not sent') : '';
    const step = card.querySelector('[data-step="save"]');
    if (!step) return list;
    const n = list.length;
    step.querySelector<HTMLButtonElement>('[data-review]')!.disabled = !n;
    step.querySelector('[data-count]')!.textContent = n ? tn(n, '{n} change', '{n} changes') : t('No changes');
    return list;
  };

  const backToSave = (card: HTMLElement, focus = true) => {
    const save = card.querySelector<HTMLElement>('.admin-save')!;
    save.innerHTML = String(saveStep(ctx));
    refresh(card);
    if (focus) save.querySelector<HTMLElement>('[data-review]:not(:disabled)')?.focus();
  };

  for (const card of root.querySelectorAll<HTMLElement>('.admin-group')) {
    card.addEventListener('input', () => { if (card.querySelector('[data-step="save"]')) refresh(card); });
    card.addEventListener('change', () => { if (card.querySelector('[data-step="save"]')) refresh(card); });
    closeOnEscape(card, () => { if (card.querySelector('[data-step="confirm"]')) backToSave(card); });
    card.addEventListener('click', async e => {
      const target = e.target as Element;
      const resetButton = target.closest('[data-reset]');
      if (resetButton) {
        // Reset puts the default in the field; it's sent with the card's other changes.
        const row = resetButton.closest<HTMLElement>('.admin-setting')!;
        const s = byKey.get(row.dataset.key!)!;
        if (row.dataset.max) {
          const max = byKey.get(row.dataset.max)!;
          for (const edge of [s, max]) if (edge.overridden) resets.add(edge.key);
          const band = [s.default as number, max.default as number];
          row.querySelector('.admin-setting-field')!.innerHTML = String(rangeField(ctx, s, max, band));
          paintRange(row.querySelector<HTMLElement>('.admin-stars')!);
          refresh(card);
          row.querySelector('input')?.focus();
          return;
        }
        resets.add(s.key);
        row.querySelector('.admin-setting-field')!.innerHTML = String(field(ctx, s, s.default));
        refresh(card);
        row.querySelector('input')?.focus();
        return;
      }
      if (target.closest('[data-review]')) {
        const list = refresh(card);
        const bad = list.find(c => c.error);
        if (bad) {
          const step = card.querySelector<HTMLElement>('[data-step="save"] .shop-error')!;
          step.hidden = false;
          step.textContent = t('Fix the highlighted values first.');
          bad.row.querySelector('input')?.focus();
          return;
        }
        if (!list.length) return;
        card.querySelector('.admin-save')!.innerHTML = String(confirmChanges(ctx, list));
        card.querySelector<HTMLElement>('[data-send]')!.focus();
        return;
      }
      if (target.closest('[data-back]')) { backToSave(card); return; }
      const send = target.closest<HTMLButtonElement>('[data-send]');
      if (!send || send.disabled) return;
      send.disabled = true;
      const list = changes(card).filter(c => !c.error);
      const sent: [string, ActionArgs, string][] = [];
      let failed = '';
      for (const c of list) {
        const [type, payload]: [string, ActionArgs] = c.reset ? ['admin.reset', { key: c.s.key }]
          : ['admin.set', { key: c.s.key, value: c.value }];
        const res = await sendAdmin(ctx, type, payload);
        if (!res.ok) { failed = res.message; break; }
        sent.push([type, payload, res.requestId]);
        resets.delete(c.s.key);
      }
      if (sent.length) {
        noteSent(sent);
        toast(sentText(ctx, sent.length));
        announce(tn(sent.length, '{n} change sent to the bot.', '{n} changes sent to the bot.'));
        // Every field goes back to the bot's value, with what was sent showing as waiting.
        const group = card.dataset.group!;
        card.querySelector('.admin-settings')!.innerHTML = String(html`${groupRows(ctx, m, group)}`);
        card.querySelectorAll<HTMLElement>('.admin-stars').forEach(paintRange);
        card.querySelector('summary')!.innerHTML = String(groupSummary(ctx, m, group));
      }
      if (failed) {
        // Stay on the confirmation with what's left, saying why.
        const left = changes(card).filter(c => !c.error);
        card.querySelector('.admin-save')!.innerHTML = String(left.length ? confirmChanges(ctx, left) : saveStep(ctx));
        const err = card.querySelector<HTMLElement>('.admin-save .shop-error')!;
        err.hidden = false;
        err.textContent = failed;
        return;
      }
      backToSave(card, false);
      card.querySelector<HTMLElement>('summary')!.focus();
    });
  }

  // ---- Actions ----

  /** An action form's fields as they are now. */
  const fieldsOf = (box: HTMLElement): ActionFields => {
    const value = (selector: string) => box.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value;
    return {
      slot: value('#reroll-slot'), tier: value('#reroll-tier'),
      id: box.dataset.id ?? value('.cancel-id'), refund: box.querySelector<HTMLInputElement>('.cancel-refund')?.checked,
      who: value('#adjust-who'), amount: value('#adjust-amount'), note: value('#adjust-note'), map: value('#map-id'),
    };
  };

  for (const box of root.querySelectorAll<HTMLElement>('.admin-action')) {
    const form = box.querySelector<HTMLElement>('[data-step="form"]')!;
    let pick: Action | null = null;
    let opener: HTMLElement | null = null;
    const back = () => {
      box.querySelector('[data-step="confirm"]')?.remove();
      form.hidden = false;
      (opener ?? form.querySelector<HTMLElement>('[data-review]'))?.focus();
    };
    closeOnEscape(box, () => { if (box.querySelector('[data-step="confirm"]')) back(); });
    box.addEventListener('click', async e => {
      const target = e.target as Element;
      const reviewButton = target.closest<HTMLElement>('[data-review]');
      if (reviewButton) {
        const a = actionOf(ctx, m.players, box.dataset.action, reviewButton.dataset.review, fieldsOf(box));
        const err = form.querySelector<HTMLElement>('.shop-error')!;
        err.hidden = !a.error;
        err.textContent = a.error ?? '';
        if (a.error) { box.querySelector<HTMLElement>(a.focus!)?.focus(); return; }
        pick = a as Action;
        opener = reviewButton;
        form.hidden = true;
        box.insertAdjacentHTML('beforeend', String(confirmAction(ctx, m.players, pick)));
        box.querySelector<HTMLElement>('[data-send]')!.focus();
        return;
      }
      if (target.closest('[data-back]')) { back(); return; }
      const send = target.closest<HTMLButtonElement>('[data-send]');
      if (!send || send.disabled || !pick) return;
      send.disabled = true;
      const res = await sendAdmin(ctx, pick.type, pick.payload);
      if (!res.ok) {
        send.disabled = false;
        const err = box.querySelector<HTMLElement>('[data-step="confirm"] .shop-error')!;
        err.hidden = false;
        err.textContent = res.message;
        return;
      }
      noteSent([[pick.type, pick.payload, res.requestId]]);
      toast(sentText(ctx, 1));
      announce(t('Sent to the bot.'));
      if (box.dataset.id) {
        // A listed bounty: its row now just says it's waiting, and focus goes to its card's heading.
        box.querySelector('[data-step="confirm"]')!.remove();
        form.remove();
        box.insertAdjacentHTML('beforeend', String(status(ctx, 'pending')));
        const heading = box.closest('.admin-card')!.querySelector<HTMLElement>('h2')!;
        heading.setAttribute('tabindex', '-1');
        heading.focus();
        return;
      }
      box.querySelector('[data-step="confirm"]')!.remove();
      form.hidden = false;
      form.querySelectorAll<HTMLInputElement>('input[type=text], input[type=number]').forEach(i => { i.value = ''; });
      opener?.focus();
    });
  }
}
