// /rankings/:board?/:year? for the app's router: every Leaderboards tab. Converts, Loved and Ranked come from the core
// pack alone; Mods, Top plays and Star kings add the JSON the old page reads (modrankings.json, topplays.json,
// records.json). A year after Ranked (/rankings/ranked/2024) is that year's board, from the years pack.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { NotFound, PacksMissing } from '../kernel/store.ts';
import { readCore, readYears, type CorePack } from '../gen/packs.ts';
import { CORE, YEARS } from '../routes.ts';
import * as rankings from '../views/rankings.ts';
import * as rankedYears from '../views/ranked-years.ts';
import * as boards from '../views/boards.ts';
import * as kings from '../views/kings.ts';
import { mount as mountRankings } from '../views/rankings.mount.ts';
import { mount as mountRankedYears } from '../views/ranked-years.mount.ts';
import { mount as mountBoards } from '../views/boards.mount.ts';
import { mount as mountKings, keep } from '../views/kings.mount.ts';

type Data =
  | { slug: rankings.Slug; core: CorePack }
  | boards.Data
  | ({ slug: 'kings' } & kings.Data)
  | ({ slug: 'years'; year: number } & rankedYears.Data);

// An unknown board shows the first, as the old page does.
const tabOf = (board: string | undefined): rankings.Tab => (rankings.SLUGS.includes(board as rankings.Tab) ? board as rankings.Tab : 'converts');
/** A JSON file that isn't in older data: null. */
const optional = <T>(file: Promise<T>) => file.catch(e => (e instanceof NotFound ? null : Promise.reject(e)));
/** A pack that isn't in older data: null, so the page can say it's coming instead of falling back to the old one. */
const optionalPack = <T>(pack: Promise<T>) => pack.catch(e => (e instanceof PacksMissing ? null : Promise.reject(e)));

export default page<Data>({
  old: 'rankings',
  load: async (_, { params }) => {
    const slug = tabOf(params.board);
    const core = store.pack(CORE, readCore);
    const year = slug === 'ranked' ? rankedYears.yearParam(params.year) : null;
    if (year !== null) {
      const [c, years] = await Promise.all([core, optionalPack(store.pack(YEARS, readYears))]);
      return { slug: 'years', year, core: c, years };
    }
    if (slug === 'mods') return { slug, core: await core, mods: await store.json<boards.ModRankings>('modrankings.json') };
    if (slug === 'plays') return { slug, core: await core, plays: await optional(store.json<boards.TopPlays>('topplays.json')) };
    if (slug === 'kings') {
      const [c, records] = await Promise.all([core, store.json<{ kings?: kings.Kings }>('records.json')]);
      return { slug, core: c, kings: records?.kings ?? null };
    }
    return { slug, core: await core };
  },
  title: (ctx, data, { query }) => (data.slug === 'kings' ? kings.title(ctx, kings.readState(data.kings, query))
    : data.slug === 'years' ? rankedYears.title(ctx, data.year) : rankings.title(ctx, data.slug)),
  render: (ctx, data, { query }) => {
    if (data.slug === 'years') return rankedYears.render(ctx, data, rankedYears.readState(data.year, query));
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
    else if (data.slug === 'years') mountRankedYears(root, ctx, data, rankedYears.readState(data.year, query));
    else {
      const state = rankings.readState(data.slug, query);
      mountRankings(root, ctx, data.core, state, state.at ? Infinity : rankings.FIRST_ROWS);
    }
  },
});
