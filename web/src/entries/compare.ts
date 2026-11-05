// /compare/:a?/:b? for the app's router: two players side by side, from the core pack and their two player packs.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { readCore, readPlayer } from '../gen/packs.ts';
import { CORE, playerPack } from '../routes.ts';
import { rowOf } from '../ui/players.ts';
import { CATS, render, title, type Data } from '../views/compare.ts';
import { mount } from '../views/compare.mount.ts';
import type { Cat } from '../ui/scores.ts';

export default page<Data>({
  old: 'compare',
  load: async (ctx, { params, query }) => {
    const core = await store.pack(CORE, readCore);
    const players = core.players;
    // A missing or unknown first player is the visitor, when they're signed in, as on the old page.
    const pickedA = rowOf(players, Number(params.a));
    const a = pickedA >= 0 ? pickedA : ctx.me === null ? -1 : rowOf(players, ctx.me);
    const b = rowOf(players, Number(params.b));
    const packs = a >= 0 && b >= 0
      ? await Promise.all([store.pack(playerPack(players.id[a]), readPlayer), store.pack(playerPack(players.id[b]), readPlayer)])
      : null;
    const cat: Cat = CATS.includes(query.cat as Cat) ? query.cat as Cat : 'c';
    return { core, a, b, packs, cat };
  },
  title: (ctx, data) => title(ctx, data),
  render: (ctx, data) => render(ctx, data),
  mount: (root, ctx, data) => mount(root, ctx, data),
});
