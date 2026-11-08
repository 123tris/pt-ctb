// /admin?tab=top10 in the browser: an action's reason box, the action itself (then the queue again from the server),
// the write-ups' filter, and finalize: the dry run first, and only then the real run, after a confirmation.

import type { Ctx } from '../kernel/ctx.ts';
import { html } from '../kernel/html.ts';
import { toast } from '../client/fun.ts';
import { setPressed } from '../client/dom.ts';
import { top10Api, problemText } from '../client/top10.ts';
import { finalizePreview, reasonForm, render, writeupList, type Data, type Queue, type WriteupFilter } from './top10-admin.ts';

/** Actions a player must be given a reason for. */
const NEEDS_REASON = new Set(['strike', 'hide-play', 'void']);

export function mount(root: HTMLElement, ctx: Ctx, d: Data): void {
  if (!d.queue) return;
  const { t, fmt } = ctx;
  let filter: WriteupFilter = 'flagged';
  let previewed = false;

  async function reload(): Promise<void> {
    const res = await top10Api(`/api/top10/admin/queue?kind=${d.kind}`);
    if (!res.ok) { toast(problemText(t, res)); return; }
    d.queue = res.body as Queue;
    const keep = root.querySelector('[data-preview]')?.innerHTML ?? '';
    root.innerHTML = String(render(ctx, d, filter));
    root.querySelector('[data-preview]')!.innerHTML = keep;
    if (previewed) root.querySelector<HTMLButtonElement>('[data-final]')!.disabled = false;
  }

  root.addEventListener('click', async ev => {
    const el = (ev.target as Element).closest<HTMLButtonElement>('button');
    if (!el) return;
    if (el.dataset.wfilter) {
      filter = el.dataset.wfilter as WriteupFilter;
      setPressed(root, 'wfilter', filter);
      root.querySelector('[data-writeups]')!.innerHTML = String(writeupList(ctx, d, filter));
      return;
    }
    if (el.dataset.act) {
      const slot = el.closest('[data-item]')?.querySelector<HTMLElement>('[data-reason-slot]') ?? el.parentElement!.querySelector<HTMLElement>('[data-reason-slot]');
      if (!slot) return;
      slot.innerHTML = String(reasonForm(ctx, el.dataset.act, el.dataset.target!, NEEDS_REASON.has(el.dataset.act)));
      slot.querySelector<HTMLInputElement>('input')!.focus();
      return;
    }
    if (el.hasAttribute('data-cancel')) { el.closest('[data-reason-slot]')!.innerHTML = ''; return; }
    if (el.hasAttribute('data-dry') || el.hasAttribute('data-final')) {
      const dryRun = el.hasAttribute('data-dry');
      if (!dryRun && !confirm(t('Finalize the results and queue the payouts? This happens once and can’t be undone.'))) return;
      el.disabled = true;
      const res = await top10Api('/api/top10/admin/finalize', { method: 'POST', body: { year: d.queue!.year, dryRun } });
      el.disabled = false;
      const box = root.querySelector('[data-preview]')!;
      // 409 turnout: neither ballot has 5 counted lists; the answer says how many each has (§13.11).
      const counts = res.body?.code === 'turnout' ? res.body?.ballots : null;
      const why = counts && typeof counts === 'object'
        ? t('Neither ballot has 5 counted lists: {year} yearly and {alltime} all-time. Nothing was saved.', { year: fmt.num(Number(counts.year ?? 0)), alltime: fmt.num(Number(counts.alltime ?? 0)) })
        : problemText(t, res);
      if (!res.ok) { box.innerHTML = String(html`<p class="notice">${why}</p>`); return; }
      box.innerHTML = String(finalizePreview(ctx, d.core, { dryRun, year: d.queue!.year, ...res.body }));
      if (dryRun) { previewed = true; root.querySelector<HTMLButtonElement>('[data-final]')!.disabled = false; } else { toast(t('Finalized. The payouts are queued for the bot.')); reload(); }
    }
  });

  root.addEventListener('submit', async ev => {
    const form = (ev.target as Element).closest<HTMLFormElement>('[data-reason-form]');
    if (!form) return;
    ev.preventDefault();
    const reason = String(new FormData(form).get('reason') ?? '').trim();
    const action = form.dataset.action!;
    if (NEEDS_REASON.has(action) && !reason) { form.querySelector('input')!.focus(); return; }
    const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    button.disabled = true;
    const target = /^\d+$/.test(form.dataset.target!) ? Number(form.dataset.target) : form.dataset.target;
    const res = await top10Api('/api/top10/admin/action', { method: 'POST', body: { action, target, reason, kind: d.kind } });
    if (!res.ok) { button.disabled = false; toast(problemText(t, res)); return; }
    toast(t('Done: {action}.', { action }));
    reload();
  });
}
