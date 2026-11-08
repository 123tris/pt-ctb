// /admin?tab=top10 for the app's router: the admin panel's Top 10 tab (entries/admin.ts loads it for that tab only,
// so the bot's tab doesn't carry it). Signed out, nothing loads; signed in, the queue from the endpoint, which answers
// 403 to anyone who isn't an admin.

import { store } from '../client/boot.ts';
import { signInHere } from '../client/bananas.ts';
import { top10Api } from '../client/top10.ts';
import { readCore } from '../gen/packs.ts';
import { CORE } from '../routes.ts';
import { troubleOf } from '../ui/top10.ts';
import { top10Page } from '../client/top10-page.ts';
import { render, type Data, type Queue } from './top10-admin.ts';
import { mount } from './top10-admin.mount.ts';

export default top10Page<Data>({
  load: async ctx => {
    const c = await store.pack(CORE, readCore);
    if (ctx.me === null) return { core: c, signInHere: signInHere(), status: 401, trouble: 'signin', queue: null };
    const res = await top10Api('/api/top10/admin/queue');
    return { core: c, signInHere: signInHere(), status: res.status, trouble: troubleOf(res.status), queue: res.ok ? res.body as Queue : null };
  },
  title: ctx => `${ctx.t('Admin')} · ${ctx.t('Top 10')}`,
  render: (ctx, d) => render(ctx, d),
  mount: (root, ctx, d) => mount(root, ctx, d),
});
