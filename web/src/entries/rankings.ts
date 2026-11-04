// /rankings/:board? for the old app's router. Converts, Loved and Ranked are drawn from the core pack; the other tabs,
// and data without packs, go to the old page.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { readCore } from '../gen/packs.ts';
import { CORE, firstData } from '../routes.ts';
import { BOARD_CAT, readState, render, title, type Slug } from '../views/rankings.ts';
import { mount } from '../views/rankings.mount.ts';

// An unknown board shows the first, as the old page does.
const slugOf = (board: string | undefined): Slug => (board && board in BOARD_CAT ? board as Slug : 'converts');

export default page({
  old: 'rankings',
  load: async (_, { params }) => (firstData(`rankings/${params.board ?? ''}`) ? store.pack(CORE, readCore) : null),
  title: (ctx, _, { params }) => title(ctx, slugOf(params.board)),
  render: (ctx, core, { params, query }) => render(ctx, core, readState(slugOf(params.board), query)),
  mount: (root, ctx, core, { params, query }) => mount(root, ctx, core, readState(slugOf(params.board), query)),
});
