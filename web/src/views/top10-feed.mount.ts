// /top10/ballots in the browser: thanks on the write-ups about you (§3.5), drawn again from the answer.

import type { Ctx } from '../kernel/ctx.ts';
import { toast } from '../client/fun.ts';
import { top10Api, problemText } from '../client/top10.ts';
import { writeupBlock, type Data } from './top10-feed.ts';

export function mount(root: HTMLElement, ctx: Ctx, d: Data): void {
  const { t } = ctx;
  root.addEventListener('click', async ev => {
    const button = (ev.target as Element).closest<HTMLButtonElement>('[data-thank]');
    if (!button || ctx.me === null) return;
    const voter = Number(button.dataset.thank);
    const ballot = d.ballots.find(b => b.voter === voter);
    const w = ballot?.writeups[ctx.me];
    if (!ballot || !w) return;
    button.disabled = true;
    // The state wanted, said outright (left out, it toggles): taking it back works until the results are final.
    const res = await top10Api('/api/top10/thanks', { method: 'POST', body: { voter, kind: d.kind, thanked: !w.thanked } });
    if (!res.ok) { button.disabled = false; toast(problemText(t, res)); return; }
    // The answer says where it stands when it can; otherwise a thanks was given.
    w.thanked = typeof res.body?.thanked === 'boolean' ? res.body.thanked : true;
    if (typeof res.body?.thanks === 'number') w.thanks = res.body.thanks;
    const block = button.closest('.t10-wu');
    if (block) block.outerHTML = String(writeupBlock(ctx, d, ballot, ctx.me, w));
    if (w.thanked) toast(t('Thanked. They get +5 🍌 once the results are finalized.'));
    root.querySelector<HTMLElement>(`[data-thank="${voter}"]`)?.focus();
  });
}
