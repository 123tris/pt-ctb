// /activity for the old app's router: the events feed, recent plays and the weekly recap, from activity.json and
// challenges.json (optional, for "This week") with players from the core pack.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { readCore } from '../gen/packs.ts';
import { CORE } from '../routes.ts';
import { readState, render, type Activity, type Data } from '../views/activity.ts';
import { mount } from '../views/activity.mount.ts';

export default page<Data>({
  old: 'activity',
  load: async () => {
    const [core, activity, challenges] = await Promise.all([
      store.pack(CORE, readCore), store.json<Activity>('activity.json'), store.json<Data['challenges']>('challenges.json').catch(() => null),
    ]);
    return { core, activity, challenges };
  },
  title: ctx => ctx.t('Activity'),
  render: (ctx, data, { query }) => render(ctx, data, readState(ctx, data, query)),
  mount: (root, ctx, data, { query }) => mount(root, ctx, data, readState(ctx, data, query)),
});
