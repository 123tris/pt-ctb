// /challenges/:tab? for the app's router: every Challenges tab. Players come from the core pack, the rest from the
// JSON the old page reads, when it reads it: challenges.json and bounties.json (both small, and cached) on every tab
// for the figures and chips, meta.json's month, duels and goal in brief, and each tab's own file only on that tab:
// dan.json, hill.json and duels.json (once the bot has started King of the hill and duels), completion.json, and
// economy.json for the Bounties' Bananas.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { NotFound } from '../kernel/store.ts';
import { signInHere } from '../client/bananas.ts';
import { readCore } from '../gen/packs.ts';
import type { Manifest } from '../kernel/store.ts';
import { CORE } from '../routes.ts';
import { readState, render, title, type Challenges, type Data, type SiteBrief } from '../views/challenges.ts';
import { mount } from '../views/challenges.mount.ts';
import type { Dan } from '../views/dan.ts';
import type { Hill } from '../views/hill.ts';
import type { Board, Economy } from '../views/bounties.ts';
import type { Completion } from '../views/completion.ts';
import type { DuelsFile } from '../ui/duels.ts';

/** A JSON file that isn't in older data: null. */
const optional = <T>(file: Promise<T>) => file.catch(e => (e instanceof NotFound ? null : Promise.reject(e)));
/** A JSON file meta.json lists only once the bot has started its feature: null before. */
const ifListed = <T>(name: string) => store.hasJson(name).then(has => (has ? store.json<T>(name) : null));

export default page<Data>({
  old: 'challenges',
  load: async (_, { params }) => {
    const asked = params.tab;
    const [core, challenges, board, site, dan, completion, hill, duels, economy] = await Promise.all([
      store.pack(CORE, readCore),
      store.json<Challenges>('challenges.json'),
      optional(store.json<Board>('bounties.json')),
      store.manifest('meta.json') as Promise<Manifest & SiteBrief>,
      asked === 'dan' ? store.json<Dan>('dan.json') : null,
      asked === 'completion' ? optional(store.json<Completion>('completion.json')) : null,
      asked === 'hill' ? ifListed<Hill>('hill.json') : null,
      asked === 'duels' ? ifListed<DuelsFile>('duels.json') : null,
      asked === 'bounties' ? ifListed<Economy>('economy.json').catch(() => null) : null,
    ]);
    return { core, challenges, board, site, dan, completion, hill, duels, economy, signInHere: Boolean(signInHere()) };
  },
  title: (ctx, data, { params, query }) => title(ctx, readState(data, params, query)),
  render: (ctx, data, { params, query }) => render(ctx, data, readState(data, params, query)),
  mount: (root, ctx, data, { params, query, isCurrent }) => mount(root, ctx, data, readState(data, params, query), isCurrent),
});
