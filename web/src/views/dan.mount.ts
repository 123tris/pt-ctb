// The Dan tab's browser half: a stage picked on the ladder opens below it, in the address (?stage=) and in view.

import type { Ctx } from '../kernel/ctx.ts';
import type { Players } from '../ui/players.ts';
import { scrollBehavior } from '../client/legacy.ts';
import { ladder, stageDetail, type Dan } from './dan.ts';

export function mount(panel: HTMLElement, ctx: Ctx, dan: Dan, players: Players, start: number): void {
  let selected = start;
  const ladderEl = panel.querySelector<HTMLElement>('#ladder')!;
  const detail = panel.querySelector<HTMLElement>('#detail')!;
  ladderEl.addEventListener('click', e => {
    const button = (e.target as Element).closest<HTMLElement>('[data-stage]');
    if (!button) return;
    selected = Number(button.dataset.stage);
    ladderEl.innerHTML = String(ladder(ctx, dan, players, selected));
    detail.innerHTML = String(stageDetail(ctx, dan, players, selected));
    // The ladder was rebuilt, so put focus back on the stage that was just chosen rather than losing it.
    ladderEl.querySelector<HTMLElement>(`[data-stage="${selected}"]`)?.focus({ preventScroll: true });
    history.replaceState(null, '', `/challenges/dan?stage=${selected}`);
    detail.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  });
}
