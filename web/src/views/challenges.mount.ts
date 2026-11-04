// The Challenges page's browser half: the map of the week's countdown, ticking each second while the page is open, and
// each other tab's own mount (the Dan ladder, King of the hill's choices, the Duels' lists, Completion's list and year
// strip, the Bounties' Bananas).

import type { Ctx } from '../kernel/ctx.ts';
import { bountiesData, countdown, type Data, type State } from './challenges.ts';
import { readStage } from './dan.ts';
import { readState as hillState } from './hill.ts';
import { readState as duelsState } from './duels.ts';
import { readState as completionState } from './completion.ts';
import { mount as mountDan } from './dan.mount.ts';
import { mount as mountHill } from './hill.mount.ts';
import { mount as mountDuels } from './duels.mount.ts';
import { mount as mountBounties } from './bounties.mount.ts';
import { mount as mountCompletion } from './completion.mount.ts';

export function mount(root: HTMLElement, ctx: Ctx, data: Data, state: State, isCurrent: () => boolean): void {
  const panel = root.querySelector<HTMLElement>('#panel')!;
  const players = data.core.players;
  switch (state.tab) {
    case 'week': {
      const week = data.challenges.week;
      const el = root.querySelector('#countdown');
      if (!week || !el) return;
      const timer = setInterval(() => {
        if (!isCurrent() || !el.isConnected) return clearInterval(timer);
        el.textContent = countdown(ctx, week.end);
      }, 1000);
      return;
    }
    case 'bounties':
      if (data.economy) mountBounties(root, ctx, bountiesData(ctx, data), isCurrent);
      return;
    case 'hill':
      if (data.hill) mountHill(panel, ctx, data.hill, players, hillState(ctx, data.hill, state.query));
      return;
    case 'duels':
      if (data.duels) mountDuels(panel, ctx, data.duels, players, duelsState(state.query));
      return;
    case 'dan':
      if (data.dan) mountDan(panel, ctx, data.dan, players, readStage(data.dan, state.query));
      return;
    case 'completion':
      mountCompletion(panel, ctx, data.completion, completionState(ctx, data.completion, state.query));
  }
}
