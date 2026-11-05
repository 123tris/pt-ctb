// /players for the app's router, drawn from the core pack. Data without packs goes to the old page.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { readCore } from '../gen/packs.ts';
import { CORE } from '../routes.ts';
import { readState, render, title } from '../views/players.ts';
import { mount } from '../views/players.mount.ts';

export default page({
  old: 'players',
  load: () => store.pack(CORE, readCore),
  title: ctx => title(ctx),
  render: (ctx, core, { query }) => render(ctx, core, readState(query)),
  mount: (root, ctx, core, { query }) => mount(root, ctx, core, readState(query)),
});
