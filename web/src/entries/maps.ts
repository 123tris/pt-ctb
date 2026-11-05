// /maps for the app's router: every map with Portuguese plays, from the search pack, with the #1s' names from the
// core pack. Data without packs goes to the old page.
//
// The search pack is about 850 KB brotli. A first visit to the default view doesn't wait for it: its first page comes
// from maps-top.json (43 KB), as on the old page, and the search comes alive once the pack is in. When the pack is
// already in the browser's cache it's ready within a few milliseconds, so it gets a short head start and the page is
// drawn from it straight away.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { readCore, readSearch } from '../gen/packs.ts';
import { CORE, SEARCH } from '../routes.ts';
import { mapIndex, type MapIndex } from '../ui/map-search.ts';
import { isTopView, readState, render, type Data, type TopMaps } from '../views/maps.ts';
import { mount, mountWhenIndexed } from '../views/maps.mount.ts';

/** How long the search pack gets to beat maps-top.json: enough to read it from the cache, not to download it. */
const HEAD_START_MS = 50;

/** The search pack's index on its way, for the page drawn from maps-top.json. */
let coming: Promise<MapIndex> | null = null;

export default page<Data>({
  old: 'maps',
  load: async (_, { query }) => {
    const state = readState(query);
    const core = store.pack(CORE, readCore);
    const index = store.pack(SEARCH, readSearch).then(mapIndex);
    coming = null;
    const defaultView = !state.q.trim() && !state.cat && state.sort === 'players';
    if (!defaultView) return { core: await core, index: await index };
    const top = store.json<TopMaps>('maps-top.json');
    const first = await Promise.race([
      index.then(ix => ({ index: ix, top: null })),
      top.then(t => new Promise<{ index: null; top: TopMaps }>(done => setTimeout(() => done({ index: null, top: t }), HEAD_START_MS))),
    ]);
    if (first.index || !isTopView(state, first.top!)) return { core: await core, index: await index };
    coming = index;
    return { core: await core, index: null, top: first.top };
  },
  title: ctx => ctx.t('Maps'),
  render: (ctx, data, { query }) => render(ctx, data, readState(query)),
  mount: (root, ctx, data, { query, isCurrent }) => {
    const options = { rewrite: 'diff' in query, isCurrent };
    if (data.index) mount(root, ctx, data, readState(query), options);
    else mountWhenIndexed(root, ctx, data, readState(query), coming!, options);
  },
});
