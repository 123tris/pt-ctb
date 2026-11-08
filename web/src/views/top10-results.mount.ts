// /top10/<year> in the browser. The results are drawn whole, so there's nothing to wire yet.
//
// The hook for December's 10 → 1 reveal (TOP10-DESIGN.md §6): when revealable() holds (this season's results, not a
// past edition's), the ranking is drawn with data-t10-reveal, and the reveal plays here over the rows already in the
// page (each <li> has data-rank), the all-time list as the finale. Without script, or after it, the page reads as is.

import type { Ctx } from '../kernel/ctx.ts';
import { revealable, type Data } from './top10-results.ts';

export function mount(root: HTMLElement, _ctx: Ctx, d: Data): void {
  const list = root.querySelector<HTMLElement>('[data-t10-reveal]');
  if (!list || !revealable(d)) return;
  // December: the 10 → 1 reveal goes here.
}
