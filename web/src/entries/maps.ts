// /maps for the old app's router: every map with Portuguese plays, from the search pack, with the #1s' names from the
// core pack. Data without packs goes to the old page.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { readCore, readSearch } from '../gen/packs.ts';
import { CORE, SEARCH } from '../routes.ts';
import { mapIndex } from '../ui/map-search.ts';
import { readState, render } from '../views/maps.ts';
import { mount } from '../views/maps.mount.ts';

export default page({
  old: 'maps',
  load: async () => {
    const [core, search] = await Promise.all([store.pack(CORE, readCore), store.pack(SEARCH, readSearch)]);
    return { core, index: mapIndex(search) };
  },
  title: ctx => ctx.t('Maps'),
  render: (ctx, data, { query }) => render(ctx, data, readState(query)),
  mount: (root, ctx, data, { query, isCurrent }) => mount(root, ctx, data, readState(query), { rewrite: 'diff' in query, isCurrent }),
});
