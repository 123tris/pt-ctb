// Compare's browser half: the two name boxes, which open the comparison, and paging through the shared maps.

import type { Ctx } from '../kernel/ctx.ts';
import { go } from '../client/ui.ts';
import { paginate } from '../client/dom.ts';
import { pickedRow } from '../ui/pickers.ts';
import { shared, sharedRows, type Data } from './compare.ts';

export function mount(root: HTMLElement, ctx: Ctx, data: Data): void {
  const players = data.core.players;
  const compare = () => {
    const pa = pickedRow(players, root.querySelector<HTMLInputElement>('#pick-a')!.value);
    const pb = pickedRow(players, root.querySelector<HTMLInputElement>('#pick-b')!.value);
    const a = pa >= 0 ? pa : data.a, b = pb >= 0 ? pb : data.b;
    if (a >= 0 && b >= 0 && a !== b) go(`/compare/${players.id[a]}/${players.id[b]}`);
    else if (a >= 0 && a !== data.a) go(`/compare/${players.id[a]}`);
  };
  root.querySelector('#pick-a')!.addEventListener('change', compare);
  root.querySelector('#pick-b')!.addEventListener('change', compare);

  const list = root.querySelector<HTMLElement>('#shared');
  if (!list || !data.packs) return;
  paginate(ctx, list, shared(data.packs[0], data.packs[1], data.cat), slice => sharedRows(ctx, data, slice), 30);
}
