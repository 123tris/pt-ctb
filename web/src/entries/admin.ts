// /admin for the old app's router: the admin panel. Signed out, nothing loads. Signed in: the admin's own requests
// (/api/admin/requests, which answers 403 to anyone who isn't an admin), the players from the core pack, and the JSON
// the old page reads: admin.json and hill.json once meta.json lists them (the bot publishes them once it runs those
// parts), and bounties.json. Each may be missing; the page shows what it has.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { signInHere } from '../client/legacy.ts';
import { readCore } from '../gen/packs.ts';
import { CORE } from '../routes.ts';
import type { Panel } from '../ui/admin.ts';
import { render, type Data, type Loaded } from '../views/admin.ts';
import { mount, myAdminRequests } from '../views/admin.mount.ts';

/** A JSON file meta.json lists only once the bot has started its feature: null before (or when it can't be read). */
const ifListed = <T>(name: string): Promise<T | null> =>
  store.hasJson(name).then(has => (has ? store.json<T>(name) : null)).catch(() => null);

export default page<Data>({
  old: 'admin',
  load: async ctx => {
    const here = Boolean(signInHere());
    if (ctx.me === null) return { signInHere: here, loaded: null };
    const [mine, panel, core, hill, board] = await Promise.all([
      myAdminRequests(),
      ifListed<Panel>('admin.json'),
      store.pack(CORE, readCore),
      ifListed<Loaded['hill']>('hill.json'),
      store.json<Loaded['board']>('bounties.json').catch(() => null),
    ]);
    return { signInHere: here, loaded: { mine, panel, core, hill, board } };
  },
  title: ctx => ctx.t('Admin'),
  render: (ctx, data) => render(ctx, data),
  mount: (root, ctx, data) => mount(root, ctx, data),
});
