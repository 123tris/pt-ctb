// /rankings/:board? for the app's router: every Leaderboards tab. Converts, Loved and Ranked come from the core pack
// alone; Mods, Top plays and Star kings add the JSON the old page reads (modrankings.json, topplays.json, records.json).

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { NotFound } from '../kernel/store.ts';
import { readCore, type CorePack } from '../gen/packs.ts';
import { CORE } from '../routes.ts';
import * as rankings from '../views/rankings.ts';
import * as boards from '../views/boards.ts';
import * as kings from '../views/kings.ts';
import { mount as mountRankings } from '../views/rankings.mount.ts';
import { mount as mountBoards } from '../views/boards.mount.ts';
import { mount as mountKings, keep } from '../views/kings.mount.ts';

type Data =
  | { slug: rankings.Slug; core: CorePack }
  | boards.Data
  | ({ slug: 'kings' } & kings.Data);

// An unknown board shows the first, as the old page does.
const tabOf = (board: string | undefined): rankings.Tab => (rankings.SLUGS.includes(board as rankings.Tab) ? board as rankings.Tab : 'converts');
/** A JSON file that isn't in older data: null. */
const optional = <T>(file: Promise<T>) => file.catch(e => (e instanceof NotFound ? null : Promise.reject(e)));

export default page<Data>({
  old: 'rankings',
  load: async (_, { params }) => {
    const slug = tabOf(params.board);
    const core = store.pack(CORE, readCore);
    if (slug === 'mods') return { slug, core: await core, mods: await store.json<boards.ModRankings>('modrankings.json') };
    if (slug === 'plays') return { slug, core: await core, plays: await optional(store.json<boards.TopPlays>('topplays.json')) };
    if (slug === 'kings') {
      const [c, records] = await Promise.all([core, store.json<{ kings?: kings.Kings }>('records.json')]);
      return { slug, core: c, kings: records?.kings ?? null };
    }
    return { slug, core: await core };
  },
  title: (ctx, data, { query }) => (data.slug === 'kings' ? kings.title(ctx, kings.readState(data.kings, query)) : rankings.title(ctx, data.slug)),
  render: (ctx, data, { query }) => {
    if (data.slug === 'mods' || data.slug === 'plays') return boards.render(ctx, data, boards.readState(data, query));
    if (data.slug === 'kings') return kings.render(ctx, data, kings.readState(data.kings, query));
    // A screenful of the board first (all of it when a row is to be scrolled to); mount() adds the rest.
    const state = rankings.readState(data.slug, query);
    return rankings.render(ctx, data.core, state, state.at ? Infinity : rankings.FIRST_ROWS);
  },
  keep,
  mount: (root, ctx, data, { query }, before) => {
    if (data.slug === 'mods' || data.slug === 'plays') mountBoards(root, ctx, data, boards.readState(data, query));
    else if (data.slug === 'kings') mountKings(root, ctx, data, kings.readState(data.kings, query), before);
    else {
      const state = rankings.readState(data.slug, query);
      mountRankings(root, ctx, data.core, state, state.at ? Infinity : rankings.FIRST_ROWS);
    }
  },
});
