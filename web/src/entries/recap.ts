// /recap/:id/:year? for the app's router: a player's year in review, from their pack and the core pack (the old
// page downloads their whole player file). A player the site doesn't have is the router's "Never heard of them!".

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { NotFound } from '../kernel/store.ts';
import { readCore, readPlayer } from '../gen/packs.ts';
import { CORE, playerPack } from '../routes.ts';
import { rowOf } from '../ui/players.ts';
import { recapOf, render, title, type Data } from '../views/recap.ts';
import { mount } from '../views/recap.mount.ts';

export default page<Data>({
  old: 'wrapped',
  load: async (_, { params }) => {
    const id = Number(params.id);
    // Both at once. The player's pack is only read for a player the core pack has: an unknown one's is left to fail.
    const pack = store.pack(playerPack(id), readPlayer);
    pack.catch(() => {});
    const core = await store.pack(CORE, readCore);
    const row = rowOf(core.players, id);
    // Unknown here, as on the old page, where the player's file isn't there (a 404).
    if (row < 0) throw new NotFound(`players/${params.id}.json`);
    return { id, core, row, ...recapOf(await pack, params.year) };
  },
  title: (ctx, data) => title(ctx, data),
  render: (ctx, data) => render(ctx, data),
  mount: (root, ctx, data) => mount(root, ctx, data),
});
